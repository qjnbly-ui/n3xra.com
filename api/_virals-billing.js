const crypto = require("crypto");

const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const APP_ORIGIN = String(process.env.APP_ORIGIN || process.env.N3XRA_APP_ORIGIN || "https://n3xra.com").replace(/\/+$/, "");

const VIRALS_PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    monthlyAnalysisLimit: 5,
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceLabel: "$9/mo",
    monthlyAnalysisLimit: 75,
    priceEnv: "STRIPE_PRICE_VIRALS_STARTER",
  },
  creator: {
    id: "creator",
    name: "Creator",
    priceLabel: "$19/mo",
    monthlyAnalysisLimit: 250,
    priceEnv: "STRIPE_PRICE_VIRALS_CREATOR",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceLabel: "$39/mo",
    monthlyAnalysisLimit: 750,
    priceEnv: "STRIPE_PRICE_VIRALS_PRO",
  },
  agency: {
    id: "agency",
    name: "Agency",
    priceLabel: "$99/mo",
    monthlyAnalysisLimit: 2500,
    priceEnv: "STRIPE_PRICE_VIRALS_AGENCY",
  },
};

const CREATOR_PROGRAMS = {
  standard: {
    id: "standard",
    name: "Standard Creator",
    commissionRate: 0.2,
  },
  founding: {
    id: "founding",
    name: "Founding Creator",
    commissionRate: 0.3,
    maxApproved: 25,
  },
};

const CUSTOMER_PROMO_DISCOUNT_PERCENT = 10;
const CUSTOMER_PROMO_DISCOUNT_MONTHS = 3;

function getPlan(planId) {
  return VIRALS_PLANS[String(planId || "").trim().toLowerCase()] || VIRALS_PLANS.free;
}

function requirePaidPlan(planId) {
  const plan = getPlan(planId);
  if (!plan.priceEnv) throw new Error("planId must be starter, creator, pro, or agency.");
  return plan;
}

function getPlanIdFromPriceId(priceId) {
  const id = String(priceId || "").trim();
  if (!id) return "free";
  for (const plan of Object.values(VIRALS_PLANS)) {
    if (plan.priceEnv && process.env[plan.priceEnv] === id) return plan.id;
  }
  return "free";
}

function requireStripeSecretKey() {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY.");
  return key;
}

function getOrigin(req) {
  const origin = String(req?.headers?.origin || "").trim();
  if (origin) return origin.replace(/\/+$/, "");
  const referer = String(req?.headers?.referer || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return APP_ORIGIN;
    }
  }
  return APP_ORIGIN;
}

function normalizePromoCode(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "")
    .slice(0, 32)
    .toUpperCase();
}

function toFormBody(payload, prefix = "") {
  const pairs = [];
  for (const [key, value] of Object.entries(payload || {})) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        pairs.push(...toFormBody(item, `${name}[${index}]`));
      });
      continue;
    }
    if (typeof value === "object") {
      pairs.push(...toFormBody(value, name));
      continue;
    }
    pairs.push([name, String(value)]);
  }
  return pairs;
}

async function stripeRequest(path, { method = "GET", body = null, idempotencyKey = "" } = {}) {
  const headers = {
    Authorization: `Bearer ${requireStripeSecretKey()}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  const options = { method, headers };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(toFormBody(body)).toString();
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Stripe request failed with status ${response.status}.`);
  }
  return data;
}

function verifyStripeWebhookSignature(rawBody, signatureHeader) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET_VIRALS || process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET_VIRALS.");
  const header = String(signatureHeader || "");
  const timestamp = header
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("t="))
    ?.slice(2);
  const signatures = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || !signatures.length) throw new Error("Invalid Stripe signature header.");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const valid = signatures.some((signature) => {
    const received = Buffer.from(signature, "hex");
    return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer);
  });
  if (!valid) throw new Error("Invalid Stripe webhook signature.");
}

function getSubscriptionPeriodStart(subscription) {
  return subscription?.current_period_start || subscription?.items?.data?.[0]?.current_period_start || null;
}

function getSubscriptionPeriodEnd(subscription) {
  return subscription?.current_period_end || subscription?.items?.data?.[0]?.current_period_end || subscription?.cancel_at || null;
}

function getAccountStatus(subscriptionStatus) {
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

module.exports = {
  APP_ORIGIN,
  CREATOR_PROGRAMS,
  CUSTOMER_PROMO_DISCOUNT_MONTHS,
  CUSTOMER_PROMO_DISCOUNT_PERCENT,
  STRIPE_API_VERSION,
  VIRALS_PLANS,
  getAccountStatus,
  getOrigin,
  getPlan,
  getPlanIdFromPriceId,
  getSubscriptionPeriodEnd,
  getSubscriptionPeriodStart,
  normalizePromoCode,
  requirePaidPlan,
  stripeRequest,
  verifyStripeWebhookSignature,
};
