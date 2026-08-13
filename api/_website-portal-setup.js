const dns = require("node:dns").promises;
const net = require("node:net");
const { standardPortalHostname } = require("./_website-portal-tenant");

const DEFAULT_BRAND = Object.freeze({
  primary_color: "#17231b",
  accent_color: "#b77946",
  heading_font: "Fraunces",
  body_font: "Manrope",
  powered_by_label: "Powered by N3XRA",
});

const FEATURE_DEFAULTS = Object.freeze({
  overview: true,
  progress: true,
  files_assets: true,
  services: true,
  billing: true,
  support: true,
});

function clean(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeHostname(value = "") {
  const text = clean(value).toLowerCase().replace(/\.$/, "");
  if (!text) return "";
  try {
    return new URL(text.includes("://") ? text : `https://${text}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function normalizedUrl(value = "") {
  const text = clean(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function isPrivateAddress(address = "") {
  const value = String(address).toLowerCase();
  if (!value) return true;
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateAddress(mappedIpv4);
  if (value === "::" || value === "::1" || value === "0.0.0.0" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("2001:db8:")) return true;
  if (net.isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 2, 168].includes(b))
    || (a === 198 && [18, 19, 51].includes(b))
    || (a === 203 && b === 0)
    || a >= 224;
}

async function assertPublicUrl(input, lookup = dns.lookup) {
  const value = normalizedUrl(input);
  if (!value) throw new Error("The recorded website URL is invalid.");
  const url = new URL(value);
  if (["localhost", "localhost.localdomain"].includes(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("Local network addresses cannot be scanned.");
  }
  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) throw new Error("Private network addresses cannot be scanned.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses?.length || addresses.some((row) => isPrivateAddress(row.address))) {
    throw new Error("The website hostname does not resolve to a public address.");
  }
  return url;
}

async function fetchPublicText(input, { fetchImpl = fetch, lookup = dns.lookup, maxBytes = 1_500_000, redirects = 3 } = {}) {
  let url = await assertPublicUrl(input, lookup);
  for (let index = 0; index <= redirects; index += 1) {
    const response = await fetchImpl(url, {
      redirect: "manual",
      headers: { "User-Agent": "N3XRA-Portal-Setup/1.0", Accept: "text/html,text/css;q=0.9,*/*;q=0.1" },
      signal: AbortSignal.timeout(8_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || index === redirects) throw new Error("The live website redirected too many times.");
      url = await assertPublicUrl(new URL(location, url).toString(), lookup);
      continue;
    }
    if (!response.ok) throw new Error(`The live website returned ${response.status}.`);
    const size = Number(response.headers.get("content-length") || 0);
    if (size > maxBytes) throw new Error("The live website response is too large to inspect safely.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("The live website response is too large to inspect safely.");
    return { text: buffer.toString("utf8"), url: url.toString(), contentType: response.headers.get("content-type") || "" };
  }
  throw new Error("The live website could not be inspected.");
}

function expandHex(value = "") {
  const normalized = String(value).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{3}$/.test(normalized)) return `#${normalized.slice(1).split("").map((part) => `${part}${part}`).join("")}`;
  if (/^#[0-9a-f]{8}$/.test(normalized)) return normalized.slice(0, 7);
  if (/^#[0-9a-f]{4}$/.test(normalized)) return `#${normalized.slice(1, 4).split("").map((part) => `${part}${part}`).join("")}`;
  return "";
}

function colorChannels(value = "") {
  const hex = expandHex(value);
  return hex ? [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) : null;
}

function relativeLuminance(value = "") {
  const channels = colorChannels(value);
  if (!channels) return 1;
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function colorContrast(left, right) {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function colorChroma(value = "") {
  const channels = colorChannels(value);
  return channels ? Math.max(...channels) - Math.min(...channels) : 0;
}

function colorQuality(value = "") {
  const hex = expandHex(value);
  if (!hex) return -1;
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const saturation = max - min;
  const brightness = channels.reduce((total, channel) => total + channel, 0) / 3;
  if (brightness < 4 || brightness > 248) return -1;
  return saturation + Math.abs(128 - brightness) / 8;
}

function detectColorCandidates(source = "") {
  const candidates = new Map();
  const add = (rawValue, { score = 0, primaryScore = 0, accentScore = 0 } = {}) => {
    const value = expandHex(rawValue);
    if (colorQuality(value) < 0) return;
    const current = candidates.get(value) || { value, count: 0, score: colorQuality(value) / 4, primaryScore: 0, accentScore: 0 };
    current.count += 1;
    current.score += score;
    current.primaryScore = Math.max(current.primaryScore, primaryScore);
    current.accentScore = Math.max(current.accentScore, accentScore);
    candidates.set(value, current);
  };
  const text = String(source);

  for (const match of text.matchAll(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b/g)) {
    add(match[0], { score: 4 });
  }

  for (const match of text.matchAll(/([\w-]+)\s*:\s*([^;}]+)/g)) {
    const property = match[1].toLowerCase();
    const values = match[2].match(/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b/g) || [];
    const isStrongPrimaryName = /(?:^|[-_])(primary|brand|theme|main|bg|navy|forest|pine|moss|green|dark)(?:[-_]|$)/.test(property);
    const isFallbackPrimaryName = /(?:^|[-_])(ink|charcoal|black)(?:[-_]|$)/.test(property);
    const isAccentName = /(?:^|[-_])(accent|secondary|highlight|gold|lime|sun|orange|cta|action)(?:[-_]|$)/.test(property);
    const isUtilityName = /(?:^|[-_])(paper|surface|card|light|muted|border|line|shadow|overlay|danger|error|success|warning)(?:[-_]|$)/.test(property);
    const isBackground = /(?:^|-)background(?:-color)?$/.test(property);
    const isDecorative = /(?:^|-)(border|outline|fill|stroke)(?:-|$)/.test(property);
    for (const value of values) {
      add(value, {
        score: isUtilityName ? 0 : 8,
        primaryScore: (isStrongPrimaryName ? 220 : (isFallbackPrimaryName ? 110 : 0)) + (isBackground && !isUtilityName ? 35 : 0),
        accentScore: (isAccentName ? 180 : 0) + (isDecorative && !isUtilityName ? 18 : 0),
      });
    }
  }

  for (const tag of text.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/name\s*=\s*["']theme-color["']/i.test(tag[0])) continue;
    const value = tag[0].match(/content\s*=\s*["'](#[0-9a-fA-F]{3,8})["']/i)?.[1];
    if (value) add(value, { score: 80, primaryScore: 240 });
  }

  return [...candidates.values()]
    .map((candidate) => ({ ...candidate, score: candidate.score + candidate.count * 2 }))
    .sort((left, right) => Math.max(right.primaryScore, right.accentScore, right.score) - Math.max(left.primaryScore, left.accentScore, left.score))
    .slice(0, 12);
}

function detectColors(source = "") {
  return detectColorCandidates(source).map((candidate) => candidate.value).slice(0, 8);
}

function choosePortalColors(detectedColors = [], branding = {}) {
  const palette = detectedColors
    .map((candidate, index) => typeof candidate === "string"
      ? { value: expandHex(candidate), score: Math.max(0, 8 - index) * 3, primaryScore: 0, accentScore: 0 }
      : { ...candidate, value: expandHex(candidate?.value) })
    .filter((candidate) => candidate.value);
  const savedPrimary = expandHex(branding.primary_color) || DEFAULT_BRAND.primary_color;
  const savedAccent = expandHex(branding.accent_color) || DEFAULT_BRAND.accent_color;
  const primaryWasCustomized = savedPrimary !== DEFAULT_BRAND.primary_color;
  const accentWasCustomized = savedAccent !== DEFAULT_BRAND.accent_color;

  // Treat the saved palette as one intentional choice. This protects a site such
  // as Roots and Relics even when only one of its two colors differs from defaults.
  if (primaryWasCustomized || accentWasCustomized) {
    return { primary_color: savedPrimary, accent_color: savedAccent };
  }

  const primary = palette
    .map((candidate) => ({
      color: candidate.value,
      score: candidate.primaryScore + candidate.score + colorContrast(candidate.value, "#ffffff") * 14 + colorChroma(candidate.value) * 0.3,
      minimumContrast: candidate.primaryScore >= 80 ? 4.5 : 7,
    }))
    .filter((candidate) => colorContrast(candidate.color, "#ffffff") >= candidate.minimumContrast)
    .sort((left, right) => right.score - left.score)[0]?.color || savedPrimary;

  const accent = palette
    .filter((candidate) => candidate.value !== primary)
    .map((candidate) => ({
      color: candidate.value,
      score: candidate.accentScore + candidate.score * 0.5 + colorContrast(candidate.value, primary) * 18 + colorChroma(candidate.value) * 0.7,
    }))
    .filter((candidate) => colorContrast(candidate.color, primary) >= 3)
    .sort((left, right) => right.score - left.score)[0]?.color || savedAccent;

  return { primary_color: primary, accent_color: accent };
}

function cleanFontFamily(value = "") {
  const ignored = new Set(["inherit", "initial", "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
  return String(value).split(",").map((part) => part.trim().replace(/^['\"]|['\"]$/g, "")).find((part) => part && !ignored.has(part.toLowerCase()) && !part.startsWith("var(")) || "";
}

function detectFonts(source = "") {
  const values = [];
  for (const match of String(source).matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const value = cleanFontFamily(match[1]);
    if (value && !values.some((item) => item.toLowerCase() === value.toLowerCase())) values.push(value);
  }
  return values.slice(0, 6);
}

function detectLinkedStylesheets(html = "", pageUrl = "") {
  const page = new URL(pageUrl);
  const values = [];
  for (const match of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel\s*=\s*["'][^"']*stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, page);
      if (url.origin === page.origin && !values.includes(url.toString())) values.push(url.toString());
    } catch {
      // Ignore malformed stylesheet URLs from the live site.
    }
  }
  return values.slice(0, 4);
}

function assetScore(asset, kind) {
  const text = `${asset.asset_key || ""} ${asset.label || ""} ${asset.category || ""}`.toLowerCase();
  if (kind === "favicon") return (text.includes("favicon") ? 100 : 0) + (text.includes("icon") ? 40 : 0) + (asset.category === "logo" ? 10 : 0);
  return (asset.category === "logo" ? 80 : 0) + (text.includes("logo") ? 60 : 0) + (text.includes("brand") ? 20 : 0) - (text.includes("favicon") ? 80 : 0);
}

function bestAsset(assets = [], kind) {
  return [...assets].filter((asset) => asset.status !== "archived").sort((a, b) => assetScore(b, kind) - assetScore(a, kind))[0] || null;
}

function proposedPortalDomain(records = {}) {
  return standardPortalHostname(records.website, process.env.PORTAL_ROOT_DOMAIN || "portal.n3xra.com");
}

function publicAssetOptions(assets = [], versions = []) {
  const versionMap = new Map(versions.map((version) => [version.id, version]));
  return assets.filter((asset) => asset.status !== "archived").map((asset) => {
    const version = versionMap.get(asset.current_version_id);
    return {
      id: asset.id,
      label: asset.label,
      category: asset.category,
      asset_key: asset.asset_key,
      public_url: version?.public_url || null,
      mime_type: version?.mime_type || null,
    };
  });
}

function connection(key, label, state, detail, { required = false, action = "" } = {}) {
  return { key, label, state, detail, required, action };
}

function chooseRepository(records = {}) {
  return records.repositories?.find((row) => row.provider === "github" && row.access_status === "available")
    || records.repositories?.find((row) => row.provider === "github")
    || (records.website?.repository_full_name ? { provider: "github", full_name: records.website.repository_full_name, default_branch: "main", access_status: "recorded" } : null);
}

function chooseVercelService(records = {}) {
  return records.services?.find((row) => /vercel/i.test(`${row.provider || ""} ${row.name || ""}`) && row.status === "active")
    || records.services?.find((row) => /vercel/i.test(`${row.provider || ""} ${row.name || ""}`))
    || null;
}

function vercelScopeQuery({ teamId = "", teamSlug = "" } = {}) {
  const params = new URLSearchParams();
  if (teamId) params.set("teamId", teamId);
  else if (teamSlug) params.set("slug", teamSlug);
  return params;
}

function projectMatchesRepository(project, repository) {
  if (!project || !repository?.full_name) return false;
  const [owner, name] = repository.full_name.toLowerCase().split("/");
  const link = project.link || {};
  const linkedOwner = clean(link.org || link.owner || link.gitOwner || link.repoOwner).toLowerCase();
  const linkedName = clean(link.repo || link.repoName || link.slug).replace(/\.git$/i, "").toLowerCase();
  return linkedName === name && (!linkedOwner || linkedOwner === owner);
}

async function verifyVercel(records, repository, { fetchImpl = fetch, vercelToken = "", teamId = "", teamSlug = "" } = {}) {
  if (!vercelToken) return null;
  const service = chooseVercelService(records);
  const metadata = service?.metadata && typeof service.metadata === "object" ? service.metadata : {};
  const recordedProject = clean(metadata.project_id || metadata.projectId || metadata.project_name || metadata.projectName || service?.account_identifier);
  const params = vercelScopeQuery({ teamId, teamSlug });
  try {
    let project = null;
    if (recordedProject) {
      const query = params.toString();
      const response = await fetchImpl(`https://api.vercel.com/v9/projects/${encodeURIComponent(recordedProject)}${query ? `?${query}` : ""}`, {
        headers: { Authorization: `Bearer ${vercelToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      });
      if (response.ok) project = await response.json();
    } else if (repository?.full_name) {
      params.set("limit", "100");
      const response = await fetchImpl(`https://api.vercel.com/v9/projects?${params.toString()}`, {
        headers: { Authorization: `Bearer ${vercelToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        const data = await response.json();
        project = (data.projects || []).find((item) => projectMatchesRepository(item, repository)) || null;
      }
    }
    if (!project) return { verified: false };
    return {
      verified: true,
      id: project.id || null,
      name: project.name || recordedProject || null,
      framework: project.framework || null,
      live: project.live !== false && project.paused !== true,
    };
  } catch {
    return { verified: false };
  }
}

async function verifyGithub(repository, { fetchImpl = fetch, token = "" } = {}) {
  if (!repository?.full_name || repository.provider !== "github") return null;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(repository.full_name.split("/")[0])}/${encodeURIComponent(repository.full_name.split("/")[1] || "")}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "N3XRA-Portal-Setup/1.0", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return { verified: false, status: response.status };
    const data = await response.json();
    return { verified: true, default_branch: data.default_branch || repository.default_branch, visibility: data.visibility || (data.private ? "private" : "public") };
  } catch {
    return { verified: false, status: 0 };
  }
}

async function inspectLiveBranding(liveUrl, options = {}) {
  if (!liveUrl) return { connected: false, colors: [], fonts: [], sourceUrl: "", error: "No live URL is recorded." };
  try {
    const page = await fetchPublicText(liveUrl, options);
    const stylesheets = detectLinkedStylesheets(page.text, page.url);
    const cssResults = await Promise.allSettled(stylesheets.map((url) => fetchPublicText(url, { ...options, maxBytes: 600_000, redirects: 2 })));
    const source = [page.text, ...cssResults.filter((result) => result.status === "fulfilled").map((result) => result.value.text)].join("\n");
    const candidates = detectColorCandidates(source);
    return { connected: true, colors: candidates.map((candidate) => candidate.value).slice(0, 8), colorCandidates: candidates, fonts: detectFonts(source), sourceUrl: page.url, error: "" };
  } catch (error) {
    return { connected: false, colors: [], fonts: [], sourceUrl: normalizedUrl(liveUrl), error: error?.message || "The live site could not be scanned." };
  }
}

async function analyzePortalSetup(records, options = {}) {
  const assets = publicAssetOptions(records.assets, records.versions);
  const logo = bestAsset(assets, "logo");
  const favicon = bestAsset(assets, "favicon");
  const repository = chooseRepository(records);
  const vercel = chooseVercelService(records);
  const [remote, github, vercelApi] = options.includeRemote
    ? await Promise.all([
      inspectLiveBranding(records.website?.live_url, options),
      verifyGithub(repository, options),
      verifyVercel(records, repository, options),
    ])
    : [{ connected: null, colors: [], fonts: [], sourceUrl: normalizedUrl(records.website?.live_url), error: "" }, null, null];
  const branding = records.branding || {};
  const portalColors = choosePortalColors(remote.colorCandidates || remote.colors, branding);
  const savedPortal = records.domains?.find((row) => row.domain_purpose === "portal");
  const proposed = {
    portal_domain: proposedPortalDomain(records),
    management_domain: normalizeHostname(savedPortal?.domain_name),
    theme_id: records.website?.portal_theme_id || "classic",
    logo_asset_id: branding.logo_asset_id || logo?.id || null,
    favicon_asset_id: branding.favicon_asset_id || favicon?.id || logo?.id || null,
    primary_color: portalColors.primary_color,
    accent_color: portalColors.accent_color,
    heading_font: remote.fonts[0] || branding.heading_font || DEFAULT_BRAND.heading_font,
    body_font: remote.fonts.find((font) => font !== remote.fonts[0]) || branding.body_font || DEFAULT_BRAND.body_font,
    powered_by_label: branding.powered_by_label ?? DEFAULT_BRAND.powered_by_label,
    features: { ...FEATURE_DEFAULTS, ...Object.fromEntries((records.features || []).map((row) => [row.feature_key, row.enabled])) },
  };
  const activeMembers = (records.members || []).filter((member) => member.status === "active");
  const websiteStatus = records.website?.status || "missing";
  const websiteState = websiteStatus === "active" ? "connected" : (websiteStatus === "draft" ? "default" : "attention");
  const websiteDetail = websiteStatus === "active"
    ? `${records.website.name} is active`
    : (websiteStatus === "draft" ? `${records.website.name} is a draft · portal testing is allowed` : `Website status is ${websiteStatus}`);
  const wildcardReady = options.portalRootVerified === true;
  const connections = [
    connection("website", "Website record", websiteState, websiteDetail, { required: true, action: "/n3xra-admin/websites/" }),
    connection("portal_host", "N3XRA portal address", wildcardReady ? "connected" : "attention", wildcardReady ? `${proposed.portal_domain} · shared wildcard verified` : `${proposed.portal_domain || "Portal address"} · wildcard infrastructure is not verified yet`, { required: true, action: "/n3xra-admin/website-portal/" }),
    connection("membership", "Client access", activeMembers.length ? "connected" : "attention", activeMembers.length ? `${activeMembers.length} active website member${activeMembers.length === 1 ? "" : "s"}` : "Assign at least one active website member before activation", { required: true, action: "/n3xra-admin/websites/" }),
    connection("domain", "Custom portal domain", savedPortal ? (savedPortal.status === "active" ? "connected" : "attention") : "default", savedPortal ? `${savedPortal.domain_name} · ${savedPortal.status}` : "Optional · the N3XRA portal address will be used", { action: "/n3xra-admin/services/" }),
    connection("branding", "Branding", proposed.logo_asset_id ? "connected" : "default", proposed.logo_asset_id ? `${assets.find((asset) => asset.id === proposed.logo_asset_id)?.label || "Logo"} and brand settings detected` : "Safe N3XRA defaults will be used", { required: true, action: "/n3xra-admin/assets/" }),
    connection("github", "GitHub", repository ? (github?.verified ? "connected" : (github ? "attention" : "recorded")) : "missing", repository ? `${repository.full_name}${github?.verified ? ` · ${github.default_branch || repository.default_branch || "main"}` : ""}` : "No repository is connected", { action: "/n3xra-admin/services/" }),
    connection("vercel", "Vercel", vercelApi?.verified ? (vercelApi.live ? "connected" : "attention") : (vercel?.status === "active" ? "recorded" : (vercel ? "attention" : "missing")), vercelApi?.verified ? `${vercelApi.name} · API verified${vercelApi.framework ? ` · ${vercelApi.framework}` : ""}` : (vercel ? `${vercel.name}${vercel.public_url ? ` · ${vercel.public_url}` : ""}` : (vercelApi ? "No Vercel project matched the connected repository" : "No Vercel hosting record is connected")), { action: "/n3xra-admin/services/" }),
    connection("supabase", "Supabase", "connected", `N3XRA shared project · ${assets.length} website asset${assets.length === 1 ? "" : "s"} isolated by website`, { required: true, action: "/n3xra-admin/assets/" }),
    connection("live_site", "Live website", remote.connected === true ? "connected" : (remote.connected === false ? "attention" : (records.website?.live_url ? "recorded" : "missing")), remote.connected === true ? remote.sourceUrl : (remote.error || records.website?.live_url || "No live URL is recorded"), { action: "/n3xra-admin/websites/" }),
  ];
  const requiredReady = connections.filter((item) => item.required).every((item) => ["connected", "default"].includes(item.state));
  const completed = connections.filter((item) => ["connected", "recorded", "default"].includes(item.state)).length;
  return {
    website: {
      id: records.website.id,
      name: records.website.name,
      status: records.website.status,
      live_url: records.website.live_url,
      portal_enabled: Boolean(records.website.portal_enabled),
      portal_slug: records.website.portal_slug || records.website.slug,
      organization_id: records.website.organization_id || null,
    },
    proposed,
    assets,
    connections,
    readiness: { activation_ready: requiredReady, completed, total: connections.length, percent: Math.round((completed / connections.length) * 100) },
    discovery: { remote_scanned: Boolean(options.includeRemote), live_site: remote, detected_colors: remote.colors, detected_fonts: remote.fonts },
  };
}

module.exports = {
  DEFAULT_BRAND,
  FEATURE_DEFAULTS,
  analyzePortalSetup,
  choosePortalColors,
  detectColorCandidates,
  detectColors,
  detectFonts,
  normalizeHostname,
  proposedPortalDomain,
  verifyVercel,
};
