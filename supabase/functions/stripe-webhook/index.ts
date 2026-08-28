import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  STRIPE_API_VERSION,
  corsHeaders,
  getAccountStatus,
  getAppOrigin,
  getPlanIdFromPriceId,
  getPlanState,
} from "../_shared/stripe-billing.ts";

type StripeSubscription = Stripe.Subscription;

function isRecordsPrice(priceId: string | null | undefined) {
  return Boolean(priceId && getPlanIdFromPriceId(priceId) !== "free");
}

function isRecordsSubscription(subscription: StripeSubscription) {
  const app = String(subscription.metadata?.app || "").trim().toLowerCase();
  if (app) return app === "n3xra_records";
  return isRecordsPrice(subscription.items.data[0]?.price?.id);
}

function isContactCardPremiumSubscription(subscription: StripeSubscription) {
  return String(subscription.metadata?.app || "").trim().toLowerCase() === "n3xra_contact_card_premium";
}

function getStripeClient() {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }

  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

function getServiceRoleKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
}

function getWebhookSecret() {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  }
  return secret;
}

async function loadOrganizationId(adminClient: ReturnType<typeof createClient>, subscription: StripeSubscription) {
  const metadataOrganizationId = String(subscription.metadata?.organization_id || "").trim();
  if (metadataOrganizationId) {
    return metadataOrganizationId;
  }

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) {
    return null;
  }

  const { data, error } = await adminClient
    .from("organizations")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id || null;
}

