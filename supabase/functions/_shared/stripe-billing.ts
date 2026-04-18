export const STRIPE_API_VERSION = "2026-02-25.clover";

export const PLAN_TO_PRICE_ENV = {
  starter: "STRIPE_PRICE_STARTER",
  organization: "STRIPE_PRICE_ORGANIZATION",
};

export function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function jsonResponse(body: Record<string, unknown>, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

export function getAppOrigin(request: Request) {
  const directOrigin = request.headers.get("Origin");
  if (directOrigin) return directOrigin;

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore invalid referrers.
    }
  }

  return Deno.env.get("APP_ORIGIN") || "https://n3xra.com";
}

export function getPlanIdFromPriceId(priceId: string | null | undefined) {
  if (!priceId) return "free";

  for (const [planId, envName] of Object.entries(PLAN_TO_PRICE_ENV)) {
    if (Deno.env.get(envName) === priceId) {
      return planId;
    }
  }

  return "free";
}

export function getPlanState(planId: string) {
  switch (planId) {
    case "starter":
      return {
        subscription_tier: "starter",
        document_limit: 250,
        user_limit: 1,
        storage_limit_mb: 4096,
      };
    case "organization":
      return {
        subscription_tier: "organization",
        document_limit: 2500,
        user_limit: 10,
        storage_limit_mb: 20480,
      };
    default:
      return {
        subscription_tier: "free",
        document_limit: 25,
        user_limit: 1,
        storage_limit_mb: 512,
      };
  }
}

export function getAccountStatus(subscriptionStatus: string | null | undefined) {
  switch (subscriptionStatus) {
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "active":
    case "incomplete":
    default:
      return "active";
  }
}
