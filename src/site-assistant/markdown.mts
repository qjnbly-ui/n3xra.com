export type InlineMarkdownToken =
  | { type: "text" | "strong" | "emphasis" | "code"; value: string }
  | { type: "link"; value: string; href: string };

const INLINE_MARKDOWN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/gi;

export function parseInlineMarkdown(value: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  let cursor = 0;
  for (const match of value.matchAll(INLINE_MARKDOWN)) {
    const index = match.index ?? cursor;
    if (index > cursor) tokens.push({ type: "text", value: value.slice(cursor, index) });
    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i);
    if (link?.[1] && link[2]) tokens.push({ type: "link", value: link[1], href: link[2] });
    else if (token.startsWith("**")) tokens.push({ type: "strong", value: token.slice(2, -2) });
    else if (token.startsWith("`")) tokens.push({ type: "code", value: token.slice(1, -1) });
    else tokens.push({ type: "emphasis", value: token.slice(1, -1) });
    cursor = index + token.length;
  }
  if (cursor < value.length) tokens.push({ type: "text", value: value.slice(cursor) });
  return tokens;
}

function appendInlineMarkdown(parent: HTMLElement, value: string): void {
  for (const token of parseInlineMarkdown(value)) {
    if (token.type === "text") {
      parent.append(document.createTextNode(token.value));
      continue;
    }
    const element = document.createElement(token.type === "strong" ? "strong" : token.type === "emphasis" ? "em" : token.type === "code" ? "code" : "a");
    element.textContent = token.value;
    if (token.type === "link") {
      element.setAttribute("href", token.href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
    parent.append(element);
  }
}

function isBlockStart(line: string): boolean {
  return /^(?:#{1,3}\s+|\d+\.\s+|[-*]\s+|\|.*\|$)/.test(line.trim());
}

export function parseMarkdownTableRow(line: string): string[] | null {
  const value = line.trim();
  if (!value.includes("|")) return null;
  const cells = value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.some(Boolean) ? cells : null;
}

export function isMarkdownTableDivider(line: string): boolean {
  const cells = parseMarkdownTableRow(line);
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, ""))));
}

export function renderAssistantMarkdown(container: HTMLElement, value: string): void {
  container.replaceChildren();
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = (lines[index] ?? "").trim();
    if (!line) {
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    const headerCells = parseMarkdownTableRow(line);
    if (headerCells && isMarkdownTableDivider(nextLine)) {
      const wrapper = document.createElement("div");
      wrapper.className = "site-assistant-table-wrap";
      const table = document.createElement("table");
      const header = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const cell of headerCells) {
        const element = document.createElement("th");
        appendInlineMarkdown(element, cell);
        headerRow.append(element);
      }
      header.append(headerRow);
      const body = document.createElement("tbody");
      index += 2;
      while (index < lines.length) {
        const cells = parseMarkdownTableRow(lines[index] ?? "");
        if (!cells || isMarkdownTableDivider(lines[index] ?? "")) break;
        const row = document.createElement("tr");
        for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
          const element = document.createElement("td");
          appendInlineMarkdown(element, cells[cellIndex] ?? "");
          row.append(element);
        }
        body.append(row);
        index += 1;
      }
      table.append(header, body);
      wrapper.append(table);
      container.append(wrapper);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading?.[2]) {
      const element = document.createElement("h3");
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      index += 1;
      continue;
    }

    const ordered = /^\d+\.\s+/.test(line);
    const unordered = /^[-*]\s+/.test(line);
    if (ordered || unordered) {
      const list = document.createElement(ordered ? "ol" : "ul");
      const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (index < lines.length) {
        const itemLine = (lines[index] ?? "").trim();
        if (!marker.test(itemLine)) break;
        const item = document.createElement("li");
        appendInlineMarkdown(item, itemLine.replace(marker, ""));
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "")) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
  }
}
