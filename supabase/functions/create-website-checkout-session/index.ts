import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { originFor, priceEnvironment, requireUser, response, snapshotItemPriceEnvironment, stripeClient, websiteMetadata, websiteServiceAmount } from "../_shared/website-billing.ts";

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, user, authUser } = await requireUser(request);
    const input = await request.json();
    const snapshot_id = input.snapshot_id;
    const requestedBillingInterval = input.billing_interval ? String(input.billing_interval) : "";
    if (requestedBillingInterval && !["monthly", "yearly"].includes(requestedBillingInterval)) {
      return response({ error: "Choose monthly or yearly billing." }, 400, origin);
    }
    const { data: isAdmin } = await user.rpc("is_platform_admin");
    const { data: snapshot, error } = await admin
      .from("website_billing_snapshots")
      .select("*,website_billing_snapshot_items(*)")
      .eq("id", snapshot_id)
      .single();
    if (error || !snapshot) return response({ error: "Billing setup was not found." }, 404, origin);
    if (snapshot.client_user_id !== authUser.id && isAdmin !== true) return response({ error: "You cannot access this website billing setup." }, 403, origin);
    if (snapshot.status === "active") return response({ error: "Billing is already active." }, 409, origin);
    const includedRecurringItems = (snapshot.website_billing_snapshot_items || [])
      .filter((item: Record<string, unknown>) => item.billing_type === "recurring" && item.included_in_initial_checkout)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const subscriptionType = includedRecurringItems.length && includedRecurringItems.every((item: Record<string, unknown>) => item.category === "domain")
      ? "domain"
      : "service";
    if (snapshot.recurring_start_policy === "review_required" && subscriptionType !== "domain") {
      return response({ error: "Starter+ is complimentary and requires a review before paid service billing. Only an approved domain renewal can be set up now." }, 409, origin);
    }
    const serviceItems = includedRecurringItems.filter((item: Record<string, unknown>) => ["maintenance", "hosting"].includes(String(item.category)));
    const hasServiceCheckout = serviceItems.length > 0;
    const founderOffer = String(snapshot.offer_code || "").toUpperCase() === "FREEBUILD";
    if (founderOffer && hasServiceCheckout && requestedBillingInterval === "monthly") {
      return response({ error: "FREEBUILD includes a free website build with one full year of service paid upfront." }, 409, origin);
    }
    const selectedBillingInterval = hasServiceCheckout
      ? founderOffer ? "yearly" : requestedBillingInterval || String(snapshot.recurring_interval || "")
      : "";
    if (!requestedBillingInterval && snapshot.checkout_url && snapshot.checkout_expires_at && new Date(snapshot.checkout_expires_at) > new Date()) {
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
      offer_code: snapshot.offer_code,
      subscription_type: subscriptionType,
      billing_interval: selectedBillingInterval || String(snapshot.recurring_interval || ""),
    });
    const { data: schedule } = await admin
      .from("website_billing_schedules")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .maybeSingle();
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
    if (includedRecurringItems.length) {
      mode = "subscription";
      const recurringItems = includedRecurringItems;
      if (!recurringItems.length) throw new Error("No recurring billing lines were found for this proposal.");
      const intervals = new Set<string>();
      for (const item of recurringItems) {
        const isService = ["maintenance", "hosting"].includes(String(item.category));
        const effectiveInterval = isService ? selectedBillingInterval : String(item.recurring_interval || "");
        const effectiveAmount = isService
          ? websiteServiceAmount(String(snapshot.service_plan || ""), effectiveInterval, Number(item.total_amount_cents || 0))
          : Number(item.total_amount_cents || 0);
        const priceId = isService
          ? priceEnvironment(String(snapshot.service_plan || ""), effectiveInterval, effectiveAmount)
          : snapshotItemPriceEnvironment(item, snapshot.service_plan);
        if (!priceId) throw new Error(`Stripe pricing is not configured for ${String(item.name || "this recurring item")}.`);
        intervals.add(effectiveInterval);
        lineItems.push({ price: priceId, quantity: Number(item.quantity || 1) });
      }
      if (intervals.size > 1) {
        throw new Error("Monthly and yearly recurring items must be checked out separately. Update the proposal billing schedule before continuing.");
      }
    }

    const scheduledStart = schedule?.service_start_at ? new Date(schedule.service_start_at) : null;
    const futureStart = scheduledStart && scheduledStart.getTime() > Date.now() + 48 * 60 * 60 * 1000
      ? Math.floor(scheduledStart.getTime() / 1000)
      : null;
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
        ? {
            payment_method_collection: "always",
            subscription_data: {
              metadata,
              ...(futureStart
                ? {
                    trial_end: futureStart,
                    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
                  }
                : {}),
            },
          }
        : { invoice_creation: { enabled: true, invoice_data: { metadata } }, payment_intent_data: { setup_future_usage: "off_session", metadata } }),
    }, { idempotencyKey: `website-checkout-${snapshot.id}-${selectedBillingInterval || "accepted"}` });

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
