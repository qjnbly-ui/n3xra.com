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
    priceLabel: "$24/month",
    documentLimit: 250,
    userLimit: 6,
    storageLimitMb: 4096,
    embedAllowed: false,
    summary: "More room for active boards and recurring record sets.",
    features: [
      "250 private documents",
      "Up to 6 users",
      "4 GB storage",
      "Shared libraries and invite codes",
      "No public embed",
    ],
  },
  organization: {
    id: "organization",
    name: "Organization",
    priceLabel: "$89/month",
    documentLimit: 2500,
    userLimit: 20,
    storageLimitMb: 20480,
    embedAllowed: true,
    summary: "Higher-volume records management with room to grow.",
    features: [
      "2,500 private documents",
      "Up to 20 users",
      "20 GB storage",
      "Embedded search and records view",
      "Transcript preview and public-ready publishing controls",
      "Built for larger ongoing archives",
    ],
  },
};

export function getPlanConfig(planId) {
  return PLAN_CONFIG[planId] || PLAN_CONFIG.free;
}

export function formatPlanName(planId) {
  return getPlanConfig(planId).name;
}
