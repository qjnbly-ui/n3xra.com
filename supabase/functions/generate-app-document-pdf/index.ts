import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 58;
const MARGIN_TOP = 62;
const MARGIN_BOTTOM = 58;
const BODY_SIZE = 11.5;
const LINE_HEIGHT = 15.5;

type PdfFontSet = {
  regular: any;
  bold: any;
  italic: any;
  boldItalic: any;
};

type InlineSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: { r: number; g: number; b: number };
};

type RenderState = {
  pdf: PDFDocument;
  page: any;
  fonts: PdfFontSet;
  y: number;
  pageNumber: number;
  title: string;
  organizationName: string;
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

function cleanFilename(value: string) {
  return String(value || "document")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9 _.-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
}

function textValue(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashShareToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function pdfSafeText(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u2011/g, "-")
    .replace(/[\u2010\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2032/g, "'")
    .replace(/\u2033/g, '"')
    .replace(/[\u00a0\u202f\u2007]/g, " ")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff\u2022]/g, "?");
}

function fitText(font: any, value: unknown, size: number, maxWidth: number) {
  const text = pdfSafeText(value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

  const suffix = "...";
  let trimmed = text;
  while (trimmed.length && font.widthOfTextAtSize(`${trimmed}${suffix}`, size) > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed ? `${trimmed}${suffix}` : "";
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value: string) {
  return decodeHtml(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).replace(/\n{3,}/g, "\n\n").trim();
}

function colorFromCss(value: string | null | undefined) {
  const raw = String(value || "").trim().toLowerCase();
  const hex = raw.match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16) / 255,
      g: Number.parseInt(hex.slice(2, 4), 16) / 255,
      b: Number.parseInt(hex.slice(4, 6), 16) / 255,
    };
  }
  if (raw === "red") return { r: 0.9, g: 0, b: 0 };
  if (raw === "blue") return { r: 0, g: 0.18, b: 0.75 };
  if (raw === "green") return { r: 0, g: 0.45, b: 0.22 };
  return undefined;
}

function getFont(fonts: PdfFontSet, segment: InlineSegment) {
  if (segment.bold && segment.italic) return fonts.boldItalic;
  if (segment.bold) return fonts.bold;
  if (segment.italic) return fonts.italic;
  return fonts.regular;
}

function addPage(state: RenderState) {
  state.page = state.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  state.pageNumber += 1;
  state.y = PAGE_HEIGHT - MARGIN_TOP;

  const headerSize = 8.5;
  const footerSize = 8;
  const mutedText = rgb(0.42, 0.47, 0.54);
  const headerTitle = fitText(state.fonts.bold, state.title || "Untitled document", headerSize, 220);
  const headerTitleWidth = state.fonts.bold.widthOfTextAtSize(headerTitle, headerSize);
  const separator = headerTitle ? " | " : "";
  const separatorWidth = state.fonts.regular.widthOfTextAtSize(separator, headerSize);
  const headerMetaMaxWidth = Math.max(
    0,
    PAGE_WIDTH - MARGIN_X * 2 - headerTitleWidth - separatorWidth - 4,
  );
  const headerMeta = fitText(
    state.fonts.regular,
    state.organizationName || "N3XRA Records",
    headerSize,
    headerMetaMaxWidth,
  );
  const headerMetaText = headerMeta ? `${separator}${headerMeta}` : "";

  state.page.drawText(headerTitle, {
    x: MARGIN_X,
    y: PAGE_HEIGHT - 34,
    size: headerSize,
    font: state.fonts.bold,
    color: rgb(0.28, 0.34, 0.41),
  });
  if (headerMetaText) {
    state.page.drawText(headerMetaText, {
      x: MARGIN_X + headerTitleWidth + 4,
      y: PAGE_HEIGHT - 34,
      size: headerSize,
      font: state.fonts.regular,
      color: rgb(0.28, 0.34, 0.41),
    });
  }

  const footerBrand = "Powered by N3XRA Records";
  const pageNumberText = `Page ${state.pageNumber}`;
  state.page.drawText(footerBrand, {
    x: MARGIN_X,
    y: 30,
    size: footerSize,
    font: state.fonts.regular,
    color: mutedText,
  });
  state.page.drawText(pageNumberText, {
    x: PAGE_WIDTH - MARGIN_X - state.fonts.regular.widthOfTextAtSize(pageNumberText, footerSize),
    y: 30,
    size: footerSize,
    font: state.fonts.regular,
    color: mutedText,
  });
}

function ensureSpace(state: RenderState, needed: number) {
  if (state.y - needed < MARGIN_BOTTOM) addPage(state);
}

