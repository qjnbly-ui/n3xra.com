import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  STRIPE_API_VERSION,
  PLAN_TO_PRICE_ENV,
  corsHeaders,
  getAppOrigin,
  jsonResponse,
} from "../_shared/stripe-billing.ts";

type OrganizationRecord = {
  id: string;
  name: string;
  owner_user_id: string;
  subscription_tier: string;
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

function getRecordsPortalConfiguration() {
  const configuration = Deno.env.get("STRIPE_RECORDS_PORTAL_CONFIGURATION");
  if (!configuration) {
    throw new Error("Missing STRIPE_RECORDS_PORTAL_CONFIGURATION.");
  }
  return configuration;
}

function getServiceRoleKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
}

function isPlatformAdmin(email: string | null | undefined) {
  return ["quentin@n3xra.com", "quentin@quentinnichols.com"].includes(String(email || "").toLowerCase());
}

function requirePriceId(planId: string, billingCycle: string) {
  const planPrices = PLAN_TO_PRICE_ENV[planId as keyof typeof PLAN_TO_PRICE_ENV];
  if (!planPrices) {
    throw new Error("Unsupported Stripe plan.");
  }

  const normalizedCycle = billingCycle === "yearly" ? "yearly" : "monthly";
  const envName = planPrices[normalizedCycle];
  const priceId = Deno.env.get(envName);
  if (!priceId) {
    throw new Error(`Missing ${envName}.`);
  }

  return priceId;
}

async function loadOrganization(adminClient: ReturnType<typeof createClient>, organizationId: string) {
  const { data, error } = await adminClient
    .from("organizations")
    .select("id, name, owner_user_id, subscription_tier, stripe_customer_id, stripe_subscription_id")
    .eq("id", organizationId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Organization not found.");
  }

  return data as OrganizationRecord;
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
    const action = String(payload.action || "");
    const organizationId = String(payload.organizationId || "").trim();

    if (!organizationId) {
      return jsonResponse({ error: "organizationId is required." }, 400, origin);
    }

    const organization = await loadOrganization(adminClient, organizationId);
    if (organization.owner_user_id !== user.id && !isPlatformAdmin(user.email)) {
      return jsonResponse({ error: "Only the account owner or platform admin can manage billing." }, 403, origin);
    }

    const stripe = getStripeClient();
    const portalConfiguration = getRecordsPortalConfiguration();
    const accountUrl = `${origin}/n3xra-records/account`;
    const returnUrl = `${accountUrl}?billing=portal`;

    if (action === "create-checkout-session") {
      const planId = String(payload.planId || "").trim();
      const billingCycle = String(payload.billingCycle || "monthly").trim().toLowerCase();
      if (!["starter", "organization"].includes(planId)) {
        return jsonResponse({ error: "planId must be starter or organization." }, 400, origin);
      }
      if (!["monthly", "yearly"].includes(billingCycle)) {
        return jsonResponse({ error: "billingCycle must be monthly or yearly." }, 400, origin);
      }

      if (organization.subscription_tier !== "free" || organization.stripe_subscription_id) {
        return jsonResponse({ error: "Existing subscriptions should be managed in the Stripe billing portal." }, 400, origin);
      }

      const priceId = requirePriceId(planId, billingCycle);
      let customerId = organization.stripe_customer_id;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          name: organization.name,
          metadata: {
            app: "n3xra_records",
            organization_id: organization.id,
            owner_user_id: organization.owner_user_id,
          },
        });
        customerId = customer.id;

        const { error: updateError } = await adminClient
          .from("organizations")
          .update({
            stripe_customer_id: customerId,
          })
          .eq("id", organization.id);
        if (updateError) {
          throw new Error(updateError.message);
        }
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
        client_reference_id: organization.id,
        success_url: `${accountUrl}?billing=success`,
        cancel_url: `${accountUrl}?billing=canceled`,
        metadata: {
          app: "n3xra_records",
          organization_id: organization.id,
          plan_id: planId,
          billing_cycle: billingCycle,
        },
        subscription_data: {
          metadata: {
            app: "n3xra_records",
            organization_id: organization.id,
            plan_id: planId,
            billing_cycle: billingCycle,
          },
        },
      });

      return jsonResponse({ url: session.url }, 200, origin);
    }

    if (action === "create-portal-session") {
      if (!organization.stripe_customer_id) {
        return jsonResponse({ error: "No Stripe customer is attached to this organization yet." }, 400, origin);
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: organization.stripe_customer_id,
        configuration: portalConfiguration,
        return_url: returnUrl,
      });

      return jsonResponse({ url: session.url }, 200, origin);
    }

    return jsonResponse({ error: "Unsupported billing action." }, 400, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Stripe billing error.";
    console.error("stripe-billing failed:", message);
    return jsonResponse({ error: message }, 500, getAppOrigin(request));
  }
});
