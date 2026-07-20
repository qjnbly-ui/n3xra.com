const fs = require("fs/promises");
const path = require("path");

const PAGES = [
  { route: "/", file: "index.html" },
  { route: "/account", file: "account/index.html" },
  { route: "/client-portal", file: "client-portal/index.html" },
  { route: "/website-request", file: "website-request/index.html" },
  { route: "/proposals", file: "proposals/index.html" },
  { route: "/website-onboarding", file: "website-onboarding/index.html" },
  { route: "/project-workspace", file: "project-workspace/index.html" },
  { route: "/records", file: "records/index.html" },
  { route: "/n3xra-records", file: "n3xra-records/index.html" },
  { route: "/services", file: "services/index.html" },
  { route: "/projects", file: "projects/index.html" },
  { route: "/ai-music-generator", file: "ai-music-generator/index.html" },
  { route: "/virals", file: "virals/index.html" },
  { route: "/utilities", file: "utilities/index.html" },
  { route: "/partners", file: "partners/index.html" },
  { route: "/demo", file: "demo/index.html" },
  { route: "/support", file: "support/index.html" },
  { route: "/terms", file: "terms/index.html" },
  { route: "/privacy", file: "privacy/index.html" },
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
    .replace(/&#39;/gi, "'");
}

function extractImportantContent(html) {
  const source = String(html || "");
  const cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const blocks = [];
  const patterns = [
    /<title[^>]*>([\s\S]*?)<\/title>/gi,
    /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/gi,
    /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi,
    /<p[^>]*>([\s\S]*?)<\/p>/gi,
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(cleaned)) !== null) {
      const text = decodeHtmlEntities(htmlToText(match[1]));
      if (!text) continue;
      if (text.length < 12) continue;
      blocks.push(text);
      if (blocks.length >= 120) break;
    }
    if (blocks.length >= 120) break;
  }

  return blocks.join("\n").slice(0, 6500);
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
      content,
    });
  }

  const payload = {
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
