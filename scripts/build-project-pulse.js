const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "project-pulse", "manifest.json");
const SOURCE_EXTENSIONS = new Set([".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".sql"]);
const SKIP_FILES = new Set(["api/_private-code-index.generated.js"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".private-secrets",
  ".vercel",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

const PRODUCTS = [
  {
    id: "websites",
    name: "Websites & Client Services",
    route: "/services/",
    summary: "Custom websites, project intake, AI-assisted proposals, onboarding, branded client portals, asset delivery, billing, and ongoing client service.",
  },
  {
    id: "records",
    name: "N3XRA Records",
    route: "/records/",
    summary: "Searchable records, documents, communication, meeting notes, speaker-aware transcripts, phone-connected meeting capture, organization workspaces, and access controls.",
  },
  {
    id: "utilities",
    name: "N3XRA Utilities",
    route: "/utilities/",
    summary: "Operational portals, customer access, onboarding, workspaces, and administration for utility organizations.",
  },
  {
    id: "virals",
    name: "N3XRA Virals",
    route: "/virals/",
    summary: "Video analysis, comparisons, reusable frameworks, scripts, creator tools, and account workflows.",
  },
  {
    id: "music",
    name: "AI Music Generator",
    route: "/ai-music-generator/",
    summary: "Prompt-based song generation, account access, song history, audio processing, and usage controls.",
  },
  {
    id: "partners",
    name: "N3XRA Partners",
    route: "/partners/",
    summary: "Partner applications, referrals, commissions, attribution, onboarding, reporting, and administration.",
  },
  {
    id: "company",
    name: "N3XRA Company Platform",
    route: "/account/",
    summary: "Shared identity, customer dashboards, billing, support, AI receptionist, transactional messaging, careers, governance planning, and web and mobile administration.",
  },
];

const MAJOR_MODULES = [
  "Shared accounts and identity",
  "Customer and organization dashboards",
  "Administrative workspaces",
  "Website project lifecycle",
  "Website portals and asset delivery",
  "Records and document systems",
  "Phone-connected meeting workflows",
  "Speaker-aware meeting transcription",
  "Financial operations and reporting",
  "Subscriptions and billing",
  "Partner and referral programs",
  "AI receptionist, messaging, and support",
  "AI-assisted workflows",
  "Careers and applicant management",
  "Company governance planning",
];

const RECENT_CAPABILITIES = [
  {
    introducedBy: "b072cc8",
    date: "2026-08-10",
    title: "Clearer meeting upload and processing",
    summary: "N3XRA Records now gives users a focused, progress-aware save experience while uploaded or recorded meeting audio is securely prepared for review.",
  },
  {
    introducedBy: "16e2293",
    date: "2026-08-10",
    title: "Careers and applicant workspace",
    summary: "N3XRA now accepts structured career applications, optional résumés, and account-linked applicant details, then organizes submissions, notes, statuses, and follow-up in a dedicated talent workspace.",
  },
  {
    introducedBy: "2d30545",
    date: "2026-08-09",
    title: "Branded website management portals",
    summary: "Website clients can receive a management portal configured from their project context, with recommended branding, theme controls, approved logos and favicons, readiness checks, and controlled activation.",
  },
  {
    introducedBy: "b436625",
    date: "2026-08-09",
    title: "Connected website asset libraries",
    summary: "Website files and approved assets now move through shared, live-updating libraries with previews, organized uploads, optimized CDN delivery, and clearer access for clients and administrators.",
  },
  {
    introducedBy: "a7fe222",
    date: "2026-08-09",
    title: "Unified N3XRA administration",
    summary: "Company and product administration now share a more consistent account-connected workspace for customers, websites, applications, billing, support, operations, analytics, and platform access.",
  },
  {
    introducedBy: "27d0a67",
    date: "2026-08-09",
    title: "Review-first website proposals and agreements",
    summary: "Website proposals now move through a clearer onboarding-first drafting, revision, email preview, client approval, agreement, and billing-preparation workflow.",
  },
  {
    introducedBy: "877cacb",
    date: "2026-08-09",
    title: "Targeted customer update messaging",
    summary: "N3XRA administrators can prepare, preview, and send product-aware updates to selected customer audiences through account notifications or email.",
  },
  {
    introducedBy: "d53da2e",
    date: "2026-08-08",
    title: "Human-reviewed Proposal AI",
    summary: "Proposal AI can draft an entire website agreement or improve individual sections from approved intake, onboarding, project, and asset context, while keeping every suggested change subject to human review.",
  },
  {
    introducedBy: "c64d6e1",
    date: "2026-08-08",
    title: "Precision-first speaker identification",
    summary: "Records speaker identification now favors verified matches over uncertain guesses, reducing false assignments while preserving the human correction workflow.",
  },
  {
    introducedBy: "0395d03",
    date: "2026-08-08",
    title: "Mobile admin notifications with scoped review access",
    summary: "N3XRA added a mobile administration experience for secure notifications and introduced isolated reviewer access for approved app-review workflows.",
  },
  {
    introducedBy: "ed480de",
    date: "2026-08-07",
    title: "Guided website onboarding",
    summary: "Website customers now move through a focused, progress-aware onboarding workspace covering business details, brand direction, content, technical needs, legal and launch requirements, files, and final review.",
  },
  {
    introducedBy: "f849bea",
    date: "2026-08-07",
    title: "Private business information workspace",
    summary: "Authorized administrators can keep frequently used company identifiers, registration details, filing contacts, and supporting N3XRA Files together in one protected company record.",
  },
  {
    introducedBy: "49a2b4a",
    date: "2026-08-07",
    title: "Rebuilt website client workspace",
    summary: "Website services, progress, proposals, onboarding, assets, billing, renewals, and support now share one selected-project context and a more consistent client portal experience.",
  },
  {
    introducedBy: "d00f049",
    date: "2026-08-07",
    title: "More resilient website request management",
    summary: "The website project pipeline can now recover completed intake details, surface requests through the protected admin workflow, and remove recoverable intake records when appropriate.",
  },
  {
    introducedBy: "57e686b",
    date: "2026-08-07",
    title: "N3XRA Files and CDN publishing",
    summary: "A new internal file workspace supports multi-file and folder uploads, nested navigation, search, previews, approvals, downloads, and controlled publishing of approved assets to the N3XRA CDN.",
  },
  {
    introducedBy: "bb476c8",
    date: "2026-08-05",
    title: "A more focused administration inbox",
    summary: "Administrative notifications now prioritize decisions, exceptions, account changes, support requests, and items that need review while reducing routine activity noise.",
  },
  {
    introducedBy: "60fb027",
    date: "2026-08-05",
    title: "Shared Records workspace for administration",
    summary: "Authorized platform administrators can open a shared N3XRA Records workspace directly from their account while keeping product oversight tools separate.",
  },
  {
    introducedBy: "d085662",
    date: "2026-08-05",
    title: "Interruption-aware AI receptionist",
    summary: "Phone conversations now use sentence-sized speech, backchannel filtering, natural-pause tolerance, larger complete answers, and exact resume behavior when a caller interrupts and asks to continue.",
  },
  {
    introducedBy: "755d333",
    date: "2026-08-05",
    title: "Human-reviewed speaker identification",
    summary: "N3XRA Records now separates meetings into generic speakers, matches consenting members through optional voice profiles, and gives editors a branded correction workflow with short per-speaker audio samples for verification.",
  },
  {
    introducedBy: "84bb602",
    date: "2026-08-05",
    title: "Configurable, editable meeting minutes",
    summary: "Meeting workflows now support brief, standard, or detailed minutes, editable AI drafts, structured review, and a deliberate handoff into Document Builder before the final record is sent.",
  },
  {
    introducedBy: "0e707a0",
    date: "2026-08-05",
    title: "Secure record-packet transfers",
    summary: "Authorized administrators can invite another organization to accept a complete meeting packet, including its recording, transcript, notes, references, and generated documents, with prior share links revoked on transfer.",
  },
  {
    introducedBy: "c633e77",
    date: "2026-08-04",
    title: "Account-connected phone and messaging setup",
    summary: "N3XRA accounts now remember each customer's receptionist phone setup and messaging preference, show saved security status, and prompt incomplete accounts to finish setup.",
  },
  {
    introducedBy: "12d0149",
    date: "2026-08-03",
    title: "Consent-aware transactional messaging",
    summary: "Customers can opt in through N3XRA's public web form or by texting START, receive requested links and account-related updates, and use STOP or HELP at any time.",
  },
  {
    introducedBy: "cb1d65e",
    date: "2026-08-03",
    title: "Opportunity-aware live call handoffs",
    summary: "The receptionist evaluates business context, announces approved handoffs, and can privately brief N3XRA leadership before connecting qualified customer, project, partnership, or investment calls.",
  },
  {
    introducedBy: "e52f888",
    date: "2026-08-03",
    title: "Secure phone account assistance",
    summary: "Recognized callers can use a keypad PIN for an account overview or request a password-reset email sent only to the address already associated with their account.",
  },
  {
    introducedBy: "de43b3c",
    date: "2026-08-03",
    title: "N3XRA AI receptionist",
    summary: "N3XRA's dedicated phone number now answers with a branded conversational AI voice that can explain the platform, capture caller needs, and guide people toward the right next step.",
  },
  {
    introducedBy: "549385a",
    date: "2026-08-01",
    title: "Printable website payment history",
    summary: "Website-project customers can open a print-ready payment history that summarizes charges, completed payments, current balances, and the applicable payment schedule.",
  },
  {
    introducedBy: "9670ac2",
    date: "2026-08-01",
    title: "Approved partner workspace",
    summary: "Approved N3XRA partners now have an account-connected workspace for referral activity, earnings, program details, and next steps, with profile details carried into applications where available.",
  },
  {
    introducedBy: "ef14f3f",
    date: "2026-07-31",
    title: "Guided Records AI navigation",
    summary: "Ask Records AI can now offer safe action buttons that open the right Records page and spotlight the relevant tool without submitting forms or changing customer data.",
  },
  {
    introducedBy: "0d2e41d",
    date: "2026-07-31",
    title: "Resilient Meeting Notes recording",
    summary: "N3XRA Records can preserve and resume interrupted browser recordings, maintain a clear interruption timeline, and create consistent playback and transcript sources.",
  },
  {
    introducedBy: "dd04527",
    date: "2026-07-31",
    title: "Voice-enabled Records AI",
    summary: "Records users can ask product-help questions by voice and listen to spoken answers throughout authenticated Records workspaces.",
  },
  {
    introducedBy: "16fee21",
    date: "2026-07-31",
    title: "Device-aware Records AI guidance",
    summary: "Records AI now adapts its navigation instructions to the user's desktop or mobile layout and current location in the app.",
  },
  {
    introducedBy: "dc819b7",
    date: "2026-07-31",
    title: "Refined Records workspaces",
    summary: "Document Builder, Communication, Library, and Meeting Notes gained more focused layouts and clearer workspace controls across screen sizes.",
  },
  {
    introducedBy: "a880b13",
    date: "2026-07-30",
    title: "Phone meeting usage and retention controls",
    summary: "N3XRA Records added organization-level usage reporting and protected retention infrastructure for phone meeting recordings.",
  },
  {
    introducedBy: "1b01bf1",
    date: "2026-07-30",
    title: "Phone-connected Records meetings",
    summary: "Eligible Records organizations can connect telephone calls to the existing meeting workflow for recordings, transcripts, notes, and finalized minutes.",
  },
  {
    introducedBy: "ad23f3b",
    date: "2026-07-29",
    title: "Refined Records workspace",
    summary: "Records gained clearer desktop navigation, organized library administration, improved account pages, and a more focused communication workflow.",
  },
  {
    introducedBy: "73a47a7",
    date: "2026-07-27",
    title: "N3XRA Operations",
    summary: "N3XRA added an internal financial operations workspace for invoices, expenses, ledger activity, banking records, reporting, and audit review.",
  },
  {
    introducedBy: "60d12d0",
    date: "2026-07-27",
    title: "Loan Tracker",
    summary: "N3XRA introduced a private loan workspace for payment tracking, payoff comparisons, amortization schedules, controlled access, and exports.",
  },
  {
    introducedBy: "f50542d",
    date: "2026-07-25",
    title: "Ownership update interest flow",
    summary: "Visitors can request future company and ownership updates through an account-connected experience.",
  },
  {
    introducedBy: "08ac4ab",
    date: "2026-07-22",
    title: "Partner terms and protections",
    summary: "Public partner terms now explain commission structure, program expectations, and change-of-control protections.",
  },
  {
    introducedBy: "bb1937e",
    date: "2026-07-20",
    title: "Referral-connected product signup",
    summary: "Records and AI Music signups can preserve an eligible partner referral as a customer creates an account.",
  },
  {
    introducedBy: "9b06152",
    date: "2026-07-19",
    title: "N3XRA Partner Program",
    summary: "Visitors can explore N3XRA partner opportunities and apply to participate in approved referral programs.",
  },
  {
    introducedBy: "3078f42",
    date: "2026-07-19",
    title: "Smarter Ask N3XRA guidance",
    summary: "Ask N3XRA gained broader site knowledge to help visitors understand products, services, support, and where to go next.",
  },
  {
    introducedBy: "40cf72e",
    date: "2026-07-18",
    title: "Connected website project experience",
    summary: "Customers can move from a website request through proposal, onboarding, project progress, files, and ongoing service.",
  },
  {
    introducedBy: "d313946",
    date: "2026-07-18",
    title: "Refreshed N3XRA public experience",
    summary: "The public N3XRA site gained a clearer introduction to its work, software, services, and ways to get started.",
  },
  {
    introducedBy: "6244026",
    date: "2026-07-01",
    title: "Clearer Records usage and billing",
    summary: "N3XRA Records customers gained clearer visibility into plan usage, limits, and billing status.",
  },
  {
    introducedBy: "19a4251",
    date: "2026-06-25",
    title: "Utility meter billing workflow",
    summary: "N3XRA Utilities added structured meter-data and billing workflows for participating utility organizations.",
  },
  {
    introducedBy: "ef154af",
    date: "2026-06-17",
    title: "N3XRA Utilities",
    summary: "N3XRA introduced a connected utility platform for customer access, onboarding, operations, and organization workspaces.",
  },
  {
    introducedBy: "1a935d1",
    date: "2026-06-16",
    title: "Virals creator and billing programs",
    summary: "N3XRA Virals added customer billing and creator-affiliate participation workflows.",
  },
  {
    introducedBy: "7eb09ab",
    date: "2026-06-14",
    title: "N3XRA Virals analyzer",
    summary: "Visitors gained a workflow for turning TikTok videos into reusable frameworks, hooks, scripts, captions, and ideas.",
  },
  {
    introducedBy: "9114c18",
    date: "2026-06-13",
    title: "Shared N3XRA account",
    summary: "One N3XRA account began connecting customers to their available software, services, and product dashboards.",
  },
  {
    introducedBy: "75fd26a",
    date: "2026-05-11",
    title: "Records Help AI",
    summary: "N3XRA Records added an AI-assisted help experience for questions about records workflows and product guidance.",
  },
  {
    introducedBy: "f223b53",
    date: "2026-05-03",
    title: "AI Music workspace",
    summary: "N3XRA introduced an account-connected workspace for creating, reviewing, and saving generated songs.",
  },
];

const SYSTEM_MAP = {
  layers: [
    {
      id: "experiences",
      name: "Public experiences",
      description: "Websites, product pages, project discovery, careers, forms, AI phone reception, messaging, support, and Ask N3XRA.",
    },
    {
      id: "accounts",
      name: "Accounts & access",
      description: "One N3XRA identity connects customers to the products, services, and programs available to them.",
    },
    {
      id: "products",
      name: "Products & workflows",
      description: "Records, utilities, websites, branded client portals, Virals, music, partners, and company operations.",
    },
    {
      id: "operations",
      name: "Administration",
      description: "Web and mobile tools support accounts, billing, service, customer communications, files, careers, analytics, and planning.",
    },
    {
      id: "infrastructure",
      name: "Platform infrastructure",
      description: "Shared APIs, database services, server functions, storage, automation, and integrations.",
    },
  ],
  connections: [
    ["experiences", "accounts"],
    ["accounts", "products"],
    ["products", "operations"],
    ["products", "infrastructure"],
    ["operations", "infrastructure"],
  ],
};

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function git(...args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function countLines(file) {
  const value = fs.readFileSync(file, "utf8");
  if (!value) return 0;
  return value.split(/\r?\n/).length - (value.endsWith("\n") ? 1 : 0);
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function countDirectoriesWithIndex(files, prefix, indexName) {
  return new Set(
    files
      .map(relative)
      .filter((file) => file.startsWith(prefix) && file.endsWith(`/${indexName}`))
      .map((file) => path.posix.dirname(file)),
  ).size;
}

function getRecentCapabilities() {
  return RECENT_CAPABILITIES.map(({ introducedBy, date, title, summary }) => {
    const commitDate = git("show", "-s", "--format=%aI", introducedBy).slice(0, 10);
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(commitDate) ? commitDate : date,
      title,
      summary,
    };
  });
}

function buildManifest() {
  const files = walk(ROOT);
  const sourceFiles = files.filter((file) => (
    SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())
    && !SKIP_FILES.has(relative(file))
  ));
  const byLanguage = {};
  let sourceLines = 0;

  for (const file of sourceFiles) {
    const extension = path.extname(file).slice(1).toLowerCase();
    const lines = countLines(file);
    sourceLines += lines;
    byLanguage[extension] = byLanguage[extension] || { files: 0, lines: 0 };
    byLanguage[extension].files += 1;
    byLanguage[extension].lines += lines;
  }

  const relativeFiles = files.map(relative);
  const apiFunctions = relativeFiles.filter(
    (file) => /^api\/[^/]+\.(js|ts)$/.test(file) && !path.posix.basename(file).startsWith("_"),
  ).length;
  const edgeFunctions = countDirectoriesWithIndex(files, "supabase/functions/", "index.ts");
  const migrations = relativeFiles.filter((file) => /^supabase\/migrations\/.*\.sql$/.test(file)).length;
  const pages = relativeFiles.filter((file) => file.endsWith(".html")).length;
  const currentCommit = String(process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse", "HEAD") || "local").trim();
  const commitDate = git("show", "-s", "--format=%cI", currentCommit) || new Date().toISOString();
  const shortCommit = currentCommit === "local" ? "local" : currentCommit.slice(0, 7);

  return {
    schemaVersion: 1,
    name: "N3XRA Project Pulse",
    visibility: "public-safe",
    generatedAt: new Date().toISOString(),
    updatedAt: commitDate,
    commit: shortCommit,
    summary: {
      statement: `N3XRA is a connected technology platform comprising approximately ${Math.round(sourceLines / 1000).toLocaleString("en-US")},000 lines of source code across customer experiences, software products, APIs, database systems, administrative tools, and operational infrastructure.`,
      sourceFiles: sourceFiles.length,
      sourceLines,
      products: PRODUCTS.length,
      pages,
      apiFunctions,
      edgeFunctions,
      databaseMigrations: migrations,
    },
    sourceBreakdown: Object.fromEntries(
      Object.entries(byLanguage).sort(([a], [b]) => a.localeCompare(b)),
    ),
    products: PRODUCTS,
    majorModules: MAJOR_MODULES,
    recentCapabilities: getRecentCapabilities(),
    systemMap: SYSTEM_MAP,
    disclosure: "Counts are generated from allowlisted source-file types and may include comments and blank lines. Public data intentionally omits source paths, endpoint names, schemas, dependencies, credentials, and security implementation details.",
  };
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(buildManifest(), null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${OUTPUT}\n`);
