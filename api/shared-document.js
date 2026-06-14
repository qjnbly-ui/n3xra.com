import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

function buildHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function hashShareToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.message || data?.error || `Request failed with status ${response.status}.`);
    throw new Error(message);
  }
  return data;
}

export default async function handler(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  const token = String(req.query.token || "").trim();
  if (!token || token.length < 24) {
    return res.status(400).json({ error: "Invalid shared document link." });
  }

  try {
    const tokenHash = hashShareToken(token);
    const shareUrl = `${SUPABASE_URL}/rest/v1/document_share_links?select=id,document_id,organization_id&token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`;
    const shareRows = await fetchJson(shareUrl, { headers: buildHeaders() });
    const share = Array.isArray(shareRows) ? shareRows[0] : null;
    if (!share?.document_id) {
      return res.status(404).json({ error: "Shared document not found." });
    }

    const documentUrl = `${SUPABASE_URL}/rest/v1/app_documents?select=id,title,status,document_kind,organization_id&id=eq.${encodeURIComponent(share.document_id)}&limit=1`;
    const documentRows = await fetchJson(documentUrl, { headers: buildHeaders() });
    const document = Array.isArray(documentRows) ? documentRows[0] : null;
    if (!document || document.document_kind === "template") {
      return res.status(404).json({ error: "Shared document not found." });
    }

    const organizationUrl = `${SUPABASE_URL}/rest/v1/organizations?select=id,name&id=eq.${encodeURIComponent(document.organization_id)}&limit=1`;
    const organizationRows = await fetchJson(organizationUrl, { headers: buildHeaders() });
    const organization = Array.isArray(organizationRows) ? organizationRows[0] : null;

    return res.status(200).json({
      ok: true,
      title: document.title || "Shared document",
      status: document.status || "draft",
      organizationName: organization?.name || "N3XRA Records",
      pdfUrl: `/api/shared-document-pdf?token=${encodeURIComponent(token)}&mode=view`,
      downloadUrl: `/api/shared-document-pdf?token=${encodeURIComponent(token)}&mode=download`,
      recordsUrl: "/records",
      accountUrl: "/account",
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to open shared document.",
    });
  }
}
