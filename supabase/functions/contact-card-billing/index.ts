import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { STRIPE_API_VERSION, corsHeaders, getAppOrigin, jsonResponse } from "../_shared/stripe-billing.ts";

type OneTimeProductKey = "base" | "additional_card" | "three_pack";
type ProductKey = OneTimeProductKey | "branding_removal" | "premium_monthly" | "premium_yearly";
type PremiumPlan = "monthly" | "yearly";

const PRODUCTS: Record<OneTimeProductKey, { env: string; amount: number; quantity: number }> = {
  base: { env: "STRIPE_PRICE_CONTACT_CARD_BASE", amount: 1999, quantity: 1 },
  additional_card: { env: "STRIPE_PRICE_CONTACT_CARD_ADDITIONAL", amount: 799, quantity: 1 },
  three_pack: { env: "STRIPE_PRICE_CONTACT_CARD_THREE_PACK", amount: 1999, quantity: 3 },
};

const PREMIUM_PLANS: Record<PremiumPlan, { amount: number; interval: "month" | "year"; label: string; lookupKey: string }> = {
  monthly: { amount: 399, interval: "month", label: "$3.99 per month", lookupKey: "n3xra_contact_card_premium_monthly_399" },
  yearly: { amount: 2999, interval: "year", label: "$29.99 per year", lookupKey: "n3xra_contact_card_premium_yearly_2999" },
};

function oneTimeProduct(value: string): value is OneTimeProductKey {
  return value === "base" || value === "additional_card" || value === "three_pack";
}

function premiumPlan(product: ProductKey): PremiumPlan | null {
  return product === "premium_monthly" ? "monthly" : product === "premium_yearly" ? "yearly" : null;
}

function serviceKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
}

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe is not configured.");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
}

async function ensurePremiumPrice(stripe: Stripe, plan: PremiumPlan): Promise<string> {
  const definition = PREMIUM_PLANS[plan];
  const existingPrices = await stripe.prices.list({ active: true, lookup_keys: [definition.lookupKey], limit: 1 });
  if (existingPrices.data[0]?.id) return existingPrices.data[0].id;

  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((item) => item.metadata?.n3xra_key === "contact_card_premium");
  if (!product) {
    product = await stripe.products.create({
      name: "N3XRA Contact Card Premium",
      description: "Connect Back, business-card scanning, contact management, exports, and branding removal.",
      metadata: { n3xra_key: "contact_card_premium" },
    }, { idempotencyKey: "n3xra-contact-card-premium-product-v1" });
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: definition.amount,
    recurring: { interval: definition.interval },
    lookup_key: definition.lookupKey,
    nickname: `Contact Card Premium · ${definition.label}`,
    metadata: { app: "n3xra_contact_card_premium", plan },
  }, { idempotencyKey: `${definition.lookupKey}-v1` });
  return price.id;
}

