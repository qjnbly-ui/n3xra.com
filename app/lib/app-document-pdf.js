export function getAppDocumentPdfFilename(doc) {
  const base = String(doc?.title || "document")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9 _.-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
  return `${base}.pdf`;
}

export async function createAppDocumentPdfObjectUrl({ config, accessToken, documentId }) {
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
    throw new Error("Supabase config is missing.");
  }
  if (!accessToken) {
    throw new Error("Sign in again before previewing this document.");
  }
  if (!documentId) {
    throw new Error("Editable document id is missing.");
  }

  const response = await fetch(`${config.supabaseUrl}/functions/v1/generate-app-document-pdf`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ documentId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || "Unable to generate editable document preview.");
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
