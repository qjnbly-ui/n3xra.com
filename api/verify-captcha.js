function parseJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded.trim()) return "";
  return forwarded.split(",")[0].trim();
}

const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

function getTurnstileSecret() {
  const vercelEnvironment = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  const isTestEnvironment =
    vercelEnvironment === "preview" ||
    vercelEnvironment === "development" ||
    (!vercelEnvironment && process.env.NODE_ENV !== "production");

  if (isTestEnvironment) return TURNSTILE_TEST_SECRET_KEY;
  return String(process.env.TURNSTILE_SECRET_KEY || "").trim();
}

async function verifyTurnstile(captchaToken, req) {
  const secret = getTurnstileSecret();
  if (!secret) {
    return { ok: false, error: "Missing TURNSTILE_SECRET_KEY." };
  }
  if (!captchaToken) {
    return { ok: false, error: "Complete the security check first." };
  }

  const payload = new URLSearchParams();
  payload.set("secret", secret);
  payload.set("response", captchaToken);
  const remoteIp = getClientIp(req);
  if (remoteIp) payload.set("remoteip", remoteIp);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.success) {
      const codes = Array.isArray(result?.["error-codes"]) ? result["error-codes"].join(", ") : "";
      return {
        ok: false,
        error: codes ? `Captcha verification failed: ${codes}.` : "Captcha verification failed.",
      };
    }
    return { ok: true };
  } catch (_error) {
    return { ok: false, error: "Captcha verification request failed." };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const body = await parseJson(req);
    const captchaToken = String(body.captchaToken || "").trim();
    const result = await verifyTurnstile(captchaToken, req);
    if (!result.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: result.error }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (_error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Server error." }));
  }
};
