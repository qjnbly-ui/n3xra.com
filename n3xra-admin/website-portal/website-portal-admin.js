import { getAdminSession } from "/account/admin/admin-session.js?v=2";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const byId = (id) => document.getElementById(id);
const websiteSelect = byId("portal-website-select");
const form = byId("portal-settings-form");
const status = byId("portal-settings-status");
const statusScreen = byId("portal-status");
const features = byId("portal-feature-grid");
let supabase;
let currentUser;
let websites = [];
let domains = [];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function hostname(value = "") {
  const text = String(value).trim().toLowerCase().replace(/\.$/, "");
  if (!text) return "";
  try { return new URL(text.includes("://") ? text : `https://${text}`).hostname; } catch { return ""; }
}

function message(text = "", isError = false) {
  status.textContent = text;
  status.classList.toggle("is-error", isError);
}

async function loadSettings(websiteId) {
  const website = websites.find((item) => item.id === websiteId);
  if (!website) return;
  writeWorkspaceContext("admin", currentUser.id, { websiteId: website.id, name: website.name });
  const siteName = byId("portal-site-name");
  if (siteName) siteName.textContent = `${website.name} Website Portal`;
  const [brandingResult, featureResult, assetResult] = await Promise.all([
    supabase.from("website_portal_branding").select("*").eq("website_id", website.id).maybeSingle(),
    supabase.from("website_portal_features").select("feature_key,enabled").eq("website_id", website.id),
    supabase.from("website_assets").select("id,label").eq("website_id", website.id).in("category", ["logo", "brand", "image"]).order("label"),
  ]);
  for (const result of [brandingResult, featureResult, assetResult]) if (result.error) throw result.error;
  const branding = brandingResult.data || {};
  const options = (assetResult.data || []).map((asset) => `<option value="${asset.id}">${escapeHtml(asset.label)}</option>`).join("");
  byId("portal-logo-asset").innerHTML = `<option value="">Use website name</option>${options}`;
  byId("portal-favicon-asset").innerHTML = `<option value="">Use default favicon</option>${options}`;
  byId("portal-enabled").checked = Boolean(website.portal_enabled);
  byId("portal-domain").value = domains.find((item) => item.website_id === website.id && item.domain_purpose === "portal")?.domain_name || "";
  byId("portal-theme").value = website.portal_theme_id || "classic";
  byId("portal-logo-asset").value = branding.logo_asset_id || "";
  byId("portal-favicon-asset").value = branding.favicon_asset_id || "";
  byId("portal-primary-color").value = branding.primary_color || "#17231b";
  byId("portal-accent-color").value = branding.accent_color || "#b77946";
  byId("portal-heading-font").value = branding.heading_font || "Fraunces";
  byId("portal-body-font").value = branding.body_font || "Manrope";
  byId("portal-powered-by").value = branding.powered_by_label ?? "Powered by N3XRA";
  const values = new Map((featureResult.data || []).map((item) => [item.feature_key, item.enabled]));
  features.querySelectorAll("input").forEach((input) => { input.checked = values.get(input.value) ?? true; });
  message();
}

async function save(event) {
  event.preventDefault();
  const website = websites.find((item) => item.id === websiteSelect.value);
  const domainName = hostname(byId("portal-domain").value);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message("Saving Website Portal…");
  try {
    if (byId("portal-enabled").checked && !domainName) throw new Error("Enter a valid management domain before enabling the portal.");
    const websiteResult = await supabase.from("client_websites").update({ portal_enabled: byId("portal-enabled").checked, portal_theme_id: byId("portal-theme").value }).eq("id", website.id);
    if (websiteResult.error) throw websiteResult.error;
    const brandingResult = await supabase.from("website_portal_branding").upsert({ website_id: website.id, logo_asset_id: byId("portal-logo-asset").value || null, favicon_asset_id: byId("portal-favicon-asset").value || null, primary_color: byId("portal-primary-color").value, accent_color: byId("portal-accent-color").value, heading_font: byId("portal-heading-font").value.trim() || "Fraunces", body_font: byId("portal-body-font").value.trim() || "Manrope", powered_by_label: byId("portal-powered-by").value.trim() }, { onConflict: "website_id" });
    if (brandingResult.error) throw brandingResult.error;
    const oldDomain = domains.find((item) => item.website_id === website.id && item.domain_purpose === "portal");
    if (domainName) {
      const values = { website_id: website.id, domain_name: domainName, domain_purpose: "portal", status: "active", is_primary: false };
      const result = oldDomain ? await supabase.from("website_domains").update(values).eq("id", oldDomain.id) : await supabase.from("website_domains").insert(values);
      if (result.error) throw result.error;
    } else if (oldDomain) {
      const result = await supabase.from("website_domains").delete().eq("id", oldDomain.id);
      if (result.error) throw result.error;
    }
    const featureRows = [...features.querySelectorAll("input")].map((input) => ({ website_id: website.id, feature_key: input.value, enabled: input.checked }));
    const featureResult = await supabase.from("website_portal_features").upsert(featureRows, { onConflict: "website_id,feature_key" });
    if (featureResult.error) throw featureResult.error;
    message("Website Portal saved.");
    await loadAll(website.id);
  } catch (error) { message(error?.message || "Website Portal could not be saved.", true); } finally { button.disabled = false; }
}

async function loadAll(preferredId) {
  const [websiteResult, domainResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,status,portal_enabled,portal_theme_id").order("name"),
    supabase.from("website_domains").select("id,website_id,domain_name,domain_purpose,status"),
  ]);
  if (websiteResult.error) throw websiteResult.error;
  if (domainResult.error) throw domainResult.error;
  websites = websiteResult.data || [];
  domains = domainResult.data || [];
  websiteSelect.innerHTML = websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("");
  const saved = readWorkspaceContext("admin", currentUser.id).websiteId;
  websiteSelect.value = websites.some((item) => item.id === preferredId) ? preferredId : websites.some((item) => item.id === saved) ? saved : websites[0]?.id || "";
  await loadSettings(websiteSelect.value);
}

async function init() {
  const context = await getAdminSession();
  if (!context.allowed) return;
  supabase = context.supabase;
  currentUser = context.user;
  await loadAll();
  websiteSelect.addEventListener("change", () => loadSettings(websiteSelect.value).catch((error) => message(error.message, true)));
  form.addEventListener("submit", save);
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => { statusScreen.textContent = error?.message || "Website Portal could not be opened."; });
