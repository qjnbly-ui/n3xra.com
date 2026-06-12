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

  state.page.drawText(state.organizationName || "N3XRA Records", {
    x: MARGIN_X,
    y: PAGE_HEIGHT - 34,
    size: 8,
    font: state.fonts.bold,
    color: rgb(0.28, 0.34, 0.41),
  });
  state.page.drawText(`Page ${state.pageNumber}`, {
    x: PAGE_WIDTH - MARGIN_X - 38,
    y: 30,
    size: 8,
    font: state.fonts.regular,
    color: rgb(0.42, 0.47, 0.54),
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
    const text = String(segment.text || "").replace(/\t/g, "    ");
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
  return inlineSegments(node).map((segment) => segment.text).join("").replace(/\s+/g, " ").trim();
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
        state.page.drawText(line, {
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
    const label = context.orderedIndex ? `${context.orderedIndex}.` : "•";
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
      drawInlineBlock(state, [{ text: paragraph }], { spacingAfter: 7 });
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

  drawInlineBlock(state, [{ text: options.title || "Untitled document" }], {
    size: 22,
    lineHeight: 27,
    fallbackBold: true,
    spacingAfter: 5,
  });
  drawInlineBlock(state, [{ text: `Generated ${new Date().toLocaleDateString("en-US")}` }], {
    size: 9.5,
    lineHeight: 13,
    spacingAfter: 8,
  });
  drawRule(state);

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
    if (!documentId) return jsonResponse({ error: "documentId is required." }, 400);

    const { data: document, error: documentError } = await adminClient
      .from("app_documents")
      .select("id, organization_id, title, content_json, plain_text, document_kind, organization:organizations(id, name, owner_user_id)")
      .eq("id", documentId)
      .maybeSingle();

    if (documentError || !document) {
      return jsonResponse({ error: documentError?.message || "Document not found." }, 404);
    }

    const { data: membership, error: membershipError } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", document.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) return jsonResponse({ error: membershipError.message }, 400);

    const isPlatformAdmin = String(user.email || "").toLowerCase() === "quentin@quentinnichols.com";
    const organization = Array.isArray(document.organization) ? document.organization[0] : document.organization;
    const isOwner = organization?.owner_user_id === user.id;
    if (!membership && !isOwner && !isPlatformAdmin) {
      return jsonResponse({ error: "You do not have access to this document." }, 403);
    }

    const pdfBytes = await buildPdf({
      title: textValue(document.title) || "Untitled document",
      organizationName: textValue(organization?.name) || "N3XRA Records",
      contentJson: document.content_json,
      plainText: String(document.plain_text || ""),
    });
    const filename = `${cleanFilename(document.title)}.pdf`;

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PDF generation error.";
    return jsonResponse({ error: message }, 500);
  }
});
