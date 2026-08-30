const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ""
).trim();

function apiError(message, status = 500, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function parseJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { throw apiError("The request body is not valid JSON.", 400); }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(apiError("The request body is not valid JSON.", 400)); }
    });
    req.on("error", reject);
  });
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function callerHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || data?.msg || `Supabase request failed (${response.status}).`;
    throw apiError(String(message), response.status >= 400 && response.status < 600 ? response.status : 500, data);
  }
  return data;
}

async function serviceRequest(path, options = {}) {
  return readResponse(await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(options.headers),
  }));
}

async function callerRpc(name, token, body) {
  return readResponse(await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: callerHeaders(token),
    body: JSON.stringify(body),
  }));
}

async function verifyAdminRequest(req) {
  if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw apiError("Proposal AI is not configured for this deployment.", 503);
  }
  const token = getBearerToken(req);
  if (!token) throw apiError("Authentication required.", 401);
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) throw apiError("Your session is no longer valid.", 401);
  const admins = await serviceRequest(
    `platform_admins?select=user_id,role,status&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&limit=1`,
  );
  if (!Array.isArray(admins) || !admins.length) throw apiError("Active platform administrator access is required.", 403);
  return { token, user, admin: admins[0] };
}

async function verifyAuthenticatedRequest(req) {
  if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw apiError("Private website access is not configured for this deployment.", 503);
  }
  const token = getBearerToken(req);
  if (!token) throw apiError("Authentication required.", 401);
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) throw apiError("Your session is no longer valid.", 401);
  return { token, user };
}

function encodeStoragePath(bucket, path) {
  return `${encodeURIComponent(bucket)}/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
}

async function downloadStorageObject(bucket, path) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(bucket, path)}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw apiError(text || `Unable to read ${path}.`, response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function deleteStorageObject(bucket, path) {
  if (!bucket || !path) return false;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(bucket, path)}`, {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw apiError(text || `Unable to delete ${path}.`, response.status);
  }
  return true;
}

async function uploadStorageObject(bucket, path, bytes, { contentType = "application/octet-stream", cacheControl = "31536000", upsert = false } = {}) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(bucket, path)}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": contentType,
      "Cache-Control": `max-age=${cacheControl}`,
      "x-upsert": upsert ? "true" : "false",
    },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw apiError(text || `Unable to store ${path}.`, response.status);
  }
  return readResponse(response);
}

async function createSignedStorageUpload(bucket, path) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${encodeStoragePath(bucket, path)}`, {
    method: "POST",
    headers: serviceHeaders({ "x-upsert": "false" }),
    body: JSON.stringify({ upsert: false }),
  });
  return readResponse(response);
}

async function storageObjectExists(bucket, path) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(bucket, path)}`, {
    method: "HEAD",
    headers: serviceHeaders(),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw apiError("The uploaded image could not be verified.", response.status);
  return true;
}

module.exports = {
  SUPABASE_URL,
  apiError,
  callerRpc,
  createSignedStorageUpload,
  deleteStorageObject,
  downloadStorageObject,
  parseJson,
  serviceRequest,
  storageObjectExists,
  uploadStorageObject,
  verifyAdminRequest,
  verifyAuthenticatedRequest,
};
