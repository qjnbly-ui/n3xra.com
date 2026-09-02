const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRAINING_RESOURCE_PATH = "N3XRA LLC/Sales/Representative Training & Guides/";

function send(res, status, body) {
  res.status(status).json(body);
}

async function getUser(req) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: authorization },
  });
  return response.ok ? response.json() : null;
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error || "Partner portal request failed.");
  return data;
}

async function approvedApplication(userId) {
  const rows = await rest(`founding_partner_applications?select=*&account_user_id=eq.${encodeURIComponent(userId)}&status=eq.approved&limit=1`);
  return rows?.[0] || null;
}

async function approvedApplicationById(id) {
  const rows = await rest(`founding_partner_applications?select=*&id=eq.${encodeURIComponent(id)}&status=eq.approved&limit=1`);
  return rows?.[0] || null;
}

async function isFullAdmin(userId) {
  const rows = await rest(`platform_admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&role=in.(owner,admin)&access_scope=eq.full&limit=1`);
  return Boolean(rows?.length);
}

async function activeTerms(applicationId) {
  try {
    return await rest(`partner_terms?select=status,commission_type,commission_rate_bps,commission_amount_cents,currency,commission_description,contract_title,contract_body,effective_at,expires_at,revision,updated_at&partner_application_id=eq.${encodeURIComponent(applicationId)}&status=eq.active&limit=1`);
  } catch (error) {
    if (/partner_terms|schema cache|does not exist/i.test(error.message)) return [];
    throw error;
  }
}

async function trainingResources() {
  const rows = await rest(`n3xra_files?select=id,name,mime_type,size_bytes,created_at&name=like.${encodeURIComponent(`${TRAINING_RESOURCE_PATH}*`)}&mime_type=eq.application%2Fpdf&order=created_at.desc`);
  return (rows || []).map((file) => ({
    id: file.id,
    title: /sales[_ -]+representative[_ -]+guide/i.test(file.name)
      ? "N3XRA Sales Representative Guide"
      : String(file.name || "Resource").split("/").pop().replace(/\.[^.]+$/, "").replaceAll("_", " "),
    description: /sales[_ -]+representative[_ -]+guide/i.test(file.name)
      ? "Learn N3XRA’s products, customer process, sales approach, and compensation structure."
      : "N3XRA sales representative training resource.",
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    created_at: file.created_at,
  }));
}

function serviceCredentials(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    ...(SERVICE_KEY.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${SERVICE_KEY}` }),
    ...extra,
  };
}

function encodeStoragePath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function absoluteStorageUrl(value) {
  const raw = String(value || "");
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/storage/v1/")) return `${SUPABASE_URL}${raw}`;
  if (raw.startsWith("/")) return `${SUPABASE_URL}/storage/v1${raw}`;
  return `${SUPABASE_URL}/storage/v1/${raw}`;
}

async function signedTrainingResourceUrl(fileId) {
  if (!UUID_PATTERN.test(fileId)) throw Object.assign(new Error("A valid training resource is required."), { status: 400 });
  const rows = await rest(`n3xra_files?select=id,name,storage_path,mime_type&id=eq.${encodeURIComponent(fileId)}&limit=1`);
  const file = rows?.[0];
  if (!file || !String(file.name || "").startsWith(TRAINING_RESOURCE_PATH)) {
    throw Object.assign(new Error("Training resource not found."), { status: 404 });
  }
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/n3xra-files/${encodeStoragePath(file.storage_path)}`, {
    method: "POST",
    headers: serviceCredentials({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ expiresIn: 60 * 10 }),
  });
  const payload = await response.json().catch(() => ({}));
  const signedPath = payload?.signedURL || payload?.signedUrl || payload?.url || "";
  if (!response.ok || !signedPath) throw Object.assign(new Error(payload?.message || payload?.error || "Unable to prepare this guide."), { status: 400 });
  return absoluteStorageUrl(signedPath);
}

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) return send(res, 503, { error: "Partner portal configuration is unavailable." });
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  try {
    const user = await getUser(req);
    if (!user?.email) return send(res, 401, { error: "Sign in to continue." });
    const previewId = String(req.query?.admin_preview || "").trim();
    if (previewId && req.method !== "GET") return send(res, 403, { error: "Administrator previews are read-only." });
    if (previewId && !/^[0-9a-f-]{36}$/i.test(previewId)) return send(res, 400, { error: "A valid partner preview is required." });
    const preview = Boolean(previewId);
    const application = preview
      ? await isFullAdmin(user.id) ? await approvedApplicationById(previewId) : null
      : await approvedApplication(user.id);
    if (!application) return send(res, 403, { error: "An approved partner account is required." });

    if (req.method === "POST") {
      const action = String(req.body?.action || "");
      if (action === "open_training_resource") {
        const url = await signedTrainingResourceUrl(String(req.body?.file_id || "").trim());
        return send(res, 200, { ok: true, url });
      }
      const referralCode = cleanCode(req.body?.referral_code);
      if (referralCode.length < 4) return send(res, 400, { error: "Use at least four letters or numbers." });
      if (action === "check_referral_code") {
        const matches = await rest(`founding_partner_applications?select=id&referral_code=eq.${encodeURIComponent(referralCode)}&limit=1`);
        return send(res, 200, {
          ok: true,
          referral_code: referralCode,
          available: !matches?.length,
        });
      }
      if (action !== "set_referral_code") return send(res, 400, { error: "Unsupported partner action." });
      if (application.referral_code) {
        return send(res, 409, { error: "Your referral code has already been created and cannot be changed." });
      }
      try {
        await rest(`founding_partner_applications?id=eq.${encodeURIComponent(application.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ referral_code: referralCode }),
        });
      } catch (error) {
        if (/duplicate|unique/i.test(error.message)) return send(res, 409, { error: "That referral code is already in use." });
        throw error;
      }
      return send(res, 200, { ok: true, referral_code: referralCode });
    }

    const [referrals, commissions, termsRows, resources] = await Promise.all([
      rest(`partner_referrals?select=*&partner_application_id=eq.${encodeURIComponent(application.id)}&order=created_at.desc`),
      rest(`partner_commission_entries?select=*&partner_application_id=eq.${encodeURIComponent(application.id)}&order=created_at.desc`),
      activeTerms(application.id),
      trainingResources(),
    ]);
    const sum = (status) => (commissions || [])
      .filter((entry) => entry.status === status)
      .reduce((total, entry) => total + Number(entry.amount_cents || 0), 0);

    return send(res, 200, {
      ok: true,
      preview,
      partner: {
        full_name: application.full_name,
        email: application.email,
        referral_code: application.referral_code,
        approved_at: application.approved_at || application.updated_at,
        programs: application.interested_products || [],
      },
      balances: {
        pending_cents: sum("pending"),
        available_cents: sum("available"),
        paid_cents: sum("paid"),
        currency: commissions?.[0]?.currency || "USD",
      },
      referrals: referrals || [],
      commissions: commissions || [],
      terms: termsRows?.[0] || null,
      resources,
    });
  } catch (error) {
    return send(res, Number(error?.status) || 500, { error: error instanceof Error ? error.message : "Unable to open the partner portal." });
  }
}
