export const MUSIC_PLAN_TO_PRICE_ENV = {
  creator: "STRIPE_PRICE_MUSIC_CREATOR",
  studio: "STRIPE_PRICE_MUSIC_STUDIO",
};

export function requireMusicPriceId(planId: string) {
  const normalizedPlan = String(planId || "").trim().toLowerCase();
  const envName = MUSIC_PLAN_TO_PRICE_ENV[normalizedPlan as keyof typeof MUSIC_PLAN_TO_PRICE_ENV];
  if (!envName) {
    throw new Error("planId must be creator or studio.");
  }

  const priceId = Deno.env.get(envName);
  if (!priceId) {
    throw new Error(`Missing ${envName}.`);
  }

  return priceId;
}

export function getMusicPlanIdFromPriceId(priceId: string | null | undefined) {
  if (!priceId) return null;

  for (const [planId, envName] of Object.entries(MUSIC_PLAN_TO_PRICE_ENV)) {
    if (Deno.env.get(envName) === priceId) {
      return planId;
    }
  }

  return null;
}

export function getMusicPlanState(planId: string | null | undefined) {
  switch (planId) {
    case "creator":
      return {
        plan: "creator",
        monthly_song_limit: 25,
      };
    case "studio":
      return {
        plan: "studio",
        monthly_song_limit: 100,
      };
    default:
      return {
        plan: "free",
        monthly_song_limit: 5,
      };
  }
}

export function getMusicAccountStatus(subscriptionStatus: string | null | undefined) {
  switch (subscriptionStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "past_due":
    case "unpaid":
    case "incomplete":
    default:
      return "past_due";
  }
}