function drawRule(state: RenderState) {
  ensureSpace(state, 12);
  state.page.drawLine({
    start: { x: MARGIN_X, y: state.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: state.y },
    thickness: 0.8,
    color: rgb(0.78, 0.81, 0.85),
  });
  state.y -= 14;
}

function normalizeSegments(segments: InlineSegment[]) {
  const result: InlineSegment[] = [];
  segments.forEach((segment) => {
    const text = pdfSafeText(segment.text).replace(/\t/g, "    ");
    if (!text) return;
    result.push({ ...segment, text });
  });
  return result.length ? result : [{ text: "" }];
}

function tokenSegments(segments: InlineSegment[]) {
  const tokens: InlineSegment[] = [];
  normalizeSegments(segments).forEach((segment) => {
    const parts = segment.text.split(/(\s+)/).filter((part) => part.length > 0);
    parts.forEach((part) => tokens.push({ ...segment, text: part }));
  });
  return tokens;
}

function segmentWidth(fonts: PdfFontSet, segment: InlineSegment, size: number) {
  return getFont(fonts, segment).widthOfTextAtSize(segment.text, size);
}

function lineWidth(fonts: PdfFontSet, line: InlineSegment[], size: number) {
  return line.reduce((sum, segment) => sum + segmentWidth(fonts, segment, size), 0);
}

function splitIntoLines(fonts: PdfFontSet, segments: InlineSegment[], size: number, maxWidth: number) {
  const sourceLines: InlineSegment[][] = [[]];
  normalizeSegments(segments).forEach((segment) => {
    const pieces = segment.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) sourceLines.push([]);
      if (piece) sourceLines[sourceLines.length - 1].push({ ...segment, text: piece });
    });
  });

  const lines: InlineSegment[][] = [];
  sourceLines.forEach((source) => {
    let current: InlineSegment[] = [];
    tokenSegments(source).forEach((token) => {
      const next = [...current, token];
      if (current.length && lineWidth(fonts, next, size) > maxWidth) {
        lines.push(current);
        current = [token];
      } else {
        current = next;
      }
    });
    lines.push(current.length ? current : [{ text: "" }]);
  });
  return lines;
}

function drawInlineBlock(
  state: RenderState,
  segments: InlineSegment[],
  options: {
    size?: number;
    lineHeight?: number;
    indent?: number;
    maxWidth?: number;
    align?: string;
    spacingBefore?: number;
    spacingAfter?: number;
    fallbackBold?: boolean;
  } = {},
) {
  const size = options.size || BODY_SIZE;
  const lineHeight = options.lineHeight || Math.max(size * 1.35, LINE_HEIGHT);
  const indent = options.indent || 0;
  const maxWidth = options.maxWidth || PAGE_WIDTH - MARGIN_X * 2 - indent;
  const align = options.align || "left";
  const normalized = normalizeSegments(segments).map((segment) => ({
    ...segment,
    bold: segment.bold || options.fallbackBold,
  }));
  const lines = splitIntoLines(state.fonts, normalized, size, maxWidth);

  state.y -= options.spacingBefore || 0;
  ensureSpace(state, lines.length * lineHeight + (options.spacingAfter || 0));

  lines.forEach((line) => {
    const width = lineWidth(state.fonts, line, size);
    let x = MARGIN_X + indent;
    if (align === "center") x += Math.max(0, (maxWidth - width) / 2);
    if (align === "right") x += Math.max(0, maxWidth - width);

    line.forEach((segment) => {
      const font = getFont(state.fonts, segment);
      state.page.drawText(segment.text, {
        x,
        y: state.y,
        size,
        font,
        color: segment.color ? rgb(segment.color.r, segment.color.g, segment.color.b) : rgb(0.06, 0.09, 0.13),
      });
      x += segmentWidth(state.fonts, segment, size);
    });
    state.y -= lineHeight;
  });

  state.y -= options.spacingAfter || 0;
}

function inlineSegments(node: any, inherited: Partial<InlineSegment> = {}): InlineSegment[] {
  if (!node || typeof node !== "object") return [];
  if (node.type === "hardBreak") return [{ text: "\n", ...inherited }];

  let current = { ...inherited };
  if (Array.isArray(node.marks)) {
    node.marks.forEach((mark: any) => {
      if (mark?.type === "bold") current.bold = true;
      if (mark?.type === "italic") current.italic = true;
      if (mark?.type === "textStyle") {
        const color = colorFromCss(mark?.attrs?.color);
        if (color) current.color = color;
      }
    });
  }

  if (node.type === "text") return [{ text: String(node.text || ""), ...current }];
  if (Array.isArray(node.content)) {
    return node.content.flatMap((child: any) => inlineSegments(child, current));
  }
  return [];
}

