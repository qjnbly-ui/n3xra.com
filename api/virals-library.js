const {
  deleteSavedFramework,
  getBearerToken,
  hasViralsSupabaseConfig,
  listSavedFrameworks,
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
  if (!["GET", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!hasViralsSupabaseConfig()) return sendJson(res, 200, { frameworks: [], configured: false });

  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Authentication required." });
    const user = await verifySupabaseUser(token);

    if (req.method === "GET") {
      const frameworks = await listSavedFrameworks(user);
      return sendJson(res, 200, { frameworks, configured: true });
    }

    const body = await parseJson(req);
    const result = await deleteSavedFramework(user, String(body.id || ""));
    return sendJson(res, 200, result || { status: "deleted" });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Virals library request failed." });
  }
};
