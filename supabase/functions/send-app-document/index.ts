import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

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

function escapeHtml(input: unknown) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textValue(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanFilename(value: string) {
  return String(value || "document")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9 _.-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createShareToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hashShareToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function normalizeRecipientEmails(payload: Record<string, unknown>) {
  const raw = Array.isArray(payload.recipientEmails)
    ? payload.recipientEmails
    : [payload.recipientEmail];
  return Array.from(new Set(
    raw
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

function buildTextEmail(options: {
  senderName: string;
  organizationName: string;
  documentTitle: string;
  message: string;
  attachPdf: boolean;
  includeLink: boolean;
  appLink: string;
  accountLink: string;
}) {
  const lines = [
    options.message || `${options.senderName} sent you ${options.documentTitle} from ${options.organizationName}.`,
  ];
  if (options.attachPdf) {
    lines.push("", "The PDF is attached to this email.");
  }
  if (options.includeLink && options.appLink) {
    lines.push("", `Open PDF in browser: ${options.appLink}`);
  }
  if (options.accountLink) {
    lines.push("", `Open in N3XRA Records: ${options.accountLink}`);
  }
  lines.push("", "Sent with N3XRA Records.");
  return lines.join("\n");
}

function buildHtmlEmail(options: {
  senderName: string;
  organizationName: string;
  documentTitle: string;
  message: string;
  attachPdf: boolean;
  includeLink: boolean;
  appLink: string;
  accountLink: string;
}) {
  const safeSender = escapeHtml(options.senderName);
  const safeOrg = escapeHtml(options.organizationName);
  const safeTitle = escapeHtml(options.documentTitle);
  const safeMessage = escapeHtml(options.message || `${options.senderName} sent you ${options.documentTitle} from ${options.organizationName}.`)
    .replace(/\n/g, "<br>");
  const safeLink = escapeHtml(options.appLink);
  const safeAccountLink = escapeHtml(options.accountLink);
  const attachmentLine = options.attachPdf
    ? `<p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:#2f3d4d;"><strong>The PDF is attached to this email.</strong></p>`
    : "";
  const linkBlock = options.includeLink && options.appLink
    ? `<p style="margin:18px 0 0;"><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#123a33;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Open PDF in browser</a></p>`
    : "";
  const accountLinkBlock = options.accountLink
    ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#5b6678;">N3XRA Records user? <a href="${safeAccountLink}" style="color:#123a33;font-weight:700;text-decoration:underline;">Open this document in your account</a>.</p>`
    : "";

  return `
    <div style="margin:0;padding:28px;background:#f5f7fb;font-family:Manrope,Trebuchet MS,sans-serif;color:#121924;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:#0f141b;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;opacity:0.82;">N3XRA Records Document</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;">${safeTitle}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#5b6678;">${safeSender} sent this from <strong>${safeOrg}</strong>.</p>
          <p style="margin:0;font-size:16px;line-height:1.6;color:#2f3d4d;">${safeMessage}</p>
          ${attachmentLine}
          ${linkBlock}
          ${accountLinkBlock}
          <p style="margin:22px 0 0;padding-top:18px;border-top:1px solid rgba(15,22,32,0.08);font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7482;font-weight:700;">Powered by N3XRA Records</p>
        </div>
      </div>
    </div>
  `;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("APP_DOCUMENT_FROM_EMAIL") || "N3XRA Records <documents@n3xra.com>";
    const appBaseUrl = (Deno.env.get("APP_BASE_URL") || "https://n3xra.com").replace(/\/+$/, "");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment variables are missing." }, 500);
    }
    if (!resendApiKey) {
      return jsonResponse({ error: "RESEND_API_KEY is missing." }, 500);
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
    const documentId = String(payload.documentId || "").trim();
    const recipientEmails = normalizeRecipientEmails(payload);
    const subject = textValue(payload.subject).slice(0, 180);
    const message = String(payload.message || "").trim().slice(0, 5000);
    const attachPdf = payload.attachPdf !== false;
    const includeLink = payload.includeLink !== false;
    const includeAccountLink = payload.includeAccountLink !== false;

    if (!documentId || !recipientEmails.length || !subject) {
      return jsonResponse({ error: "documentId, recipientEmails, and subject are required." }, 400);
    }
    const invalidEmail = recipientEmails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalidEmail) {
      return jsonResponse({ error: `Recipient email is invalid: ${invalidEmail}` }, 400);
    }

    const { data: document, error: documentError } = await adminClient
      .from("app_documents")
      .select("id, organization_id, title, plain_text, document_kind, organization:organizations(id, name, owner_user_id)")
      .eq("id", documentId)
      .maybeSingle();

    if (documentError || !document) {
      return jsonResponse({ error: documentError?.message || "Document not found." }, 404);
    }
    if (document.document_kind === "template") {
      return jsonResponse({ error: "Templates cannot be sent directly." }, 400);
    }

    const [{ data: membership, error: membershipError }, { data: profile }] = await Promise.all([
      adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", document.organization_id)
        .eq("user_id", user.id)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (membershipError) return jsonResponse({ error: membershipError.message }, 400);

    const organization = Array.isArray(document.organization) ? document.organization[0] : document.organization;
    const isPlatformAdmin = String(user.email || "").toLowerCase() === "quentin@quentinnichols.com";
    const isOwner = organization?.owner_user_id === user.id;
    if (!membership && !isOwner && !isPlatformAdmin) {
      return jsonResponse({ error: "You do not have access to send this document." }, 403);
    }

    let attachments: Array<{ filename: string; content: string }> = [];
    const documentTitle = textValue(document.title) || "Untitled document";
    if (attachPdf) {
      const pdfResponse = await fetch(`${supabaseUrl}/functions/v1/generate-app-document-pdf`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });
      if (!pdfResponse.ok) {
        const errorPayload = await pdfResponse.json().catch(() => ({}));
        return jsonResponse({ error: String(errorPayload?.error || "PDF generation failed.") }, 400);
      }
      const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
      attachments = [{
        filename: `${cleanFilename(documentTitle)}.pdf`,
        content: bytesToBase64(pdfBytes),
      }];
    }

    const senderName = textValue(profile?.full_name) || textValue(user.email) || "N3XRA Records";
    const organizationName = textValue(organization?.name) || "N3XRA Records";
    let appLink = "";
    if (includeLink) {
      const shareToken = createShareToken();
      const { error: shareError } = await adminClient
        .from("document_share_links")
        .insert({
          document_id: documentId,
          organization_id: document.organization_id,
          created_by_user_id: user.id,
          token_hash: await hashShareToken(shareToken),
          label: `Email sent ${new Date().toISOString()}`,
        });

      if (shareError) {
        return jsonResponse({ error: shareError.message || "Unable to create document share link." }, 400);
      }

      appLink = `${appBaseUrl}/api/shared-document-pdf?token=${encodeURIComponent(shareToken)}&mode=view`;
    }

    const accountRecipientEmails = new Set<string>();
    if (includeAccountLink) {
      const { data: memberRows } = await adminClient
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", document.organization_id);

      const memberUserIds = Array.from(new Set((memberRows || [])
        .map((item: { user_id?: string | null }) => item.user_id)
        .filter(Boolean)));

      if (memberUserIds.length) {
        const { data: memberProfiles } = await adminClient
          .from("profiles")
          .select("email")
          .in("id", memberUserIds);

        (memberProfiles || []).forEach((memberProfile: { email?: string | null }) => {
          const email = String(memberProfile.email || "").trim().toLowerCase();
          if (recipientEmails.includes(email)) accountRecipientEmails.add(email);
        });
      }

      const ownerEmail = organization?.owner_user_id
        ? await adminClient
          .from("profiles")
          .select("email")
          .eq("id", organization.owner_user_id)
          .maybeSingle()
        : null;
      const ownerEmailValue = String(ownerEmail?.data?.email || "").trim().toLowerCase();
      if (ownerEmailValue && recipientEmails.includes(ownerEmailValue)) accountRecipientEmails.add(ownerEmailValue);
    }

    const baseEmailPayload: Record<string, unknown> = {
      from: fromEmail,
      subject,
      reply_to: user.email,
    };
    if (attachments.length) baseEmailPayload.attachments = attachments;

    const sent: Array<{ email: string; id: string | null }> = [];
    const failed: Array<{ email: string; error: string }> = [];

    for (const email of recipientEmails) {
      const accountLink = accountRecipientEmails.has(email)
        ? `${appBaseUrl}/app/documents?id=${encodeURIComponent(documentId)}&view=pdf`
        : "";
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...baseEmailPayload,
          html: buildHtmlEmail({ senderName, organizationName, documentTitle, message, attachPdf, includeLink, appLink, accountLink }),
          text: buildTextEmail({ senderName, organizationName, documentTitle, message, attachPdf, includeLink, appLink, accountLink }),
          to: [email],
        }),
      });

      const emailResult = await emailResponse.json().catch(() => ({}));
      if (emailResponse.ok) {
        sent.push({ email, id: typeof emailResult?.id === "string" ? emailResult.id : null });
      } else {
        failed.push({ email, error: String(emailResult?.message || emailResult?.error || "Document email failed to send.") });
      }
    }

    if (sent.length) {
      await adminClient
        .from("app_documents")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", documentId);
    }

    return jsonResponse({
      ok: failed.length === 0,
      sent,
      failed,
      sentCount: sent.length,
      failedCount: failed.length,
    }, sent.length ? 200 : 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected document send error.";
    return jsonResponse({ error: message }, 500);
  }
});
