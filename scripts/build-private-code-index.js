const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "api", "_private-code-index.generated.js");
const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".sql", ".md"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".private-secrets",
  ".vercel",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const SKIP_FILES = new Set([
  "shared/config.js",
  "api/_private-code-index.generated.js",
  "project-pulse/manifest.json",
  "package-lock.json",
]);
const MAX_FILE_BYTES = 450000;
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 240;

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function shouldIndex(file) {
  const filePath = relative(file);
  if (SKIP_FILES.has(filePath)) return false;
  if (!ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
  const stat = fs.statSync(file);
  return stat.size > 0 && stat.size <= MAX_FILE_BYTES;
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/\b(?:sk|gsk|sb_secret)_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_SECRET]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|secret|password|service[_-]?role)[\"'\s:=]+)[\"']?[^\"'\s,;]{12,}/gi, "$1[REDACTED]");
}

function chunkFile(file) {
  const filePath = relative(file);
  const source = redactSensitiveText(fs.readFileSync(file, "utf8"));
  const chunks = [];
  let offset = 0;
  let index = 0;

  while (offset < source.length) {
    let end = Math.min(source.length, offset + CHUNK_SIZE);
    if (end < source.length) {
      const newline = source.lastIndexOf("\n", end);
      if (newline > offset + Math.floor(CHUNK_SIZE * 0.65)) end = newline;
    }
    const text = source.slice(offset, end).trim();
    if (text) {
      const line = source.slice(0, offset).split("\n").length;
      chunks.push({ id: `${filePath}:${index}`, file: filePath, line, language: path.extname(file).slice(1), text });
      index += 1;
    }
    if (end >= source.length) break;
    offset = Math.max(end - CHUNK_OVERLAP, offset + 1);
  }
  return chunks;
}

const indexedFiles = walk(ROOT).filter(shouldIndex);
const chunks = indexedFiles.flatMap(chunkFile);
const payload = {
  generatedAt: new Date().toISOString(),
  fileCount: indexedFiles.length,
  chunkCount: chunks.length,
  chunks,
};

fs.writeFileSync(OUTPUT, `module.exports = ${JSON.stringify(payload)};\n`, "utf8");
process.stdout.write(`Wrote private index with ${payload.fileCount} files and ${payload.chunkCount} chunks.\n`);
