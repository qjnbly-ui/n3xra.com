const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();

const DEFAULT_SUCCESS_REDIRECT = "/account/?confirmed=1";
const DEFAULT_ERROR_REDIRECT = "/account/?error=confirmation_failed";
const DASHBOARD_CONTEXT_PARAMS = [
  "invite",
  "invite_code",
  "admin_invite",
  "utility_invite",
  "email",
  "signup",
  "promo",
];

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

function buildVerifiedSessionRedirect(origin, path, payload) {
  const target = new URL(path, origin);
  const accessToken = String(payload?.access_token || "").trim();
  const refreshToken = String(payload?.refresh_token || "").trim();
  if (!accessToken || !refreshToken) return target.toString();

  target.hash = new URLSearchParams({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: String(payload?.expires_in || ""),
    token_type: String(payload?.token_type || "bearer"),
    type: "signup",
  }).toString();
  return target.toString();
}

function buildDashboardRedirect(origin, requestedRedirect) {
  const dashboardUrl = new URL(DEFAULT_SUCCESS_REDIRECT, origin);
  if (!requestedRedirect) return `${dashboardUrl.pathname}${dashboardUrl.search}`;

  const requestedUrl = new URL(requestedRedirect, origin);
  DASHBOARD_CONTEXT_PARAMS.forEach((name) => {
    const value = requestedUrl.searchParams.get(name);
    if (value) dashboardUrl.searchParams.set(name, value);
  });
  return `${dashboardUrl.pathname}${dashboardUrl.search}`;
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

    const successRedirect = buildDashboardRedirect(origin, requestedRedirect);

    return redirect(res, buildVerifiedSessionRedirect(origin, successRedirect, payload));
  } catch (_error) {
    return redirect(res, `${origin}${DEFAULT_ERROR_REDIRECT}`);
  }
};