async function syncOrganizationSubscription(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  subscription: StripeSubscription | null
) {
  if (!organizationId) return;

  if (!subscription) {
    const freeState = getPlanState("free");
    const { error } = await adminClient
      .from("organizations")
      .update({
        ...freeState,
        account_status: "canceled",
        public_embed_enabled: false,
        stripe_subscription_id: null,
        stripe_price_id: null,
        billing_cycle: "monthly",
        cancel_at_period_end: false,
        subscription_current_period_end: null,
      })
      .eq("id", organizationId);

    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
  const priceId = subscription.items.data[0]?.price?.id || null;
  const planId = getPlanIdFromPriceId(priceId);
  const planState = getPlanState(planId);
  const billingCycle = String(subscription.metadata?.billing_cycle || "").trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
  const accountStatus = getAccountStatus(subscription.status);
  const cancelAtSeconds = subscription.cancel_at || null;
  const scheduledCancel =
    Boolean(subscription.cancel_at_period_end) ||
    (typeof cancelAtSeconds === "number" && cancelAtSeconds > 0 && accountStatus === "active");
  const periodEndSeconds =
    subscription.current_period_end ||
    subscription.items.data[0]?.current_period_end ||
    cancelAtSeconds ||
    null;
  const updates: Record<string, unknown> = {
    ...planState,
    account_status: accountStatus,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    billing_cycle: billingCycle,
    cancel_at_period_end: scheduledCancel,
    subscription_current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
  };

  if (planId !== "organization") {
    updates.public_embed_enabled = false;
  }

  const { error } = await adminClient
    .from("organizations")
    .update(updates)
    .eq("id", organizationId);

  if (error) {
    throw new Error(error.message);
  }
}

async function syncContactCardPremium(
  adminClient: ReturnType<typeof createClient>,
  subscription: StripeSubscription,
  deleted = false
) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
  const subscriptionOwner = String(subscription.metadata?.owner_user_id || "").trim();
  let lookup = adminClient
    .from("contact_card_entitlements")
    .select("owner_user_id,premium_started_at")
    .limit(1);
  lookup = subscriptionOwner
    ? lookup.eq("owner_user_id", subscriptionOwner)
    : lookup.eq("stripe_subscription_id", subscription.id);
  const { data: entitlement, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  const ownerUserId = subscriptionOwner || String(entitlement?.owner_user_id || "");
  if (!ownerUserId) throw new Error("Contact Card Premium subscription owner is missing.");

  const status = deleted ? "canceled" : String(subscription.status || "inactive");
  const premiumActive = !deleted && ["active", "trialing", "past_due"].includes(status);
  const price = subscription.items.data[0]?.price;
  const plan = String(subscription.metadata?.plan || "").trim().toLowerCase() === "monthly"
    ? "monthly"
    : String(subscription.metadata?.plan || "").trim().toLowerCase() === "yearly"
      ? "yearly"
      : price?.recurring?.interval === "month" ? "monthly" : "yearly";
  const periodEndSeconds = subscription.current_period_end || subscription.items.data[0]?.current_period_end || null;
  const updates: Record<string, unknown> = {
    premium_active: premiumActive,
    premium_status: status,
    premium_plan: plan,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: price?.id || null,
    premium_current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
    premium_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    source: "stripe",
  };
  if (premiumActive && !entitlement?.premium_started_at) updates.premium_started_at = new Date().toISOString();
  const { error } = await adminClient.from("contact_card_entitlements").update(updates).eq("owner_user_id", ownerUserId);
  if (error) throw new Error(error.message);
}

async function completeContactCardCheckout(
  adminClient: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session
) {
  const orderId = String(session.metadata?.order_id || "").trim();
  const ownerUserId = String(session.metadata?.owner_user_id || "").trim();
  const profileId = String(session.metadata?.profile_id || session.client_reference_id || "").trim();
  const product = String(session.metadata?.product || "").trim();
  if (!orderId || !ownerUserId || !profileId) throw new Error("Contact Card checkout metadata is incomplete.");

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  const now = new Date().toISOString();

  const { error: orderError } = await adminClient
    .from("contact_card_orders")
    .update({ status: "paid", stripe_payment_intent_id: paymentIntentId, paid_at: now })
    .eq("id", orderId);
  if (orderError) throw new Error(orderError.message);

  if (["base", "branding_removal"].includes(product)) {
    const entitlementUpdates: Record<string, unknown> = {
      owner_user_id: ownerUserId,
      stripe_customer_id: customerId,
      source: "stripe",
    };
    if (product === "base") {
      entitlementUpdates.base_access = true;
      entitlementUpdates.base_purchased_at = now;
    } else {
      entitlementUpdates.branding_removal = true;
      entitlementUpdates.branding_purchased_at = now;
    }
    const { error } = await adminClient.from("contact_card_entitlements").upsert(entitlementUpdates, { onConflict: "owner_user_id" });
    if (error) throw new Error(error.message);
  }

  if (product === "branding_removal") {
    const { error } = await adminClient.from("contact_card_profiles").update({ show_n3xra_branding: false }).eq("id", profileId);
    if (error) throw new Error(error.message);
  }

  if (product === "base") {
    const collected = session as unknown as { collected_information?: { shipping_details?: { name?: string | null; address?: Stripe.Address | null } } };
    const shipping = collected.collected_information?.shipping_details;
    const address = shipping?.address || session.customer_details?.address;
    const updates: Record<string, unknown> = {
      status: "published",
      physical_card_status: "requested",
      shipping_name: shipping?.name || session.customer_details?.name || "Contact Card customer",
      shipping_address_line_1: address?.line1 || "Address supplied at checkout",
      shipping_address_line_2: address?.line2 || "",
      shipping_city: address?.city || "City",
      shipping_region: address?.state || "Region",
      shipping_postal_code: address?.postal_code || "Postal code",
      shipping_country: address?.country || "United States",
    };
    const { error } = await adminClient.from("contact_card_profiles").update(updates).eq("id", profileId);
    if (error) throw new Error(error.message);
  }
}

Deno.serve(async (request) => {
  const origin = getAppOrigin(request);
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Supabase environment variables are missing." }), {
        status: 500,
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "application/json",
        },
      });
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing Stripe signature." }), {
        status: 400,
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "application/json",
        },
      });
    }

    const stripe = getStripeClient();
    const body = await request.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, getWebhookSecret());
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionApp = String(session.metadata?.app || "").trim().toLowerCase();
        if (sessionApp === "n3xra_contact_card_premium") {
          if (typeof session.subscription !== "string" || !session.subscription) throw new Error("Contact Card Premium subscription is missing.");
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await syncContactCardPremium(adminClient, subscription);
          break;
        }
        if (sessionApp === "n3xra_contact_card") {
          await completeContactCardCheckout(adminClient, session);
          break;
        }
        if (sessionApp && sessionApp !== "n3xra_records") break;
        if (!sessionApp && typeof session.subscription === "string") {
          const candidate = await stripe.subscriptions.retrieve(session.subscription);
          if (!isRecordsSubscription(candidate)) break;
        } else if (!sessionApp) {
          break;
        }
        const organizationId = String(session.metadata?.organization_id || session.client_reference_id || "").trim();
        if (!organizationId) break;

        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
        if (customerId) {
          const { error } = await adminClient
            .from("organizations")
            .update({ stripe_customer_id: customerId })
            .eq("id", organizationId);
          if (error) {
            throw new Error(error.message);
          }
        }

        if (typeof session.subscription === "string" && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await syncOrganizationSubscription(adminClient, organizationId, subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as StripeSubscription;
        if (isContactCardPremiumSubscription(subscription)) {
          await syncContactCardPremium(adminClient, subscription, event.type === "customer.subscription.deleted");
          break;
        }
        if (!isRecordsSubscription(subscription)) break;
        const organizationId = await loadOrganizationId(adminClient, subscription);
        await syncOrganizationSubscription(
          adminClient,
          organizationId || "",
          event.type === "customer.subscription.deleted" ? null : subscription
        );
        break;
      }
      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Stripe webhook error.";
    console.error("stripe-webhook failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      },
    });
  }
});
