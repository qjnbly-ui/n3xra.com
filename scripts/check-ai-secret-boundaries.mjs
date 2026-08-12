import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const skippedTopLevel = new Set([".git", ".github", ".private-secrets", ".vercel", "api", "docs", "node_modules", "scripts", "src", "supabase", "tests"]);
const browserExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"]);
const secretShape = /\b(?:sk[-_]|gsk_|sb_secret_)[A-Za-z0-9_-]{12,}\b/g;
const serverOnlyName = /\b(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|GROQ_API_KEY|GROQ_RECORDS_API_KEY|OPENAI_API_KEY)\b/g;
const actualSecretNames = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "GROQ_API_KEY", "GROQ_RECORDS_API_KEY", "OPENAI_API_KEY"];
const failures = [];

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (directory === root && skippedTopLevel.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const browserFiles = walk(root).filter((file) => browserExtensions.has(path.extname(file).toLowerCase()));
for (const file of browserFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (secretShape.test(source)) failures.push(`${path.relative(root, file)} contains a secret-shaped token`);
  secretShape.lastIndex = 0;
  if (serverOnlyName.test(source)) failures.push(`${path.relative(root, file)} references a server-only secret variable`);
  serverOnlyName.lastIndex = 0;
}

const generatedFiles = [
  path.join(root, "api", "_private-code-index.generated.js"),
  ...(fs.existsSync(path.join(root, "api", "_ai-core"))
    ? fs.readdirSync(path.join(root, "api", "_ai-core")).filter((name) => name.endsWith(".js")).map((name) => path.join(root, "api", "_ai-core", name))
    : []),
].filter((file) => fs.existsSync(file));

const configuredSecrets = actualSecretNames.flatMap((name) => {
  const value = String(process.env[name] || "").trim();
  return value.length >= 8 ? [{ name, value }] : [];
});
for (const file of [...browserFiles, ...generatedFiles]) {
  const source = fs.readFileSync(file, "utf8");
  if (secretShape.test(source)) failures.push(`${path.relative(root, file)} contains a secret-shaped token`);
  secretShape.lastIndex = 0;
  for (const secret of configuredSecrets) {
    if (source.includes(secret.value)) failures.push(`${path.relative(root, file)} contains the configured ${secret.name} value`);
  }
}

if (failures.length) {
  console.error(`Secret-boundary verification failed:\n${[...new Set(failures)].map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log(`PASS secret boundaries · ${browserFiles.length} browser files and ${generatedFiles.length} generated server files scanned`);