function nodeText(node: any) {
  return pdfSafeText(inlineSegments(node).map((segment) => segment.text).join("")).replace(/\s+/g, " ").trim();
}

function textAlign(node: any) {
  const value = String(node?.attrs?.textAlign || node?.attrs?.align || "").toLowerCase();
  return ["left", "center", "right", "justify"].includes(value) ? value : "left";
}

function renderTable(state: RenderState, tableNode: any) {
  const rows = Array.isArray(tableNode?.content) ? tableNode.content : [];
  if (!rows.length) return;
  const maxCols = rows.reduce((max: number, row: any) => Math.max(max, Array.isArray(row.content) ? row.content.length : 0), 1);
  const availableWidth = PAGE_WIDTH - MARGIN_X * 2;
  const cellWidth = availableWidth / maxCols;

  state.y -= 4;
  rows.forEach((row: any) => {
    const cells = Array.isArray(row.content) ? row.content : [];
    const cellLines = cells.map((cell: any) => {
      const text = nodeText(cell);
      const font = cell.type === "tableHeader" ? state.fonts.bold : state.fonts.regular;
      const words = text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let current = "";
      words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        if (current && font.widthOfTextAtSize(next, 9.5) > cellWidth - 12) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      });
      lines.push(current || "");
      return lines;
    });
    const rowHeight = Math.max(24, Math.max(...cellLines.map((lines: string[]) => lines.length)) * 12 + 10);
    ensureSpace(state, rowHeight + 6);

    cells.forEach((cell: any, index: number) => {
      const x = MARGIN_X + index * cellWidth;
      const y = state.y - rowHeight + 12;
      const isHeader = cell.type === "tableHeader";
      state.page.drawRectangle({
        x,
        y,
        width: cellWidth,
        height: rowHeight,
        borderWidth: 0.6,
        borderColor: rgb(0.55, 0.59, 0.65),
        color: isHeader ? rgb(0.93, 0.96, 0.96) : undefined,
      });
      const font = isHeader ? state.fonts.bold : state.fonts.regular;
      cellLines[index].forEach((line: string, lineIndex: number) => {
        state.page.drawText(pdfSafeText(line), {
          x: x + 6,
          y: state.y - 7 - lineIndex * 12,
          size: 9.5,
          font,
          color: rgb(0.06, 0.09, 0.13),
        });
      });
    });
    state.y -= rowHeight;
  });
  state.y -= 10;
}

function renderNode(state: RenderState, node: any, context: { indent?: number; orderedIndex?: number } = {}) {
  if (!node || typeof node !== "object") return;
  const indent = context.indent || 0;

  if (node.type === "heading") {
    const level = Number(node?.attrs?.level || 2);
    drawInlineBlock(state, inlineSegments(node), {
      size: level === 1 ? 20 : level === 2 ? 16 : 13.5,
      lineHeight: level === 1 ? 25 : 21,
      align: textAlign(node),
      spacingBefore: level === 1 ? 5 : 2,
      spacingAfter: 8,
      fallbackBold: true,
    });
    return;
  }

  if (node.type === "paragraph") {
    const segments = inlineSegments(node);
    if (!segments.map((segment) => segment.text).join("").trim()) {
      state.y -= LINE_HEIGHT;
      return;
    }
    drawInlineBlock(state, segments, {
      indent,
      align: textAlign(node),
      spacingAfter: 7,
    });
    return;
  }

  if (node.type === "blockquote") {
    drawInlineBlock(state, inlineSegments(node), {
      indent: indent + 14,
      spacingAfter: 8,
      fallbackBold: false,
    });
    return;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    (Array.isArray(node.content) ? node.content : []).forEach((item: any, index: number) => {
      renderNode(state, item, { indent: indent + 18, orderedIndex: node.type === "orderedList" ? index + 1 : undefined });
    });
    state.y -= 2;
    return;
  }

  if (node.type === "listItem") {
    const label = pdfSafeText(context.orderedIndex ? `${context.orderedIndex}.` : "•");
    ensureSpace(state, LINE_HEIGHT);
    state.page.drawText(label, {
      x: MARGIN_X + Math.max(0, indent - 16),
      y: state.y,
      size: BODY_SIZE,
      font: state.fonts.regular,
      color: rgb(0.06, 0.09, 0.13),
    });
    (Array.isArray(node.content) ? node.content : []).forEach((child: any) => renderNode(state, child, { indent }));
    return;
  }

  if (node.type === "table") {
    renderTable(state, node);
    return;
  }

  if (Array.isArray(node.content)) {
    node.content.forEach((child: any) => renderNode(state, child, context));
  }
}

