export const PLAN_ORDER = ["free", "starter", "organization"];

export const PLAN_CONFIG = {
  free: {
    id: "free",
    name: "Free",
    priceLabel: "$0/month",
    documentLimit: 25,
    userLimit: 1,
    storageLimitMb: 512,
    embedAllowed: false,
    summary: "A simple private archive for getting started.",
    features: [
      "25 private documents",
      "1 user",
      "512 MB storage",
      "Email/password sign-in",
      "Upload, search, preview, download",
      "No public embed",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceLabel: "$12/month",
    documentLimit: 250,
    userLimit: 1,
    storageLimitMb: 4096,
    embedAllowed: false,
    summary: "More room for a single-user archive that needs more storage.",
    features: [
      "250 private documents",
      "1 user",
      "4 GB storage",
      "Larger private archive",
      "No public embed",
    ],
  },
  organization: {
    id: "organization",
    name: "Organization",
    priceLabel: "$39/month",
    documentLimit: 2500,
    userLimit: 10,
    storageLimitMb: 10240,
    embedAllowed: true,
    summary: "Shared records management for active teams.",
    features: [
      "2,500 private documents",
      "Up to 10 users",
      "10 GB storage",
      "Shared libraries and invite codes",
      "Dedicated public records URL",
      "Embedded search and records view",
      "Transcript preview and public-ready publishing controls",
      "Built for larger ongoing archives and team workflows",
    ],
  },
};

export function getPlanConfig(planId) {
  return PLAN_CONFIG[planId] || PLAN_CONFIG.free;
}

export function formatPlanName(planId) {
  return getPlanConfig(planId).name;
}
