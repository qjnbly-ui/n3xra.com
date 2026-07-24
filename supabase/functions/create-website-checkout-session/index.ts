import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { originFor, priceEnvironment, requireUser, response, stripeClient, websiteMetadata } from "../_shared/website-billing.ts";

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, user, authUser } = await requireUser(request);
    const { snapshot_id } = await request.json();
    const { data: isAdmin } = await user.rpc("is_platform_admin");
    const { data: snapshot, error } = await admin.from("website_billing_snapshots").select("*").eq("id", snapshot_id).single();
    if (error || !snapshot) return response({ error: "Billing setup was not found." }, 404, origin);
    if (snapshot.client_user_id !== authUser.id && isAdmin !== true) return response({ error: "You cannot access this website billing setup." }, 403, origin);
    if (snapshot.status === "active") return response({ error: "Billing is already active." }, 409, origin);
    if (snapshot.checkout_url && snapshot.checkout_expires_at && new Date(snapshot.checkout_expires_at) > new Date()) {
      return response({ url: snapshot.checkout_url, reused: true }, 200, origin);
    }

    const stripe = stripeClient();
    const clientUserId = snapshot.client_user_id;
    let { data: billingCustomer } = await admin.from("website_billing_customers").select("*").eq("user_id", clientUserId).maybeSingle();
    if (!billingCustomer) {
      const { data: clientUserResult } = await admin.auth.admin.getUserById(clientUserId);
      const clientUser = clientUserResult?.user;
      const customer = await stripe.customers.create({
        email: clientUser?.email,
        name: String(clientUser?.user_metadata?.full_name || "").trim() || undefined,
        metadata: websiteMetadata({ n3xra_user_id: clientUserId }),
      }, { idempotencyKey: `website-customer-${clientUserId}` });
      const inserted = await admin.from("website_billing_customers").insert({ user_id: clientUserId, stripe_customer_id: customer.id }).select().single();
      if (inserted.error) throw new Error(inserted.error.message);
      billingCustomer = inserted.data;
    }

    const metadata = websiteMetadata({
      n3xra_user_id: clientUserId,
      website_project_id: snapshot.project_id,
      proposal_version_id: snapshot.proposal_version_id,
      billing_snapshot_id: snapshot.id,
      referral_code: snapshot.referral_code,
    });
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    if (snapshot.amount_due_now_cents > 0) lineItems.push({
      quantity: 1,
      price_data: {
        currency: snapshot.currency,
        unit_amount: snapshot.amount_due_now_cents,
        product_data: { name: snapshot.remaining_build_balance_cents > 0 ? "Website project deposit" : "Approved website project", metadata },
      },
    });

    let mode: Stripe.Checkout.SessionCreateParams.Mode = "payment";
    let recurringPriceId = "";
    if (snapshot.recurring_cents > 0) {
      mode = "subscription";
      recurringPriceId = priceEnvironment(snapshot.service_plan, snapshot.recurring_interval);
      if (!recurringPriceId) {
        const price = await stripe.prices.create({
          currency: snapshot.currency,
          unit_amount: snapshot.recurring_cents,
          recurring: { interval: snapshot.recurring_interval === "yearly" ? "year" : "month" },
          product_data: { name: `Managed website service — ${snapshot.service_plan.replace("_", " ")}`, metadata },
          metadata,
        }, { idempotencyKey: `website-price-${snapshot.id}` });
        recurringPriceId = price.id;
      }
      lineItems.push({ price: recurringPriceId, quantity: 1 });
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: billingCustomer.stripe_customer_id,
      client_reference_id: snapshot.id,
      line_items: lineItems,
      allow_promotion_codes: false,
      billing_address_collection: "auto",
      success_url: `${origin}/client-portal/billing/?billing=success&project=${snapshot.project_id}`,
      cancel_url: `${origin}/client-portal/billing/?billing=canceled&project=${snapshot.project_id}`,
      metadata,
      ...(mode === "subscription"
        ? { subscription_data: { metadata } }
        : { invoice_creation: { enabled: true, invoice_data: { metadata } }, payment_intent_data: { setup_future_usage: "off_session", metadata } }),
    }, { idempotencyKey: `website-checkout-${snapshot.id}` });

    const expires = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const update = await admin.from("website_billing_snapshots").update({
      status: "checkout_pending",
      stripe_checkout_session_id: session.id,
      checkout_url: session.url,
      checkout_expires_at: expires,
    }).eq("id", snapshot.id);
    if (update.error) throw new Error(update.error.message);
    return response({ url: session.url }, 200, origin);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to start secure billing." }, 400, origin);
  }
});
