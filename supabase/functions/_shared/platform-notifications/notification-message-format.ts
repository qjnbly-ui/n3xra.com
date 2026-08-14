const HTTP_LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi;

function escapeHtml(input: unknown) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmphasis(input: string) {
  return input
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");
}

function renderInline(input: string) {
  const pattern = new RegExp(HTTP_LINK_PATTERN.source, HTTP_LINK_PATTERN.flags);
  let cursor = 0;
  let html = "";
  let match = pattern.exec(input);

  while (match) {
    html += renderEmphasis(escapeHtml(input.slice(cursor, match.index)));
    const label = renderEmphasis(escapeHtml(match[1]));
    const url = escapeHtml(match[2]);
    html += `<a href="${url}" style="color:#176f66;font-weight:700;text-decoration:underline;" target="_blank" rel="noopener noreferrer">${label}</a>`;
    cursor = match.index + match[0].length;
    match = pattern.exec(input);
  }

  return html + renderEmphasis(escapeHtml(input.slice(cursor)));
}

function isBlockStart(line: string) {
  return /^(?:#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s?)/.test(line);
}

/**
 * Converts the intentionally small notification markup language to allowlisted
 * HTML. Raw HTML is always escaped; only links with http(s) URLs are rendered.
 */
export function renderNotificationMessageHtml(input: unknown) {
  const lines = String(input || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const headingMarker = heading[1] || "#";
      const headingText = heading[2] || "";
      const level = headingMarker.length >= 3 ? 3 : 2;
      blocks.push(`<h${level} style="margin:22px 0 8px;color:#121924;font-size:${level === 2 ? "24px" : "19px"};line-height:1.25;">${renderInline(headingText)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] || "")) {
        items.push(`<li style="margin:5px 0;">${renderInline((lines[index] || "").replace(/^[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ul style="margin:12px 0;padding-left:24px;">${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] || "")) {
        items.push(`<li style="margin:5px 0;">${renderInline((lines[index] || "").replace(/^\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ol style="margin:12px 0;padding-left:24px;">${items.join("")}</ol>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] || "")) {
        quoteLines.push(renderInline((lines[index] || "").replace(/^>\s?/, "")));
        index += 1;
      }
      blocks.push(`<blockquote style="margin:16px 0;padding:10px 16px;border-left:3px solid #176f66;color:#536171;">${quoteLines.join("<br>")}</blockquote>`);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && (lines[index] || "").trim() && !isBlockStart(lines[index] || "")) {
      paragraphLines.push(lines[index] || "");
      index += 1;
    }
    blocks.push(`<p style="margin:0 0 14px;">${paragraphLines.map(renderInline).join("<br>")}</p>`);
  }

  return blocks.join("");
}

/** Converts formatted notification source into readable email fallback/SMS text. */
export function notificationMessageToPlainText(input: unknown) {
  return String(input || "")
    .replace(/\r\n?/g, "\n")
    .replace(HTTP_LINK_PATTERN, (_match, label: string, url: string) => `${label} (${url})`)
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .trim();
}
