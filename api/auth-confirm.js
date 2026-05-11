const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();

const DEFAULT_SUCCESS_REDIRECT = "/app/login/?confirmed=1";
const DEFAULT_ERROR_REDIRECT = "/ai-music-generator/login/?error=confirmation_failed";
const MUSIC_SUCCESS_REDIRECT = "/ai-music-generator/login/?confirmed=1";

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function getBaseOrigin(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https").trim();
  if (!host) return "https://n3xra.com";
  return `${proto}://${host}`;
}

function normalizeRedirectPath(raw, fallback, origin) {
  const value = String(raw || "").trim();
  if (!value) return fallback;

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const originUrl = new URL(origin);
    if (parsed.origin !== originUrl.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return fallback;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const origin = getBaseOrigin(req);
  const tokenHash = String(req.query?.token_hash || "").trim();
  const type = String(req.query?.type || "email").trim();
  const requestedRedirect = normalizeRedirectPath(req.query?.redirect_to, "", origin);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !tokenHash || !type) {
    return redirect(res, `${origin}${DEFAULT_ERROR_REDIRECT}`);
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        type,
        token_hash: tokenHash,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return redirect(res, `${origin}${DEFAULT_ERROR_REDIRECT}`);
    }

    let successRedirect = requestedRedirect || DEFAULT_SUCCESS_REDIRECT;
    if (!requestedRedirect) {
      const appSignup = String(payload?.user?.user_metadata?.app_signup || "").trim().toLowerCase();
      if (appSignup === "ai_music") {
        successRedirect = MUSIC_SUCCESS_REDIRECT;
      }
    }

    return redirect(res, `${origin}${successRedirect}`);
  } catch (_error) {
    return redirect(res, `${origin}${DEFAULT_ERROR_REDIRECT}`);
  }
};
