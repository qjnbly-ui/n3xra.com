const crypto = require("node:crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const TURNSTILE_SECRET = String(process.env.TURNSTILE_SECRET_KEY || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || "").trim();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;
const REQUESTS = globalThis.__n3xraCareerRequests || new Map();
globalThis.__n3xraCareerRequests = REQUESTS;

const allowedRoles = new Set(["open_to_best_fit", "software_product", "websites_portals", "design_brand", "ai_automation", "business_development", "sales", "marketing_communications", "content_social", "partnerships", "client_success", "operations", "project_delivery", "support", "finance", "leadership_strategy", "research", "internship_learning", "advisor", "investor", "other"]);
const allowedExperience = new Set(["not_specified", "student", "entry_level", "junior", "mid_level", "senior"]);
const allowedArrangement = new Set(["remote", "flexible", "onsite"]);
const allowedContributions = new Set(["software_product", "websites_portals", "design_brand", "ai_automation", "business_development", "sales", "marketing_communications", "content_social", "partnerships", "client_success", "operations", "project_delivery", "support", "finance", "leadership_strategy", "research", "internship_learning", "other"]);
const allowedParticipation = new Set(["employment", "contract_project", "commission", "equity_ownership", "investor", "advisor", "internship", "open_to_discussion"]);
const allowedFiles = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

function clean(value, limit) { return String(value || "").trim().slice(0, limit); }
function clientIp(req) { return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim(); }
function rateLimited(ip) {
  const now = Date.now();
  const recent = (REQUESTS.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return true;
  recent.push(now); REQUESTS.set(ip, recent); return false;
}
function randomLooking(value) {
  const raw = clean(value, 200); const compact = raw.replace(/[^a-z]/gi, "");
  if (raw.includes(" ") || compact.length < 18) return false;
  const ratio = (compact.match(/[aeiou]/gi) || []).length / compact.length;
  return ratio < 0.2 || ratio > 0.65;
}
function list(value, allowed, limit) { return Array.isArray(value) ? value.map((item) => clean(item, 80)).filter((item) => allowed.has(item)).slice(0, limit) : []; }
function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; try { return JSON.parse(String(req.body || "{}")); } catch { return {}; } }
function storagePath(path) { return path.split("/").map(encodeURIComponent).join("/"); }

async function verifyCaptcha(token, req) {
  if (!TURNSTILE_SECRET) throw new Error("Career application security is not configured.");
  if (!token) return false;
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: clientIp(req) });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const result = await response.json().catch(() => ({}));
  return response.ok && result.success === true;
}
async function authenticatedUser(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${match[1]}` } });
  const user = await response.json().catch(() => ({}));
  return response.ok && user?.id ? user : null;
}
function normalize(input, user) {
  const fullName = clean(input.full_name, 160); const email = clean(input.email, 320).toLowerCase();
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || input.information_retention_consent !== true) throw new Error("Enter your name and email, then accept the information-retention notice.");
  if (randomLooking(fullName)) throw new Error("Use your real name so the application can be reviewed.");
  if (clean(input.website_confirm, 20)) throw new Error("Application could not be verified.");
  return {
    id: crypto.randomUUID(), account_user_id: user?.id || null, full_name: fullName, email,
    location_timezone: clean(input.location_timezone, 160) || null,
    current_school_company: clean(input.current_school_company, 300) || null,
    experience_level: allowedExperience.has(input.experience_level) ? input.experience_level : "not_specified",
    primary_skills: clean(input.primary_skills, 1000) || null,
    role_interest: allowedRoles.has(input.role_interest) ? input.role_interest : "open_to_best_fit",
    contribution_areas: list(input.contribution_areas, allowedContributions, 18),
    proposed_title: clean(input.proposed_title, 160) || null,
    role_vision: clean(input.role_vision, 4000) || null,
    n3xra_interest: clean(input.n3xra_interest, 4000) || null,
    contribution_vision: clean(input.contribution_vision, 5000) || null,
    participation_preferences: list(input.participation_preferences, allowedParticipation, 8),
    work_arrangement: allowedArrangement.has(input.work_arrangement) ? input.work_arrangement : "flexible",
    availability: clean(input.availability, 300) || null,
    portfolio_url: clean(input.portfolio_url, 1000) || null, linkedin_url: clean(input.linkedin_url, 1000) || null,
    github_url: clean(input.github_url, 1000) || null, cv_url: clean(input.cv_url, 1000) || null,
    referral_source: clean(input.referral_source, 300) || null, message: clean(input.message, 10000),
    information_retention_consent: true, source_url: clean(input.source_url, 1000) || "https://www.n3xra.com/careers/", status: "new",
  };
}

async function deleteUpload(path) { if (!path) return; await fetch(`${SUPABASE_URL}/storage/v1/object/careers-files/${storagePath(path)}`, { method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }).catch(() => null); }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
  if (!SERVICE_KEY || !TURNSTILE_SECRET) return res.status(500).json({ error: "Career applications are temporarily unavailable." });
  const ip = clientIp(req); if (rateLimited(ip)) return res.status(429).json({ error: "Please wait before sending another application." });
  const body = parseBody(req);
  if (!(await verifyCaptcha(clean(body.captchaToken, 4096), req))) return res.status(400).json({ error: "Security check failed. Please try again." });
  let application; let uploadedPath = null;
  try {
    const user = await authenticatedUser(req); application = normalize(body.application || {}, user);
    const resume = body.resume;
    if (resume) {
      const bytes = Buffer.from(String(resume.base64 || ""), "base64");
      const contentType = clean(resume.contentType, 160);
      if (!bytes.length || bytes.length > 3 * 1024 * 1024 || !allowedFiles.has(contentType)) throw new Error("Upload a PDF, DOC, or DOCX file up to 3 MB.");
      const filename = clean(resume.filename, 140).replace(/[^a-zA-Z0-9._-]+/g, "-") || "resume";
      uploadedPath = `applications/${application.id}/${filename}`;
      const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/careers-files/${storagePath(uploadedPath)}`, { method: "POST", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": contentType, "x-upsert": "false" }, body: bytes });
      if (!upload.ok) throw new Error("The résumé could not be uploaded. Please try a résumé link instead.");
      application.cv_storage_path = uploadedPath; application.cv_filename = clean(resume.originalFilename, 255) || filename;
    }
    const saved = await fetch(`${SUPABASE_URL}/rest/v1/careers_applications`, { method: "POST", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(application) });
    if (!saved.ok) { await deleteUpload(uploadedPath); throw new Error("The application could not be saved. Please try again."); }
    return res.status(201).json({ applicationId: application.id });
  } catch (error) {
    await deleteUpload(uploadedPath);
    return res.status(400).json({ error: error instanceof Error ? error.message : "The application could not be sent." });
  }
};