function renderPlainText(state: RenderState, plainText: string) {
  String(plainText || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((paragraph) => {
      drawInlineBlock(state, [{ text: pdfSafeText(paragraph) }], { spacingAfter: 7 });
    });
}

async function buildPdf(options: {
  title: string;
  organizationName: string;
  contentJson: any;
  plainText: string;
}) {
  const pdf = await PDFDocument.create();
  const fonts: PdfFontSet = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const state: RenderState = {
    pdf,
    page: null,
    fonts,
    y: 0,
    pageNumber: 0,
    title: options.title,
    organizationName: options.organizationName,
  };
  addPage(state);

  const content = options.contentJson;
  if (content?.type === "doc" && Array.isArray(content.content)) {
    content.content.forEach((node: any) => renderNode(state, node));
  } else if (typeof content?.html === "string") {
    renderPlainText(state, stripHtml(content.html));
  } else {
    renderPlainText(state, options.plainText);
  }

  return await pdf.save();
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

    const payload = await request.json().catch(() => ({}));
    const sharedDocumentToken = String(payload.sharedDocumentToken || "").trim();
    let documentId = String(payload.documentId || "").trim();
    const isPublicEmbedRequest = payload.publicEmbed === true;
    const isSharedDocumentRequest = Boolean(sharedDocumentToken);
    if (!documentId && !isSharedDocumentRequest) return jsonResponse({ error: "documentId is required." }, 400);
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (isSharedDocumentRequest) {
      const tokenHash = await hashShareToken(sharedDocumentToken);
      const { data: shareLink, error: shareError } = await adminClient
        .from("document_share_links")
        .select("id, document_id")
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (shareError || !shareLink) {
        return jsonResponse({ error: shareError?.message || "Shared document not found." }, 404);
      }

      documentId = shareLink.document_id;

      await adminClient
        .from("document_share_links")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", shareLink.id);
    }

    const { data: document, error: documentError } = await adminClient
      .from("app_documents")
      .select("id, organization_id, source_document_id, title, content_json, plain_text, document_kind, organization:organizations(id, name, owner_user_id, public_embed_enabled)")
      .eq("id", documentId)
      .maybeSingle();

    if (documentError || !document) {
      return jsonResponse({ error: documentError?.message || "Document not found." }, 404);
    }
    if (isSharedDocumentRequest && document.document_kind === "template") {
      return jsonResponse({ error: "Shared document not found." }, 404);
    }

    const organization = Array.isArray(document.organization) ? document.organization[0] : document.organization;

    if (isPublicEmbedRequest) {
      const organizationId = String(payload.organizationId || "").trim();
      const sourceDocumentId = String(payload.sourceDocumentId || "").trim();
      if (!isUuid(organizationId) || !isUuid(sourceDocumentId)) {
        return jsonResponse({ error: "Invalid public document reference." }, 400);
      }
      if (
        document.organization_id !== organizationId ||
        document.source_document_id !== sourceDocumentId ||
        document.document_kind !== "document" ||
        organization?.public_embed_enabled !== true
      ) {
        return jsonResponse({ error: "Public document not found." }, 404);
      }

      const { data: sourceDocument, error: sourceDocumentError } = await adminClient
        .from("documents")
        .select("id, organization_id, is_public")
        .eq("id", sourceDocumentId)
        .eq("organization_id", organizationId)
        .eq("is_public", true)
        .maybeSingle();

      if (sourceDocumentError || !sourceDocument) {
        return jsonResponse({ error: sourceDocumentError?.message || "Public document not found." }, 404);
      }
    } else if (!isSharedDocumentRequest) {
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

      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();

      if (userError || !user) {
        return jsonResponse({ error: userError?.message || "Unable to resolve user." }, 401);
      }

      const { data: membership, error: membershipError } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", document.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) return jsonResponse({ error: membershipError.message }, 400);

      const isPlatformAdmin = ["quentin@n3xra.com", "quentin@quentinnichols.com"].includes(String(user.email || "").toLowerCase());
      const isOwner = organization?.owner_user_id === user.id;
      if (!membership && !isOwner && !isPlatformAdmin) {
        return jsonResponse({ error: "You do not have access to this document." }, 403);
      }
    }

    const pdfBytes = await buildPdf({
      title: textValue(document.title) || "Untitled document",
      organizationName: textValue(organization?.name) || "N3XRA Records",
      contentJson: document.content_json,
      plainText: String(document.plain_text || ""),
    });
    const filename = `${cleanFilename(document.title)}.pdf`;
    const disposition = payload.disposition === "inline" ? "inline" : "attachment";

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PDF generation error.";
    return jsonResponse({ error: message }, 500);
  }
});
