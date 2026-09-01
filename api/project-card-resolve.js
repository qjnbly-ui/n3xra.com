const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function credentials() {
  const authorization = SERVICE_KEY.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${SERVICE_KEY}` };
  return { apikey: SERVICE_KEY, ...authorization, "Content-Type": "application/json", Accept: "application/json" };
}

function unavailable(res, status, message) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(status).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Project Card | N3XRA</title><style>body{margin:0;background:#07101a;color:#fff;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;padding:2rem}a{color:#79d7e8}</style><main class="card"><p>N3XRA PROJECT CARDS</p><h1>This card is not available.</h1><p>${message}</p><a href="https://www.n3xra.com/project-cards/">Learn about Project Cards</a></main></html>`);
}

module.exports = async function projectCardResolve(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Card resolution is not configured.");
    const token = String(req.query?.token || "").trim().toLowerCase();
    if (!TOKEN_PATTERN.test(token)) return unavailable(res, 404, "Check the address written to the card and try again.");

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_project_card`, {
      method: "POST",
      headers: credentials(),
      body: JSON.stringify({ input_token: token }),
    });
    const card = await response.json().catch(() => null);
    if (!response.ok) throw new Error(String(card?.message || "Unable to resolve this card."));
    if (!card || card.card_status !== "active") return unavailable(res, 404, "This card may be inactive or retired.");
    if (!SLUG_PATTERN.test(String(card.destination_slug || "")) || card.destination_access !== "public") {
      return unavailable(res, 404, "This card has not been assigned to a live public project yet.");
    }

    res.setHeader("Location", `/p/${encodeURIComponent(card.destination_slug)}`);
    return res.status(302).end();
  } catch {
    return unavailable(res, 500, "Please try scanning again in a moment.");
  }
};
