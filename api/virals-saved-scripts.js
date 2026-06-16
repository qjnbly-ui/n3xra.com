const {
  deleteSavedScript,
  getBearerToken,
  hasViralsSupabaseConfig,
  listSavedScripts,
  saveScriptToLibrary,
  verifySupabaseUser,
} = require("./_virals-supabase");

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function parseJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return {};
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!hasViralsSupabaseConfig()) {
    const payload = req.method === "GET" ? { scripts: [], configured: false } : { error: "Virals storage is not configured." };
    return sendJson(res, req.method === "GET" ? 200 : 503, payload);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Authentication required." });
    const user = await verifySupabaseUser(token);

    if (req.method === "GET") {
      const scripts = await listSavedScripts(user);
      return sendJson(res, 200, { scripts, configured: true });
    }

    const body = await parseJson(req);
    if (req.method === "DELETE") {
      const result = await deleteSavedScript(user, String(body.id || ""));
      return sendJson(res, 200, result || { status: "deleted" });
    }

    const script = await saveScriptToLibrary(user, body);
    return sendJson(res, 200, { script });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Saved script request failed." });
  }
};
