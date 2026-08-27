import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { STRIPE_API_VERSION, corsHeaders, getAppOrigin, jsonResponse } from "../_shared/stripe-billing.ts";

type ProductKey = "base" | "branding_removal" | "additional_card" | "three_pack";

const PRODUCTS: Record<ProductKey, { env: string; amount: number; quantity: number }> = {
  base: { env: "STRIPE_PRICE_CONTACT_CARD_BASE", amount: 1999, quantity: 1 },
  branding_removal: { env: "STRIPE_PRICE_CONTACT_CARD_BRANDING_REMOVAL", amount: 999, quantity: 0 },
  additional_card: { env: "STRIPE_PRICE_CONTACT_CARD_ADDITIONAL", amount: 799, quantity: 1 },
  three_pack: { env: "STRIPE_PRICE_CONTACT_CARD_THREE_PACK", amount: 1999, quantity: 3 },
};

function serviceKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
}

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe is not configured.");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
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
    const product = String(input.product || "") as ProductKey;
    const definition = PRODUCTS[product];
    if (!definition) return jsonResponse({ error: "Choose a valid Contact Card purchase." }, 400, origin);

    const { data: profile, error: profileError } = await admin
      .from("contact_card_profiles")
      .select("id, owner_user_id, display_name")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) return jsonResponse({ error: "Set up your Contact Card details before checkout." }, 400, origin);

    const { data: entitlement } = await admin
      .from("contact_card_entitlements")
      .select("base_access, branding_removal, stripe_customer_id")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (product === "base" && entitlement?.base_access) return jsonResponse({ error: "This Contact Card is already active." }, 400, origin);
    if (product === "branding_removal" && entitlement?.branding_removal) return jsonResponse({ error: "Branding removal is already active." }, 400, origin);
    if (product !== "base" && !entitlement?.base_access) return jsonResponse({ error: "Activate your Contact Card first." }, 400, origin);

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

    const stripe = stripeClient();
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
