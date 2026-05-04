import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  STRIPE_API_VERSION,
  corsHeaders,
  getAppOrigin,
} from "../_shared/stripe-billing.ts";
import {
  getMusicAccountStatus,
  getMusicPlanIdFromPriceId,
  getMusicPlanState,
} from "../_shared/music-billing.ts";

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
  const secret = Deno.env.get("STRIPE_MUSIC_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    throw new Error("Missing STRIPE_MUSIC_WEBHOOK_SECRET.");
  }
  return secret;
}

function getSubscriptionCustomerId(subscription: StripeSubscription) {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
}

function getSubscriptionPriceId(subscription: StripeSubscription) {
  return subscription.items.data[0]?.price?.id || null;
}

function getSubscriptionPeriodStart(subscription: StripeSubscription) {
  return subscription.current_period_start || subscription.items.data[0]?.current_period_start || null;
}

function getSubscriptionPeriodEnd(subscription: StripeSubscription) {
  return subscription.current_period_end || subscription.items.data[0]?.current_period_end || subscription.cancel_at || null;
}

function isMusicSubscription(subscription: StripeSubscription) {
  const app = String(subscription.metadata?.app || "").trim().toLowerCase();
  return app === "ai_music" || Boolean(getMusicPlanIdFromPriceId(getSubscriptionPriceId(subscription)));
}

async function ensureMusicProfile(adminClient: ReturnType<typeof createClient>, userId: string) {
  const { error } = await adminClient
    .from("music_profiles")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(error.message);
  }
}

async function loadMusicUserId(adminClient: ReturnType<typeof createClient>, subscription: StripeSubscription) {
  const metadataUserId = String(subscription.metadata?.user_id || subscription.metadata?.n3xra_user_id || "").trim();
  if (metadataUserId) return metadataUserId;

  const customerId = getSubscriptionCustomerId(subscription);
  if (!customerId) return null;

  const { data, error } = await adminClient
    .from("music_profiles")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.user_id || null;
}

async function syncMusicSubscription(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  subscription: StripeSubscription | null
) {
  if (!userId) return;
  await ensureMusicProfile(adminClient, userId);

  const now = new Date();

  if (!subscription) {
    const freeState = getMusicPlanState("free");
    const next = new Date(now);
    next.setUTCMonth(next.getUTCMonth() + 1);

    const { error } = await adminClient
      .from("music_profiles")
      .update({
        ...freeState,
        account_status: "active",
        songs_used: 0,
        current_period_start: now.toISOString(),
        current_period_end: next.toISOString(),
        stripe_subscription_id: null,
        stripe_price_id: null,
        cancel_at_period_end: false,
        subscription_current_period_end: null,
      })
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const customerId = getSubscriptionCustomerId(subscription);
  const priceId = getSubscriptionPriceId(subscription);
  const planId = getMusicPlanIdFromPriceId(priceId);
  const planState = getMusicPlanState(planId);
  const periodStartSeconds = getSubscriptionPeriodStart(subscription);
  const periodEndSeconds = getSubscriptionPeriodEnd(subscription);
  const periodStart = periodStartSeconds ? new Date(periodStartSeconds * 1000) : now;
  const periodEnd = periodEndSeconds ? new Date(periodEndSeconds * 1000) : new Date(periodStart);
  if (!periodEndSeconds) periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  const { data: existing, error: loadError } = await adminClient
    .from("music_profiles")
    .select("current_period_end")
    .eq("user_id", userId)
    .single();

  if (loadError) {
    throw new Error(loadError.message);
  }

  const existingPeriodEnd = existing?.current_period_end ? new Date(existing.current_period_end) : null;
  const shouldResetUsage =
    !existingPeriodEnd ||
    Number.isNaN(existingPeriodEnd.getTime()) ||
    Math.abs(existingPeriodEnd.getTime() - periodEnd.getTime()) > 1000;

  const updates: Record<string, unknown> = {
    ...planState,
    account_status: getMusicAccountStatus(subscription.status),
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    subscription_current_period_end: periodEnd.toISOString(),
  };

  if (shouldResetUsage) updates.songs_used = 0;

  const { error } = await adminClient
    .from("music_profiles")
    .update(updates)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

async function handleCheckoutCompleted(adminClient: ReturnType<typeof createClient>, stripe: Stripe, session: Stripe.Checkout.Session) {
  const app = String(session.metadata?.app || "").trim().toLowerCase();
  if (app !== "ai_music") return;

  const userId = String(session.metadata?.user_id || session.client_reference_id || "").trim();
  if (!userId) return;

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  if (customerId) {
    await ensureMusicProfile(adminClient, userId);
    const { error } = await adminClient
      .from("music_profiles")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", userId);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (typeof session.subscription === "string" && session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    await syncMusicSubscription(adminClient, userId, subscription);
  }
}

async function handleSubscriptionEvent(
  adminClient: ReturnType<typeof createClient>,
  subscription: StripeSubscription,
  deleted = false
) {
  if (!isMusicSubscription(subscription)) return;

  const userId = await loadMusicUserId(adminClient, subscription);
  await syncMusicSubscription(adminClient, userId || "", deleted ? null : subscription);
}

async function handleInvoicePaymentSucceeded(adminClient: ReturnType<typeof createClient>, stripe: Stripe, invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || null;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await handleSubscriptionEvent(adminClient, subscription, false);
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
        await handleCheckoutCompleted(adminClient, stripe, event.data.object as Stripe.Checkout.Session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await handleSubscriptionEvent(adminClient, event.data.object as StripeSubscription, false);
        break;
      }
      case "customer.subscription.deleted": {
        await handleSubscriptionEvent(adminClient, event.data.object as StripeSubscription, true);
        break;
      }
      case "invoice.payment_succeeded": {
        await handleInvoicePaymentSucceeded(adminClient, stripe, event.data.object as Stripe.Invoice);
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
    const message = error instanceof Error ? error.message : "Unexpected AI Music Stripe webhook error.";
    console.error("music-stripe-webhook failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      },
    });
  }
});
