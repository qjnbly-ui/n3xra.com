const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "api", "records-guide-registry.json");
const GUIDE_BEHAVIOR_VERSION = 1;
const PAGE_SOURCES = [
  { route: "/n3xra-records/library", file: "n3xra-records/library/index.html" },
  { route: "/n3xra-records/meeting-notes", file: "n3xra-records/meeting-notes/index.html" },
  { route: "/n3xra-records/documents.html", file: "n3xra-records/documents.html" },
  { route: "/n3xra-records/messages.html", file: "n3xra-records/messages.html" },
  { route: "/n3xra-records/account/", file: "n3xra-records/account/index.html" },
];
const GUIDEABLE_TAGS = new Set(["a", "button", "input", "select", "textarea"]);

function removeAriaHiddenMarkup(value) {
  let output = String(value || "");
  let opening = output.match(/<([a-z][\w-]*)\b[^>]*aria-hidden=["']true["'][^>]*>/i);
  while (opening) {
    const tag = opening[1];
    const start = opening.index;
    const tokenPattern = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}>`, "gi");
    let depth = 0;
    let end = start + opening[0].length;
    for (const token of output.slice(start).matchAll(tokenPattern)) {
      depth += token[0].startsWith("</") ? -1 : 1;
      end = start + token.index + token[0].length;
      if (depth === 0) break;
    }
    output = `${output.slice(0, start)} ${output.slice(end)}`;
    opening = output.match(/<([a-z][\w-]*)\b[^>]*aria-hidden=["']true["'][^>]*>/i);
  }
  return output;
}

function decodeHtml(value) {
  return removeAriaHiddenMarkup(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readAttribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function humanizeId(value) {
  return String(value || "")
    .replace(/^(mobile-menu-|records-|admin-)/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractPageTargets(source) {
  const labels = new Map();
  for (const match of source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const nestedControl = match[2].match(/<(?:input|select|textarea)\b([^>]*)>/i);
    const targetId = readAttribute(match[1], "for") || readAttribute(nestedControl?.[1] || "", "id");
    const strong = match[2].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    const label = decodeHtml(strong?.[1] || match[2]);
    if (targetId && label) labels.set(targetId, label.replace(/\s+\*$/, ""));
  }

  const targets = [];
  const ids = new Set();
  for (const match of source.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (!GUIDEABLE_TAGS.has(tag)) continue;
    const attributes = match[2];
    const id = readAttribute(attributes, "id");
    if (!id || ids.has(id)) continue;
    ids.add(id);

    let label = labels.get(id)
      || readAttribute(attributes, "aria-label")
      || readAttribute(attributes, "title")
      || readAttribute(attributes, "placeholder");
    if (!label && (tag === "button" || tag === "a")) {
      const closingTag = `</${tag}>`;
      const contentStart = match.index + match[0].length;
      const contentEnd = source.toLowerCase().indexOf(closingTag, contentStart);
      if (contentEnd !== -1) label = decodeHtml(source.slice(contentStart, contentEnd));
    }
    label = String(label || humanizeId(id)).slice(0, 140);
    const type = tag === "input" ? (readAttribute(attributes, "type") || "text") : tag;
    targets.push({ id, label, kind: type });
  }
  return targets.sort((a, b) => a.id.localeCompare(b.id));
}

const pages = PAGE_SOURCES.map(({ route, file }) => {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  return { route, source: file, targets: extractPageTargets(source) };
});

const registry = {
  schemaVersion: 1,
  behaviorVersion: GUIDE_BEHAVIOR_VERSION,
  safety: {
    allowedEffects: ["navigate", "highlight", "reveal_disclosure", "select_tab", "select_radio"],
    prohibitedEffects: ["submit", "delete", "send", "upload", "start_recording", "start_call", "change_setting"],
  },
  pages,
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${OUTPUT}\n`);
