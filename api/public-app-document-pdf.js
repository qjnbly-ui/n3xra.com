const SUPABASE_URL = process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ""));
}

function cleanFilename(value) {
  return String(value || "document")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9 _.-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
}

export default async function handler(req, res) {
  if (!SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE_ANON_KEY." });
  }

  const organizationId = String(req.query.org || "").trim();
  const sourceDocumentId = String(req.query.doc || "").trim();
  const documentId = String(req.query.app || "").trim();
  const mode = String(req.query.mode || "view").trim().toLowerCase();

  if (!isUuid(organizationId) || !isUuid(sourceDocumentId) || !isUuid(documentId)) {
    return res.status(400).json({ error: "Invalid public document request." });
  }
  if (!["view", "download"].includes(mode)) {
    return res.status(400).json({ error: "Invalid public document mode." });
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-app-document-pdf`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      documentId,
      organizationId,
      sourceDocumentId,
      publicEmbed: true,
      disposition: mode === "download" ? "attachment" : "inline",
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("application/pdf")) {
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status || 400).json({
      error: payload?.error || "Unable to generate public document PDF.",
    });
  }

  const filenameHeader = response.headers.get("content-disposition") || "";
  const filename = cleanFilename(filenameHeader.match(/filename="([^"]+)"/i)?.[1] || "document.pdf");
  const pdfBuffer = Buffer.from(await response.arrayBuffer());

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${mode === "download" ? "attachment" : "inline"}; filename="${filename}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(pdfBuffer);
}
