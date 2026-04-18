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
  const accountStatus = subscription.cancel_at_period_end ? "canceled" : getAccountStatus(subscription.status);
  const periodEndSeconds = subscription.current_period_end || null;
  const updates: Record<string, unknown> = {
    ...planState,
    account_status: accountStatus,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
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
