export const PLAN_ORDER = ["free", "starter", "organization"];

export const PLAN_CONFIG = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceLabel: "$0/month",
    yearlyPriceLabel: "$0/month",
    documentLimit: 25,
    userLimit: 1,
    storageLimitMb: 1024,
    aiMonthlyRequestLimit: 20,
    aiMonthlyTokenLimit: 100000,
    embedAllowed: false,
    summary: "A private records library for trying the core workflow.",
    features: [
      "25 private documents",
      "1 user",
      "1 GB storage",
      "20 Records AI requests/month",
      "Email/password sign-in",
      "Upload, search, preview, download",
      "No public embed",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPriceLabel: "$12/month",
    yearlyPriceLabel: "$115/year",
    yearlyNote: "20% off",
    documentLimit: 1000,
    userLimit: 1,
    storageLimitMb: 10240,
    aiMonthlyRequestLimit: 300,
    aiMonthlyTokenLimit: 1500000,
    embedAllowed: false,
    summary: "A stronger private archive for solo operators and small offices.",
    features: [
      "1,000 private documents",
      "1 user",
      "10 GB storage",
      "300 Records AI requests/month",
      "Room for scanned files, PDFs, images, and recordings",
      "No public embed",
    ],
  },
  organization: {
    id: "organization",
    name: "Organization",
    monthlyPriceLabel: "$39/month",
    yearlyPriceLabel: "$375/year",
    yearlyNote: "20% off",
    documentLimit: 10000,
    userLimit: 15,
    storageLimitMb: 51200,
    aiMonthlyRequestLimit: 1500,
    aiMonthlyTokenLimit: 7500000,
    embedAllowed: true,
    summary: "Team records management with publishing and public access tools.",
    features: [
      "10,000 private documents",
      "Up to 15 users",
      "50 GB storage",
      "1,500 Records AI requests/month",
      "Shared libraries and invite codes",
      "Dedicated public records URL",
      "Embedded search and records view",
      "Transcript preview and public-ready publishing controls",
      "Built for active archives, public records workflows, and teams",
    ],
  },
};

export function getPlanConfig(planId, billingCycle = "monthly") {
  const plan = PLAN_CONFIG[planId] || PLAN_CONFIG.free;
  const normalizedCycle = billingCycle === "yearly" ? "yearly" : "monthly";
  return {
    ...plan,
    billingCycle: normalizedCycle,
    priceLabel: normalizedCycle === "yearly" ? (plan.yearlyPriceLabel || plan.monthlyPriceLabel) : plan.monthlyPriceLabel,
    priceNote: normalizedCycle === "yearly" ? (plan.yearlyNote || "") : "",
  };
}

export function formatPlanName(planId) {
  return getPlanConfig(planId).name;
}
