type JsonObject = Record<string, any>;
type SupabaseJson = (path: string, options?: RequestInit) => Promise<any>;

export interface CommunicationsEmailBrand {
  name: string;
  websiteUrl: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  headingFont: string;
  bodyFont: string;
  poweredByLabel: string;
}

function firstRow(value: unknown): JsonObject | null {
  return Array.isArray(value) && value[0] && typeof value[0] === "object" ? value[0] as JsonObject : null;
}

function cleanText(value: unknown, fallback: string, maximum = 200): string {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : fallback;
}

function safeColor(value: unknown, fallback: string): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function safeFont(value: unknown, fallback: string): string {
  const font = String(value ?? "").trim();
  return /^[a-z0-9 .'-]{1,100}$/i.test(font) ? font : fallback;
}

function safeHttpsUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export async function loadCommunicationsEmailBrand(database: SupabaseJson, workspace: JsonObject): Promise<CommunicationsEmailBrand> {
  const link = firstRow(await database(`communications_workspace_websites?select=website_id&workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&order=created_at.asc&limit=1`));
  const website = link?.website_id
    ? firstRow(await database(`client_websites?select=id,name,live_url&organization_id=eq.${encodeURIComponent(workspace.organization_id)}&id=eq.${encodeURIComponent(link.website_id)}&limit=1`))
    : null;
  const branding = website?.id
    ? firstRow(await database(`website_portal_branding?select=logo_asset_id,primary_color,accent_color,heading_font,body_font,powered_by_label&website_id=eq.${encodeURIComponent(website.id)}&limit=1`))
    : null;
  let logoUrl = "";
  if (website?.id && branding?.logo_asset_id) {
    const asset = firstRow(await database(`website_assets?select=current_version_id,status&website_id=eq.${encodeURIComponent(website.id)}&id=eq.${encodeURIComponent(branding.logo_asset_id)}&status=eq.active&limit=1`));
    const version = asset?.current_version_id
      ? firstRow(await database(`website_asset_versions?select=public_url,status&asset_id=eq.${encodeURIComponent(branding.logo_asset_id)}&id=eq.${encodeURIComponent(asset.current_version_id)}&status=eq.published&limit=1`))
      : null;
    logoUrl = safeHttpsUrl(version?.public_url);
  }
  return {
    name: cleanText(website?.name, cleanText(workspace.sender_name, cleanText(workspace.program_name, "Organization"))),
    websiteUrl: safeHttpsUrl(website?.live_url) || safeHttpsUrl(workspace.website_url),
    logoUrl,
    primaryColor: safeColor(branding?.primary_color, "#17231b"),
    accentColor: safeColor(branding?.accent_color, "#b77946"),
    headingFont: safeFont(branding?.heading_font, "Georgia"),
    bodyFont: safeFont(branding?.body_font, "Arial"),
    poweredByLabel: cleanText(branding?.powered_by_label, "Sent with N3XRA Communications", 100),
  };
}

export function renderCommunicationsEmail(input: {
  brand: CommunicationsEmailBrand;
  message: string;
  supportEmail: string;
  programName: string;
}): { html: string; text: string } {
  const { brand } = input;
  const footer = `You received this because you subscribed to ${input.programName}. To change your email preference, contact ${input.supportEmail}.`;
  const websiteLine = brand.websiteUrl ? `\n\nVisit ${brand.websiteUrl}` : "";
  const messageHtml = escapeHtml(input.message).replaceAll("\n", "<br>");
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" width="180" alt="${escapeHtml(brand.name)}" style="display:block;max-width:180px;max-height:72px;width:auto;height:auto;border:0;">`
    : `<div style="font-family:${escapeHtml(brand.headingFont)},Georgia,serif;font-size:28px;line-height:1.15;font-weight:700;color:#ffffff;">${escapeHtml(brand.name)}</div>`;
  const websiteButton = brand.websiteUrl
    ? `<tr><td style="padding:0 42px 38px;"><a href="${escapeHtml(brand.websiteUrl)}" style="display:inline-block;padding:13px 20px;background:${brand.accentColor};color:${brand.primaryColor};font-family:${escapeHtml(brand.bodyFont)},Arial,sans-serif;font-size:14px;line-height:1;text-decoration:none;font-weight:700;">Visit our website</a></td></tr>`
    : "";
  return {
    text: `${input.message}${websiteLine}\n\n${footer}\n${brand.poweredByLabel}`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(brand.name)}</title></head><body style="margin:0;padding:0;background:#f2f4f3;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">An update from ${escapeHtml(brand.name)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f4f3;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;"><tr><td style="padding:34px 42px;background:${brand.primaryColor};border-bottom:5px solid ${brand.accentColor};">${logo}</td></tr><tr><td style="padding:42px 42px 16px;"><div style="margin:0 0 14px;color:${brand.accentColor};font-family:${escapeHtml(brand.bodyFont)},Arial,sans-serif;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">An update from ${escapeHtml(brand.name)}</div><div style="color:#24312d;font-family:${escapeHtml(brand.bodyFont)},Arial,sans-serif;font-size:17px;line-height:1.75;">${messageHtml}</div></td></tr>${websiteButton}<tr><td style="padding:24px 42px;background:#f7f8f7;border-top:1px solid #dfe5e2;"><p style="margin:0 0 8px;color:#687671;font-family:Arial,sans-serif;font-size:12px;line-height:1.55;">${escapeHtml(footer)}</p><p style="margin:0;color:#8a9691;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;">${escapeHtml(brand.poweredByLabel)}</p></td></tr></table></td></tr></table></body></html>`,
  };
}
