const fs = require("fs/promises");
const path = require("path");

const PAGES = [
  { route: "/", file: "index.html", visibility: "public", tags: ["home", "ask n3xra", "software", "services"] },
  { route: "/services", file: "services/index.html", visibility: "public", tags: ["websites", "pricing", "automation", "integrations"] },
  { route: "/projects", file: "projects/index.html", visibility: "public", tags: ["portfolio", "examples", "websites"] },
  { route: "/records", file: "records/index.html", visibility: "public", tags: ["records", "documents", "files", "meeting notes", "public records"] },
  { route: "/n3xra-records", file: "n3xra-records/index.html", visibility: "public", tags: ["records app", "records login"] },
  { route: "/ai-music-generator", file: "ai-music-generator/index.html", visibility: "public", tags: ["music", "songs", "lyrics", "ai music"] },
  { route: "/virals", file: "virals/index.html", visibility: "public", tags: ["virals", "tiktok", "video analysis", "scripts"] },
  { route: "/virals/about", file: "virals/about/index.html", visibility: "public", tags: ["virals", "about", "video analysis"] },
  { route: "/virals/most-searched-videos", file: "virals/most-searched-videos/index.html", visibility: "public", tags: ["virals", "search", "videos"] },
  { route: "/virals/saved-scripts", file: "virals/saved-scripts/index.html", visibility: "public", tags: ["virals", "saved scripts"] },
  { route: "/virals/todays-top-creators", file: "virals/todays-top-creators/index.html", visibility: "public", tags: ["virals", "creators"] },
  { route: "/virals/todays-viral-videos", file: "virals/todays-viral-videos/index.html", visibility: "public", tags: ["virals", "viral videos"] },
  { route: "/virals/top-shop-products", file: "virals/top-shop-products/index.html", visibility: "public", tags: ["virals", "shop products"] },
  { route: "/utilities", file: "utilities/index.html", visibility: "public", tags: ["utilities", "operations", "customer portal"] },
  { route: "/partners", file: "partners/index.html", visibility: "public", tags: ["partners", "referrals", "commissions", "application"] },
  { route: "/partners/terms", file: "partners/terms/index.html", visibility: "public", tags: ["partners", "terms", "commissionable net revenue", "referral eligibility"] },
  { route: "/partners/change-of-control", file: "partners/change-of-control/index.html", visibility: "public", tags: ["partners", "change of control", "commissions"] },
  { route: "/support", file: "support/index.html", visibility: "public", tags: ["support", "help", "contact"] },
  { route: "/terms", file: "terms/index.html", visibility: "public", tags: ["terms", "legal"] },
  { route: "/privacy", file: "privacy/index.html", visibility: "public", tags: ["privacy", "security", "data"] },
  { route: "/client-portal", file: "client-portal/index.html", visibility: "signed-in feature", tags: ["website portal", "client", "files", "project"] },
  { route: "/client-portal/services", file: "client-portal/services/index.html", visibility: "signed-in feature", tags: ["website service", "ownership", "domain"] },
  { route: "/client-portal/billing", file: "client-portal/billing/index.html", visibility: "signed-in feature", tags: ["website billing", "stripe", "invoice", "payment method", "subscription"] },
  { route: "/client-portal/partners", file: "client-portal/partners/index.html", visibility: "signed-in feature", tags: ["partner portal", "referral code", "balance", "commission"] },
  { route: "/website-request", file: "website-request/index.html", visibility: "customer workflow", tags: ["start project", "website request", "intake", "referral code"] },
  { route: "/proposals", file: "proposals/index.html", visibility: "signed-in feature", tags: ["proposal", "approve", "request changes", "investment"] },
  { route: "/website-onboarding", file: "website-onboarding/index.html", visibility: "signed-in feature", tags: ["website onboarding", "content", "brand", "domain"] },
  { route: "/project-workspace", file: "project-workspace/index.html", visibility: "signed-in feature", tags: ["project progress", "milestones", "website project"] },
  { route: "/n3xra-records/account", file: "n3xra-records/account/index.html", visibility: "signed-in feature", tags: ["records account", "support access", "roles", "billing"] },
  { route: "/n3xra-records/library", file: "n3xra-records/library/index.html", visibility: "signed-in feature", tags: ["records library", "documents", "search", "files"] },
  { route: "/n3xra-records/meeting-notes", file: "n3xra-records/meeting-notes/index.html", visibility: "signed-in feature", tags: ["meeting notes", "recording", "transcript"] },
  { route: "/n3xra-records/all-meeting-notes", file: "n3xra-records/all-meeting-notes/index.html", visibility: "signed-in feature", tags: ["meeting notes", "recordings", "history"] },
  { route: "/ai-music-generator/app", file: "ai-music-generator/app/index.html", visibility: "signed-in feature", tags: ["music app", "songs", "history", "usage"] },
];

const IGNORED_BLOCK_PATTERNS = [
  /^Connect Supabase$/i,
  /shared\/config\.js/i,
  /project URL and anon key/i,
  /^Explore N3XRA$/i,
  /^Follow Us On$/i,
  /^Custom websites, connected systems, and practical software\.?$/i,
  /^Built by Quentin Nichols/i,
  /^©|^&copy;/i,
  /Supabase/i,
  /row-level security/i,
  /storage policies/i,
  /service-level credentials/i,
  /server-side functions/i,
  /private keys? stay out of browser code/i,
  /database and file access use server-enforced policies/i,
];

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function extractImportantContent(html) {
  const source = String(html || "");
  const cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const blocks = [];
  const seen = new Set();
  const patterns = [
    /<title[^>]*>([\s\S]*?)<\/title>/gi,
    /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/gi,
    /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi,
    /<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    /<legend[^>]*>([\s\S]*?)<\/legend>/gi,
    /<label[^>]*>([\s\S]*?)<\/label>/gi,
    /<dt[^>]*>([\s\S]*?)<\/dt>/gi,
    /<dd[^>]*>([\s\S]*?)<\/dd>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(cleaned)) !== null) {
      const text = decodeHtmlEntities(htmlToText(match[1]));
      if (!text) continue;
      if (text.length < 12) continue;
      if (IGNORED_BLOCK_PATTERNS.some((pattern) => pattern.test(text))) continue;
      const key = text.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(text);
      if (blocks.length >= 140) break;
    }
    if (blocks.length >= 140) break;
  }

  return blocks.join("\n").slice(0, 3600);
}

async function build() {
  const root = path.resolve(__dirname, "..");
  const pages = [];

  for (const page of PAGES) {
    const fullPath = path.join(root, page.file);
    const html = await fs.readFile(fullPath, "utf8");
    const content = extractImportantContent(html);
    pages.push({
      route: page.route,
      file: page.file,
      visibility: page.visibility,
      tags: page.tags,
      content,
    });
  }

  const payload = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    pageCount: pages.length,
    pages,
  };

  const outputPath = path.join(root, "api", "site-knowledge.json");
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outputPath}\n`);
}

build().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