Deno.serve(async (request) => {
  const origin = getAppOrigin(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const adminKey = serviceKey();
    const authorization = request.headers.get("Authorization");
    if (!supabaseUrl || !anonKey || !adminKey) throw new Error("Supabase is not configured.");
    if (!authorization) return jsonResponse({ error: "Sign in before starting checkout." }, 401, origin);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(supabaseUrl, adminKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Your session has expired. Sign in again." }, 401, origin);

    const input = await request.json().catch(() => ({}));
    const action = String(input.action || "checkout").trim().toLowerCase();
    const product = String(input.product || "") as ProductKey;
    if (product === "branding_removal") {
      return jsonResponse({ error: "Branding removal is now included with N3XRA Contact Card Premium. New one-time purchases are no longer available." }, 410, origin);
    }
    const plan = premiumPlan(product);
    if (!plan && !oneTimeProduct(product) && !["portal", "start_trial"].includes(action)) return jsonResponse({ error: "Choose a valid Contact Card purchase." }, 400, origin);

    const { data: profile, error: profileError } = await admin
      .from("contact_card_profiles")
      .select("id, owner_user_id, display_name")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) return jsonResponse({ error: "Set up your Contact Card details before checkout." }, 400, origin);

    const { data: entitlement } = await admin
      .from("contact_card_entitlements")
      .select("base_access, branding_removal, stripe_customer_id, stripe_subscription_id, premium_active, premium_status, premium_started_at, premium_trial_started_at, premium_trial_ends_at")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (action === "start_trial") {
      if (!entitlement?.base_access) return jsonResponse({ error: "Activate your Contact Card before starting the trial." }, 400, origin);
      if (entitlement.premium_active || entitlement.premium_started_at || entitlement.stripe_subscription_id) {
        return jsonResponse({ error: "This account has already had Premium access." }, 409, origin);
      }
      if (entitlement.premium_trial_started_at) {
        return jsonResponse({ error: "The free trial has already been used for this account." }, 409, origin);
      }
      const trialStartedAt = new Date();
      const trialEndsAt = new Date(trialStartedAt.getTime() + (7 * 24 * 60 * 60 * 1000));
      const { data: trial, error: trialError } = await admin
        .from("contact_card_entitlements")
        .update({ premium_trial_started_at: trialStartedAt.toISOString(), premium_trial_ends_at: trialEndsAt.toISOString() })
        .eq("owner_user_id", user.id)
        .eq("premium_active", false)
        .is("premium_started_at", null)
        .is("stripe_subscription_id", null)
        .is("premium_trial_started_at", null)
        .select("premium_trial_started_at,premium_trial_ends_at")
        .maybeSingle();
      if (trialError) throw new Error(trialError.message);
      if (!trial) return jsonResponse({ error: "The free trial has already been used for this account." }, 409, origin);
      return jsonResponse({ trial_started_at: trial.premium_trial_started_at, trial_ends_at: trial.premium_trial_ends_at }, 200, origin);
    }

    const stripe = stripeClient();
    if (action === "portal") {
      if (!entitlement?.stripe_customer_id) return jsonResponse({ error: "Premium billing is not active for this account." }, 400, origin);
      const session = await stripe.billingPortal.sessions.create({
        customer: entitlement.stripe_customer_id,
        return_url: `${origin}/client-portal/contact-card/`,
      });
      return jsonResponse({ url: session.url }, 200, origin);
    }

    if (product === "base" && entitlement?.base_access) return jsonResponse({ error: "This Contact Card is already active." }, 400, origin);
    if (product !== "base" && !entitlement?.base_access) return jsonResponse({ error: "Activate your Contact Card first." }, 400, origin);

    if (plan) {
      if (entitlement?.premium_active || ["trialing", "active", "past_due", "paused", "unpaid"].includes(String(entitlement?.premium_status || ""))) {
        return jsonResponse({ error: "Premium billing is already active. Open billing management to review it." }, 409, origin);
      }
      const price = await ensurePremiumPrice(stripe, plan);
      const metadata = {
        app: "n3xra_contact_card_premium",
        owner_user_id: user.id,
        profile_id: profile.id,
        product,
        plan,
      };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        ...(entitlement?.stripe_customer_id ? { customer: entitlement.stripe_customer_id } : { customer_email: user.email || undefined }),
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        client_reference_id: profile.id,
        success_url: `${origin}/client-portal/contact-card/?checkout=success&product=premium`,
        cancel_url: `${origin}/client-portal/contact-card/?checkout=canceled`,
        metadata,
        subscription_data: { metadata },
      }, { idempotencyKey: `contact-card-premium-${user.id}-${plan}-${Math.floor(Date.now() / 60000)}` });
      return jsonResponse({ url: session.url }, 200, origin);
    }

    const definition = PRODUCTS[product];
    const price = Deno.env.get(definition.env);
    if (!price) throw new Error(`Missing ${definition.env}.`);
    const orderId = crypto.randomUUID();
    const { error: orderError } = await admin.from("contact_card_orders").insert({
      id: orderId,
      owner_user_id: user.id,
      profile_id: profile.id,
      order_type: product,
      quantity: definition.quantity,
      amount_cents: definition.amount,
    });
    if (orderError) throw new Error(orderError.message);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ...(entitlement?.stripe_customer_id
          ? { customer: entitlement.stripe_customer_id }
          : { customer_email: user.email || undefined, customer_creation: "always" }),
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        client_reference_id: profile.id,
        success_url: `${origin}/client-portal/contact-card/?checkout=success&product=${product}`,
        cancel_url: `${origin}/client-portal/contact-card/?checkout=canceled`,
        ...(definition.quantity > 0 ? { shipping_address_collection: { allowed_countries: ["US", "CA"] } } : {}),
        metadata: {
          app: "n3xra_contact_card",
          order_id: orderId,
          owner_user_id: user.id,
          profile_id: profile.id,
          product,
          quantity: String(definition.quantity),
        },
      });

      await admin.from("contact_card_orders").update({ stripe_checkout_session_id: session.id }).eq("id", orderId);
      return jsonResponse({ url: session.url }, 200, origin);
    } catch (error) {
      await admin.from("contact_card_orders").delete().eq("id", orderId);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout could not be started.";
    console.error("contact-card-billing failed:", message);
    return jsonResponse({ error: message }, 500, getAppOrigin(request));
  }
});
