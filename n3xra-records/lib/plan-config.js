export const PLAN_ORDER = ["free", "starter", "organization"];

export const PLAN_CONFIG = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceLabel: "$0/month",
    yearlyPriceLabel: "$0/month",
    documentLimit: 25,
    userLimit: 1,
    storageLimitMb: 512,
    aiMonthlyRequestLimit: 20,
    aiMonthlyTokenLimit: 100000,
    embedAllowed: false,
    summary: "A simple private archive for getting started.",
    features: [
      "25 private documents",
      "1 user",
      "512 MB storage",
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
    documentLimit: 250,
    userLimit: 1,
    storageLimitMb: 4096,
    aiMonthlyRequestLimit: 200,
    aiMonthlyTokenLimit: 1000000,
    embedAllowed: false,
    summary: "More room for a single-user archive that needs more storage.",
    features: [
      "250 private documents",
      "1 user",
      "4 GB storage",
      "200 Records AI requests/month",
      "Larger private archive",
      "No public embed",
    ],
  },
  organization: {
    id: "organization",
    name: "Organization",
    monthlyPriceLabel: "$39/month",
    yearlyPriceLabel: "$375/year",
    yearlyNote: "20% off",
    documentLimit: 2500,
    userLimit: 10,
    storageLimitMb: 10240,
    aiMonthlyRequestLimit: 1000,
    aiMonthlyTokenLimit: 5000000,
    embedAllowed: true,
    summary: "Shared records management for active teams.",
    features: [
      "2,500 private documents",
      "Up to 10 users",
      "10 GB storage",
      "1,000 Records AI requests/month",
      "Shared libraries and invite codes",
      "Dedicated public records URL",
      "Embedded search and records view",
      "Transcript preview and public-ready publishing controls",
      "Built for larger ongoing archives and team workflows",
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
