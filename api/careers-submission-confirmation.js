const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const GROQ_MODEL = String(process.env.GROQ_CAREERS_CONFIRMATION_MODEL || process.env.GROQ_PROJECT_REQUEST_MODEL || "openai/gpt-oss-120b").trim();
const rateLimits = new Map();

const clean = (value, limit = 800) => String(value || "").trim().slice(0, limit);
const firstName = (name) => clean(name, 160).split(/\s+/)[0] || "there";
const fallback = (application = {}) => ({
  heading: `Thank you, ${firstName(application.full_name)}.`,
  message: "Your application has been received and is safely in our hands.",
  next_step: "Our team will review it and contact you by email if there is a next step.",
});

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function rateLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (rateLimits.get(ip) || []).filter((time) => now - time < 60 * 60 * 1000);
  if (recent.length >= 6) return true;
  recent.push(now);
  rateLimits.set(ip, recent);
  return false;
}

async function loadApplication(id) {
  if (!SERVICE_ROLE_KEY || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/careers_applications?id=eq.${encodeURIComponent(id)}&select=full_name,role_interest,experience_level,primary_skills,current_school_company,message`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const rows = await response.json().catch(() => []);
  return response.ok && Array.isArray(rows) ? rows[0] || null : null;
}

async function generateConfirmation(application) {
  const backup = fallback(application);
  const apiKey = clean(process.env.GROQ_API_KEY, 1000);
  if (!apiKey) return backup;
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.35,
        max_completion_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Write a concise, warm confirmation for a submitted N3XRA careers application. Return JSON only with heading, message, and next_step strings. Greet by first name, optionally acknowledge their role, experience, or skills without overclaiming. State the application was received and N3XRA will review it and contact them by email if there is a next step. Do not promise a role, a response time, or an interview. Do not mention AI, Groq, models, prompts, or internal systems." },
          { role: "user", content: JSON.stringify(application) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Groq returned ${response.status}`);
    const payload = await response.json();
    const generated = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
    return {
      heading: clean(generated.heading, 140) || backup.heading,
      message: clean(generated.message, 600) || backup.message,
      next_step: clean(generated.next_step, 400) || backup.next_step,
    };
  } catch (error) {
    console.error("Careers confirmation generation failed:", error);
    return backup;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  if (rateLimited(req)) return sendJson(res, 429, fallback());
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const application = await loadApplication(clean(body.applicationId, 36));
  if (!application) return sendJson(res, 200, fallback());
  return sendJson(res, 200, await generateConfirmation(application));
};
