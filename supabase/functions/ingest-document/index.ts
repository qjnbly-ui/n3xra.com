import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import JSZip from "npm:jszip";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

async function extractDocxText(fileBytes: Uint8Array) {
  const zip = await JSZip.loadAsync(fileBytes);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) {
    throw new Error("word/document.xml missing in DOCX archive.");
  }

  const xml = await xmlFile.async("string");
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const text = paragraphs
    .map((paragraph) => {
      const runs = paragraph.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      const joined = runs
        .map((run) => run.replace(/<\/?w:t[^>]*>/g, ""))
        .join(" ");
      return decodeXmlEntities(joined);
    })
    .join("\n");

  return cleanWhitespace(text);
}

async function extractTextFromBuffer(fileBytes: Uint8Array, fileName: string) {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".docx")) {
    return await extractDocxText(fileBytes);
  }

  if (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".html") ||
    lowerName.endsWith(".htm")
  ) {
    return cleanWhitespace(new TextDecoder().decode(fileBytes));
  }

  if (lowerName.endsWith(".doc")) {
    throw new Error("Legacy .doc extraction is not supported in the Supabase function. Convert the file to .docx first.");
  }

  if (lowerName.endsWith(".pdf")) {
    throw new Error("PDF extraction/OCR is not wired in yet. Start with .docx or plain-text files for the MVP.");
  }

  throw new Error("Unsupported file type for extraction.");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment variables are missing." }, 500);
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: userError?.message || "Unable to resolve user." }, 401);
    }

    const payload = await request.json().catch(() => ({}));
    const documentId = payload.documentId;

    if (!documentId || typeof documentId !== "string") {
      return jsonResponse({ error: "documentId is required." }, 400);
    }

    const { data: document, error: documentError } = await adminClient
      .from("documents")
      .select("id, organization_id, original_filename, storage_path")
      .eq("id", documentId)
      .single();

    if (documentError || !document) {
      return jsonResponse({ error: documentError?.message || "Document not found." }, 404);
    }

    const { data: membership, error: membershipError } = await adminClient
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", document.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const isPlatformAdmin = String(user.email || "").toLowerCase() === "quentin@quentinnichols.com";
    if (membershipError) {
      return jsonResponse({ error: membershipError.message }, 400);
    }

    if (!membership && !isPlatformAdmin) {
      return jsonResponse({ error: "You do not have access to this document." }, 403);
    }

    await adminClient
      .from("documents")
      .update({
        status: "processing",
        processing_error: null,
      })
      .eq("id", documentId);

    const { data: storageObject, error: downloadError } = await adminClient.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !storageObject) {
      await adminClient
        .from("documents")
        .update({
          status: "failed",
          processing_error: downloadError?.message || "Unable to download file from storage.",
        })
        .eq("id", documentId);

      return jsonResponse({ error: downloadError?.message || "Unable to download file." }, 400);
    }

    const fileBytes = new Uint8Array(await storageObject.arrayBuffer());
    const extractedText = await extractTextFromBuffer(fileBytes, document.original_filename);

    await adminClient
      .from("documents")
      .update({
        status: "ready",
        processing_error: null,
        extracted_text: extractedText,
      })
      .eq("id", documentId);

    return jsonResponse({
      ok: true,
      documentId,
      extractedCharacters: extractedText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected ingestion error.";
    return jsonResponse({ error: message }, 500);
  }
});
