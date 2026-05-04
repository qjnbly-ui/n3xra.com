const {
  getBearerToken,
  getMusicAccount,
  updateMusicProfile,
  hasSupabaseAdminConfig,
  verifySupabaseUser,
} = require("./_music-supabase");

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function getErrorStatus(error) {
  return Number(error?.status || 500);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch {
      return Promise.reject(new Error("Invalid JSON body."));
    }
  }

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function cleanDisplayName(value) {
  const displayName = String(value || "").trim();
  if (!displayName) {
    const error = new Error("Display name is required.");
    error.status = 400;
    throw error;
  }
  if (displayName.length > 120) {
    const error = new Error("Display name must be 120 characters or fewer.");
    error.status = 400;
    throw error;
  }
  return displayName;
}

module.exports = async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, PATCH");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!hasSupabaseAdminConfig()) {
    return sendJson(res, 500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  try {
    const token = getBearerToken(req);
    const user = await verifySupabaseUser(token);

    if (req.method === "PATCH") {
      const body = await readBody(req);
      await updateMusicProfile(user, {
        display_name: cleanDisplayName(body.display_name),
      });
    }

    const account = await getMusicAccount(user);
    return sendJson(res, 200, { ok: true, ...account });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error instanceof Error ? error.message : "Unable to load AI Music account.",
    });
  }
};
