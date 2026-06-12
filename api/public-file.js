import { buildPreviewUrl, getDownloadFilename } from "../app/lib/document-links.js";
import { getAppDocumentPdfFilename } from "../app/lib/app-document-pdf.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";

function buildHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function encodePath(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toAbsoluteSignedUrl(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${SUPABASE_URL}/storage/v1${raw}`;
  return `${SUPABASE_URL}/storage/v1/${raw}`;
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

async function getPublicDocument(orgId, docId) {
  const organizationsUrl = `${SUPABASE_URL}/rest/v1/organizations?select=id,name,public_embed_enabled&id=eq.${encodeURIComponent(orgId)}&public_embed_enabled=eq.true&limit=1`;
  const organizations = await fetchJson(organizationsUrl, { headers: buildHeaders() });
  if (!Array.isArray(organizations) || !organizations.length) {
    throw new Error("Public embed is not enabled for this library.");
  }

  const documentsUrl = `${SUPABASE_URL}/rest/v1/documents?select=id,organization_id,title,original_filename,storage_path,is_public&id=eq.${encodeURIComponent(docId)}&organization_id=eq.${encodeURIComponent(orgId)}&is_public=eq.true&limit=1`;
  const documents = await fetchJson(documentsUrl, { headers: buildHeaders() });
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error("Public file not found.");
  }

  const sourceDocument = documents[0];
  const appDocumentsUrl = `${SUPABASE_URL}/rest/v1/app_documents?select=id,title,source_document_id,status,updated_at,created_at&organization_id=eq.${encodeURIComponent(orgId)}&source_document_id=eq.${encodeURIComponent(docId)}&document_kind=eq.document&order=updated_at.desc`;
  const appDocuments = await fetchJson(appDocumentsUrl, { headers: buildHeaders() });
  const editableDocument = (Array.isArray(appDocuments) ? appDocuments : []).reduce((selected, candidate) => {
    if (!selected) return candidate;
    const selectedFinal = selected.status === "final" ? 1 : 0;
    const candidateFinal = candidate.status === "final" ? 1 : 0;
    if (candidateFinal !== selectedFinal) return candidateFinal > selectedFinal ? candidate : selected;
    const selectedUpdated = new Date(selected.updated_at || selected.created_at || 0).getTime() || 0;
    const candidateUpdated = new Date(candidate.updated_at || candidate.created_at || 0).getTime() || 0;
    return candidateUpdated > selectedUpdated ? candidate : selected;
  }, null);

  return { sourceDocument, editableDocument };
}

async function createSignedUrl(doc, mode) {
  const signUrl = `${SUPABASE_URL}/storage/v1/object/sign/documents/${encodePath(doc.storage_path)}`;
  const payload = {
    expiresIn: 60 * 60,
  };
  if (mode === "download") {
    payload.download = getDownloadFilename(doc);
  }

  const data = await fetchJson(signUrl, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  const absoluteUrl = toAbsoluteSignedUrl(data?.signedURL || data?.signedUrl || "");
  if (!absoluteUrl || mode !== "download") return absoluteUrl;

  const downloadUrl = new URL(absoluteUrl);
  downloadUrl.searchParams.set("download", getDownloadFilename(doc));
  return downloadUrl.toString();
}

export default async function handler(req, res) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  const orgId = String(req.query.org || "").trim();
  const docId = String(req.query.doc || "").trim();
  const mode = String(req.query.mode || "view").trim().toLowerCase();

  if (!isUuid(orgId) || !isUuid(docId)) {
    return res.status(400).json({ error: "Invalid public file request." });
  }
  if (!["view", "download", "share"].includes(mode)) {
    return res.status(400).json({ error: "Invalid public file mode." });
  }

  try {
    const { sourceDocument, editableDocument } = await getPublicDocument(orgId, docId);
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host || "";
    const shareUrl = `${proto}://${host}/api/public-file?org=${encodeURIComponent(orgId)}&doc=${encodeURIComponent(docId)}&mode=view&redirect=1`;

    if (editableDocument?.id) {
      const filename = getAppDocumentPdfFilename(editableDocument);
      const pdfUrl = `${proto}://${host}/api/public-app-document-pdf?org=${encodeURIComponent(orgId)}&doc=${encodeURIComponent(docId)}&app=${encodeURIComponent(editableDocument.id)}&mode=${encodeURIComponent(mode === "download" ? "download" : "view")}`;

      if (req.query.redirect === "1") {
        return res.redirect(pdfUrl);
      }

      return res.status(200).json({
        ok: true,
        filename,
        signedUrl: pdfUrl,
        previewUrl: pdfUrl,
        shareUrl,
        editableDocumentId: editableDocument.id,
      });
    }

    const signedUrl = await createSignedUrl(sourceDocument, mode === "download" ? "download" : "view");
    const previewUrl = buildPreviewUrl(sourceDocument, signedUrl);

    if (req.query.redirect === "1") {
      return res.redirect(mode === "download" ? signedUrl : previewUrl);
    }

    return res.status(200).json({
      ok: true,
      filename: getDownloadFilename(sourceDocument),
      signedUrl,
      previewUrl,
      shareUrl,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to access public file.",
    });
  }
}
