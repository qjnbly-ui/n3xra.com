import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  STRIPE_API_VERSION,
  corsHeaders,
  getAppOrigin,
  jsonResponse,
} from "../_shared/stripe-billing.ts";
import { requireMusicPriceId } from "../_shared/music-billing.ts";

type SharedProfileRecord = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type MusicProfileRecord = {
  user_id: string;
  display_name: string | null;
  plan: string;
  account_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

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

async function loadSharedProfile(
  adminClient: ReturnType<typeof createClient>,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }
) {
  const fullName = String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim();
  const profilePayload: Record<string, unknown> = {
    id: user.id,
    email: user.email || null,
  };
  if (fullName) profilePayload.full_name = fullName;

  const { error: upsertError } = await adminClient
    .from("profiles")
    .upsert(profilePayload, { onConflict: "id", ignoreDuplicates: false });

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const { data, error } = await adminClient
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Profile not found.");
  }

  return data as SharedProfileRecord;
}

async function ensureMusicProfile(
  adminClient: ReturnType<typeof createClient>,
  user: { id: string; user_metadata?: Record<string, unknown> }
) {
  const displayName = String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim() || null;

  const { error: insertError } = await adminClient
    .from("music_profiles")
    .upsert(
      {
        user_id: user.id,
        display_name: displayName,
      },
      { onConflict: "user_id", ignoreDuplicates: true }
    );

  if (insertError) {
    throw new Error(insertError.message);
  }

  const { data, error } = await adminClient
    .from("music_profiles")
    .select("user_id, display_name, plan, account_status, stripe_customer_id, stripe_subscription_id")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "AI Music profile not found.");
  }

  return data as MusicProfileRecord;
}

async function attachMusicCustomer(adminClient: ReturnType<typeof createClient>, userId: string, customerId: string) {
  const { error } = await adminClient
    .from("music_profiles")
    .update({ stripe_customer_id: customerId })
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

async function getOrCreateMusicCustomer(
  adminClient: ReturnType<typeof createClient>,
  stripe: Stripe,
  user: { id: string; email?: string | null },
  profile: SharedProfileRecord,
  musicProfile: MusicProfileRecord
) {
  if (musicProfile.stripe_customer_id) return musicProfile.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email || profile.email || undefined,
    name: musicProfile.display_name || profile.full_name || user.email || undefined,
    metadata: {
      app: "ai_music",
      n3xra_user_id: user.id,
    },
  });

  await attachMusicCustomer(adminClient, user.id, customer.id);
  return customer.id;
}

Deno.serve(async (request) => {
  const origin = getAppOrigin(request);
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = getServiceRoleKey();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(
        { error: "Supabase environment variables are missing. Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY." },
        500,
        origin
      );
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header." }, 401, origin);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: userError?.message || "Unable to resolve user." }, 401, origin);
    }

    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "").trim();
    if (!["create-checkout-session", "create-portal-session"].includes(action)) {
      return jsonResponse({ error: "Unsupported AI Music billing action." }, 400, origin);
    }

    const stripe = getStripeClient();
    const profile = await loadSharedProfile(adminClient, user);
    const musicProfile = await ensureMusicProfile(adminClient, user);

    if (action === "create-checkout-session") {
      const customerId = await getOrCreateMusicCustomer(adminClient, stripe, user, profile, musicProfile);
      const planId = String(payload.planId || "").trim().toLowerCase();
      const priceId = requireMusicPriceId(planId);
      const currentPlan = String(musicProfile.plan || "free").trim().toLowerCase();
      const currentStatus = String(musicProfile.account_status || "active").trim().toLowerCase();

      if (["creator", "studio"].includes(currentPlan) && currentStatus !== "canceled") {
        return jsonResponse({ error: "Existing AI Music subscriptions should be managed in the Stripe billing portal." }, 400, origin);
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        client_reference_id: user.id,
        success_url: `${origin}/ai-music-generator/app/?billing=success`,
        cancel_url: `${origin}/ai-music-generator/app/?billing=canceled`,
        metadata: {
          app: "ai_music",
          user_id: user.id,
          plan_id: planId,
        },
        subscription_data: {
          metadata: {
            app: "ai_music",
            user_id: user.id,
            plan_id: planId,
          },
        },
      });

      return jsonResponse({ url: session.url }, 200, origin);
    }

    if (!musicProfile.stripe_customer_id) {
      return jsonResponse({ error: "No Stripe customer is attached to this AI Music account yet." }, 400, origin);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: musicProfile.stripe_customer_id,
      return_url: `${origin}/ai-music-generator/app/?billing=portal`,
    });

    return jsonResponse({ url: session.url }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected AI Music billing error.";
    console.error("music-billing failed:", message);
    return jsonResponse({ error: message }, 500, getAppOrigin(request));
  }
});
