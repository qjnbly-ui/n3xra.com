import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

const page = document.body?.dataset?.workspacePage || "home";
const el = (id) => document.getElementById(id);

const logoutButton = el("workspace-logout");
const statusLine = el("workspace-status");
const title = el("workspace-title");
const subtitle = el("workspace-subtitle");
const statusPill = el("workspace-status-pill");
const progress = el("workspace-progress");
const progressCopy = el("workspace-progress-copy");
const portalLinks = [el("workspace-portal-link"), el("workspace-mobile-portal-link"), el("workspace-preview-link")].filter(Boolean);
const dashboardGrid = el("workspace-dashboard-grid");
const summaryOrganization = el("summary-organization");
const summaryStatus = el("summary-status");
const summaryLaunch = el("summary-launch");
const summaryUtilityProgress = el("summary-utility-progress");
const summaryN3xraProgress = el("summary-n3xra-progress");
const utilityStepList = el("utility-step-list");
const n3xraStepList = el("n3xra-step-list");
const moduleGrid = el("workspace-module-grid");
const profileForm = el("profile-form");
const brandingForm = el("branding-form");
const logoImage = el("workspace-logo-image");
const logoFallback = el("workspace-logo-fallback");
const logoNote = el("workspace-logo-note");
const teamForm = el("team-member-form");
const teamMemberList = el("team-member-list");
const teamInviteList = el("team-invite-list");
const teamRoleSelect = el("team-role-select");
const teamRoleList = el("team-role-list");
const teamCurrentRole = el("team-current-role");
const meterBillingForm = el("meter-billing-form");
const meterBillingFile = el("meter-billing-file");
const meterBillingTemplate = el("meter-billing-template");
const meterBillingApplyTemplate = el("meter-billing-apply-template");
const meterMappingGrid = el("meter-mapping-grid");
const meterPreviewWrap = el("meter-preview-wrap");
const meterPreviewTable = el("meter-preview-table");
const meterReviewTable = el("meter-review-table");
const meterBillingExport = el("meter-billing-export");
const meterBillingHistory = el("meter-billing-history");
const meterBillingCurrentPeriod = el("meter-billing-current-period");
const meterBillingCurrentSummary = el("meter-billing-current-summary");
const meterBillingReviewCopy = el("meter-billing-review-copy");

let supabase = null;
let session = null;
let workspace = null;
let meterCsv = { headers: [], rows: [], fileName: "" };

function setStatus(message, tone = "") {
  if (!statusLine) return;
  statusLine.textContent = message || "";
  statusLine.className = "status-line";
  if (tone) statusLine.classList.add(tone);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getOrgParam() {
  return String(new URLSearchParams(window.location.search).get("org") || "").trim();
}

function organizationId() {
  return workspace?.organization?.id || "";
}

function isOnboardingComplete(organization) {
  return organization?.status === "active" && organization?.launch_status === "live";
}

function routeWithOrg(path) {
  const slug = workspace?.organization?.slug || getOrgParam();
  return slug ? `${path}?org=${encodeURIComponent(slug)}` : path;
}

function moduleByKey(key) {
  return (workspace?.modules || []).find((module) => module.module_key === key) || null;
}

function moduleMetadata(module) {
  return module?.metadata && typeof module.metadata === "object" ? module.metadata : {};
}

function isToggleableModule(module) {
  const metadata = moduleMetadata(module);
  return metadata.available === true || metadata.toggleable === true;
}

function displayModuleState(module, fallback = "coming_soon") {
  const state = module?.state || fallback;
  if (!isToggleableModule(module)) return "coming_soon";
  return state;
}

function moduleAvailabilityRank(module) {
  const state = displayModuleState(module);
  if (state === "enabled") return 0;
  if (state === "disabled") return 1;
  return 2;
}

function dashboardModuleStatus(key, fallback = "coming_soon") {
  const module = moduleByKey(key);
  const metadata = moduleMetadata(module);
  if (metadata.dashboard_route && module?.state === "enabled") return "Open";
  return moduleStateLabel(displayModuleState(module, fallback));
}

function isModuleEnabled(key) {
  return moduleByKey(key)?.state === "enabled";
}

function dashboardModuleHref(key) {
  const module = moduleByKey(key);
  const metadata = moduleMetadata(module);
  if (module?.state !== "enabled") return "";
  return String(metadata.dashboard_route || "").trim();
}

function moduleStateLabel(state) {
  const labels = {
    enabled: "On",
    disabled: "Inactive",
    requestable: "Coming soon",
    coming_soon: "Coming soon",
    requires_n3xra_setup: "Coming soon",
  };
  return labels[state] || titleCase(state);
}

function roleLabel(role) {
  return role?.display_name || titleCase(role?.name || "staff");
}

function roleDescription(role) {
  const fallback = {
    owner: "Full workspace control, billing decisions, team access, and launch settings.",
    admin: "Manages setup, account settings, workspace features, and team access.",
    staff: "Works inside enabled modules without changing account-level settings.",
    finance: "Handles billing, payment, and finance-related workspace areas.",
    support: "Handles customer support, requests, notes, and communication workflows.",
    viewer: "Read-only access to available workspace information.",
  };
  const description = String(role?.description || "").trim();
  const roleName = String(role?.name || "").trim().toLowerCase();
  if (description && description.toLowerCase() !== roleName) return description;
  return fallback[roleName] || "Workspace access role.";
}

function buildInviteUrl(invite) {
  if (invite?.invite_url) return invite.invite_url;
  const params = new URLSearchParams();
  params.set("invite", invite?.code || "");
  if (invite?.recipient_email) params.set("email", invite.recipient_email);
  return `${window.location.origin}/utilities/login?${params.toString()}`;
}

function dashboardCards() {
  const organization = workspace?.organization || {};
  const complete = isOnboardingComplete(organization);
  const requiredCompleted = workspace?.progress?.required_completed || 0;
  const requiredTotal = workspace?.progress?.required_total || 0;
  return [
    {
      title: complete ? "Onboarding complete" : "Finish onboarding",
      description: complete
        ? "Setup is complete. Review launch history and setup status any time."
        : "Complete setup tasks and track what N3XRA still needs to finish.",
      status: complete ? "Complete" : `${requiredCompleted}/${requiredTotal} required`,
      href: routeWithOrg("/utilities/workspace/onboarding"),
      tone: complete ? "is-complete" : "is-highlighted",
    },
    {
      title: "Account settings",
      description: "Company profile, contacts, branding, portal URL, and account details.",
      status: "Open",
      href: routeWithOrg("/utilities/workspace/settings"),
      tone: "is-active",
    },
    {
      title: "Team access",
      description: "Add staff, assign roles, suspend access, and manage who can open this utility workspace.",
      status: "Open",
      href: routeWithOrg("/utilities/workspace/team"),
      tone: "is-active",
    },
    {
      title: "Dashboard settings",
      description: "Control available workspace areas and see which future modules are coming soon.",
      status: "Open",
      href: routeWithOrg("/utilities/workspace/features"),
      tone: "is-active",
    },
    {
      title: "Meter billing",
      description: "Upload meter CSV exports, calculate allowance overages, review rows, and export approved charges.",
      status: dashboardModuleStatus("meter_billing", "enabled"),
      href: dashboardModuleHref("meter_billing"),
      tone: isModuleEnabled("meter_billing") ? "is-active" : "is-inactive",
    },
    {
      title: "Customer accounts",
      description: "Customer search, account profiles, service addresses, and account history.",
      status: dashboardModuleStatus("customers"),
      tone: isModuleEnabled("customers") ? "is-enabled" : "is-inactive",
    },
    {
      title: "Work orders",
      description: "Service requests, assignments, internal notes, and status updates.",
      status: dashboardModuleStatus("service_requests"),
      tone: isModuleEnabled("service_requests") ? "is-enabled" : "is-inactive",
    },
    {
      title: "Meter logs",
      description: "Meter reading logs, submissions, history, and meter issue tracking.",
      status: dashboardModuleStatus("meter_readings", "coming_soon"),
      tone: "is-inactive",
    },
    {
      title: "GIS Maps",
      description: "Map-based utility operations and service-area views.",
      status: dashboardModuleStatus("gis_maps", "coming_soon"),
      tone: "is-inactive",
    },
    {
      title: "N3XRA Records",
      description: "Documents, meeting records, board packets, and utility records.",
      status: dashboardModuleStatus("n3xra_records", "coming_soon"),
      href: dashboardModuleHref("n3xra_records"),
      tone: isModuleEnabled("n3xra_records") ? "is-active" : "is-inactive",
    },
  ];
}

async function apiFetch(options = {}) {
  const accessToken = session?.access_token || "";
  if (!accessToken) throw new Error("Authentication required.");
  const org = getOrgParam();
  const response = await fetch(`/api/utilities-workspace${options.method ? "" : org ? `?org=${encodeURIComponent(org)}` : ""}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Utilities workspace request failed.");
  return data;
}

function setInput(form, name, value) {
  const input = form?.elements?.[name];
  if (!input) return;
  if (input.type === "checkbox") input.checked = Boolean(value);
  else if (input.type === "color") input.value = /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : input.defaultValue;
  else input.value = value || "";
}

function renderHero() {
  const organization = workspace?.organization;
  if (!organization) {
    if (title) title.textContent = "No utility workspace found";
    return;
  }
  document.title = `${organization.name} | Utility Workspace`;
  if (title) title.textContent = organization.name || "Utility workspace";
  if (statusPill) statusPill.textContent = titleCase(organization.launch_status || "setup");
  if (progress) progress.textContent = `${workspace.progress?.required_completed || 0}/${workspace.progress?.required_total || 0} required`;
  if (progressCopy) {
    progressCopy.textContent = isOnboardingComplete(organization)
      ? "Your utility workspace is live."
      : "Complete onboarding while N3XRA finishes platform-controlled setup items.";
  }
  portalLinks.forEach((link) => {
    link.href = workspace.portal_url || `/utilities/portal/${encodeURIComponent(organization.slug || "")}`;
  });
}

function renderSummary() {
  const organization = workspace?.organization || {};
  if (summaryOrganization) summaryOrganization.textContent = organization.name || "-";
  if (summaryStatus) summaryStatus.textContent = titleCase(organization.status);
  if (summaryLaunch) summaryLaunch.textContent = titleCase(organization.launch_status);
  if (summaryUtilityProgress) summaryUtilityProgress.textContent = `${workspace?.progress?.utility_completed || 0}/${workspace?.progress?.utility_total || 0}`;
  if (summaryN3xraProgress) summaryN3xraProgress.textContent = `${workspace?.progress?.n3xra_completed || 0}/${workspace?.progress?.n3xra_total || 0}`;
}

function renderDashboard() {
  if (!dashboardGrid) return;
  dashboardGrid.innerHTML = dashboardCards().map((card) => {
    const content = `
      <small>${escapeHtml(card.status)}</small>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.description)}</p>
    `;
    if (card.href) {
      return `<a class="workspace-dashboard-card ${escapeHtml(card.tone || "")}" href="${escapeHtml(card.href)}">${content}</a>`;
    }
    return `<article class="workspace-dashboard-card ${escapeHtml(card.tone || "is-inactive")}" aria-disabled="true">${content}</article>`;
  }).join("");
}

function renderSteps(steps, container, canEdit) {
  if (!container) return;
  if (!steps.length) {
    container.innerHTML = '<p class="utilities-list-empty">No setup tasks in this group.</p>';
    return;
  }
  container.innerHTML = steps.map((step) => `
    <article class="workspace-step">
      <div>
        <span>${escapeHtml(titleCase(step.status))}</span>
        <strong>${escapeHtml(step.title)}</strong>
        <p>${escapeHtml(step.description || "")}</p>
        <small>${step.required ? "Required" : "Optional"}${step.locked ? " · Locked" : ""}</small>
      </div>
      ${canEdit ? `
        <select data-step-id="${escapeHtml(step.id)}">
          ${["not_started", "in_progress", "completed", "skipped", "blocked"]
            .map((status) => `<option value="${status}" ${step.status === status ? "selected" : ""}>${escapeHtml(titleCase(status))}</option>`)
            .join("")}
        </select>
      ` : ""}
    </article>
  `).join("");
}

function renderOnboarding() {
  renderSummary();
  const utilitySteps = (workspace?.launch_steps || []).filter((step) => step.owner === "utility");
  const n3xraSteps = (workspace?.launch_steps || []).filter((step) => step.owner === "n3xra");
  renderSteps(utilitySteps, utilityStepList, true);
  renderSteps(n3xraSteps, n3xraStepList, false);
}

function renderSettings() {
  renderSummary();
  const organization = workspace?.organization || {};
  const branding = workspace?.branding || {};
  loadLogoPreview(branding.logo_storage_path || "").catch(() => renderLogoPreview("", Boolean(branding.logo_storage_path)));

  setInput(profileForm, "name", organization.name);
  setInput(profileForm, "legal_name", organization.legal_name);
  setInput(profileForm, "website", organization.website);
  setInput(profileForm, "primary_contact_name", organization.primary_contact_name);
  setInput(profileForm, "primary_contact_email", organization.primary_contact_email);
  setInput(profileForm, "primary_contact_phone", organization.primary_contact_phone);
  setInput(profileForm, "support_email", organization.support_email);
  setInput(profileForm, "support_phone", organization.support_phone);
  setInput(profileForm, "finance_contact_email", organization.metadata?.finance_contact_email);

  setInput(brandingForm, "portal_display_name", branding.portal_display_name);
  setInput(brandingForm, "primary_color", branding.primary_color);
  setInput(brandingForm, "secondary_color", branding.secondary_color);
  setInput(brandingForm, "accent_color", branding.accent_color);
  setInput(brandingForm, "email_reply_to", branding.email_reply_to);
}

function renderTeam() {
  renderSummary();
  const team = workspace?.team || {};
  const roles = Array.isArray(team.roles) ? team.roles : [];
  const members = Array.isArray(team.members) ? team.members : [];
  const invites = Array.isArray(team.invites) ? team.invites : [];
  const canManage = Boolean(team.can_manage);

  if (teamCurrentRole) teamCurrentRole.textContent = roleLabel(team.current_role);
  if (teamRoleSelect) {
    teamRoleSelect.innerHTML = roles
      .map((role) => `<option value="${escapeHtml(role.name)}">${escapeHtml(roleLabel(role))}</option>`)
      .join("");
    if (!teamRoleSelect.value && roles.some((role) => role.name === "staff")) teamRoleSelect.value = "staff";
  }
  if (teamRoleList) {
    teamRoleList.innerHTML = roles.length
      ? roles.map((role) => `
          <article class="workspace-role-item">
            <strong>${escapeHtml(roleLabel(role))}</strong>
            <span>${escapeHtml(roleDescription(role))}</span>
          </article>
        `).join("")
      : '<p class="utilities-list-empty">No utility roles have been configured yet.</p>';
  }
  if (teamForm) {
    teamForm.hidden = !canManage;
    teamForm.querySelectorAll("input, select, button").forEach((input) => {
      input.disabled = !canManage;
    });
  }
  if (teamInviteList) {
    if (!canManage) {
      teamInviteList.innerHTML = '<p class="utilities-list-empty">Only utility owners and admins can manage invite links.</p>';
    } else if (!invites.length) {
      teamInviteList.innerHTML = '<p class="utilities-list-empty">No pending invite links.</p>';
    } else {
      teamInviteList.innerHTML = invites.map((invite) => `
        <article class="workspace-team-row">
          <div>
            <strong>${escapeHtml(invite.recipient_name || invite.recipient_email || "Invite link")}</strong>
            <small>${escapeHtml(invite.recipient_email || "Any email")} · ${escapeHtml(roleLabel(invite.role))} · ${escapeHtml(titleCase(invite.status || "active"))}</small>
            <code class="workspace-invite-code">${escapeHtml(invite.code)}</code>
          </div>
          <div class="workspace-team-controls">
            <button type="button" data-copy-invite="${escapeHtml(invite.id)}">Copy Link</button>
            <button type="button" data-revoke-invite="${escapeHtml(invite.id)}">Revoke</button>
          </div>
        </article>
      `).join("");
    }
  }
  if (!teamMemberList) return;
  if (!members.length) {
    teamMemberList.innerHTML = '<p class="utilities-list-empty">No team members are linked yet.</p>';
    return;
  }
  const roleOptions = roles.map((role) => `<option value="${escapeHtml(role.name)}">${escapeHtml(roleLabel(role))}</option>`).join("");
  teamMemberList.innerHTML = members.map((member) => {
    const profile = member.profile || {};
    const isCurrentUser = member.user_id === workspace?.user?.id;
    const controls = canManage
      ? `
        <div class="workspace-team-controls">
          <label>Role
            <select data-team-role="${escapeHtml(member.id)}" ${isCurrentUser ? "disabled" : ""}>
              ${roles.map((role) => `<option value="${escapeHtml(role.name)}" ${member.role?.name === role.name ? "selected" : ""}>${escapeHtml(roleLabel(role))}</option>`).join("") || roleOptions}
            </select>
          </label>
          <label>Status
            <select data-team-status="${escapeHtml(member.id)}" ${isCurrentUser ? "disabled" : ""}>
              ${["active", "suspended", "invited"].map((status) => `<option value="${status}" ${member.status === status ? "selected" : ""}>${escapeHtml(titleCase(status))}</option>`).join("")}
            </select>
          </label>
          <button type="button" data-remove-team-member="${escapeHtml(member.id)}" ${isCurrentUser ? "disabled" : ""}>Remove</button>
        </div>
      `
      : `<span class="workspace-feature-status">${escapeHtml(roleLabel(member.role))}</span>`;
    return `
      <article class="workspace-team-row">
        <div>
          <strong>${escapeHtml(profile.full_name || profile.email || "N3XRA user")}</strong>
          <small>${escapeHtml(profile.email || "Email unavailable")} · ${escapeHtml(roleLabel(member.role))} · ${escapeHtml(titleCase(member.status))}</small>
        </div>
        ${controls}
      </article>
    `;
  }).join("");
}

function renderLogoPreview(src, hasLogo) {
  if (!logoImage || !logoFallback) return;
  if (src) {
    logoImage.src = src;
    logoImage.hidden = false;
    logoFallback.hidden = true;
    if (logoNote) logoNote.textContent = "Current logo uploaded during onboarding.";
    return;
  }
  logoImage.removeAttribute("src");
  logoImage.hidden = true;
  logoFallback.hidden = false;
  logoFallback.textContent = hasLogo ? "Preview unavailable" : "No logo uploaded";
  if (logoNote) {
    logoNote.textContent = hasLogo
      ? "The logo file is saved. Preview access may need a storage policy update."
      : "Upload a logo during onboarding or ask N3XRA to add one.";
  }
}

async function loadLogoPreview(path) {
  if (!path) {
    renderLogoPreview("", false);
    return;
  }
  if (!supabase) {
    renderLogoPreview("", true);
    return;
  }
  const { data, error } = await supabase.storage.from("organization-assets").createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    renderLogoPreview("", true);
    return;
  }
  renderLogoPreview(data.signedUrl, true);
}

function renderModules(modules) {
  if (!moduleGrid) return;
  const list = (Array.isArray(modules) ? modules : [])
    .filter((module) => module.module_key !== "finish_onboarding")
    .sort((a, b) => {
      const rankDiff = moduleAvailabilityRank(a) - moduleAvailabilityRank(b);
      if (rankDiff !== 0) return rankDiff;
      const orderDiff = Number(a.sort_order || 999) - Number(b.sort_order || 999);
      if (orderDiff !== 0) return orderDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  if (!list.length) {
    moduleGrid.innerHTML = '<p class="utilities-list-empty">No workspace features are configured yet.</p>';
    return;
  }

  moduleGrid.innerHTML = list.map((module) => {
    const state = displayModuleState(module);
    const canToggle = isToggleableModule(module) && ["enabled", "disabled"].includes(module.state);
    const enabled = module.state === "enabled";
    const stateClass = state === "enabled" ? "is-available" : "is-unavailable";
    const action = canToggle
      ? `<label class="workspace-feature-toggle">
          <input type="checkbox" data-module-key="${escapeHtml(module.module_key)}" ${enabled ? "checked" : ""}>
          <span>${enabled ? "On" : "Off"}</span>
        </label>`
      : `<span class="workspace-feature-status">${escapeHtml(moduleStateLabel(state))}</span>`;
    return `
      <article class="workspace-feature-row ${stateClass}">
        <div>
          <strong>${escapeHtml(module.name)}</strong>
          <small>${escapeHtml(moduleStateLabel(state))} · ${escapeHtml(titleCase(module.category || "feature"))}</small>
          <p>${escapeHtml(module.description || "")}</p>
        </div>
        ${action}
      </article>
    `;
  }).join("");
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((header, index) => String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`);
  const dataRows = rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || "";
    });
    return item;
  });
  return { headers, rows: dataRows };
}

function csvEscape(value) {
  const raw = String(value ?? "");
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function downloadCsv(fileName, rows) {
  const content = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function mappingSelect(name, label, required = false) {
  const options = ['<option value="">Choose column</option>']
    .concat(meterCsv.headers.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`))
    .join("");
  return `<label>${escapeHtml(label)}${required ? " *" : ""}<select name="${escapeHtml(name)}" ${required ? "required" : ""}>${options}</select></label>`;
}

function currentMapping() {
  const mapping = {};
  meterMappingGrid?.querySelectorAll("select[name]").forEach((select) => {
    if (select.value) mapping[select.name] = select.value;
  });
  return mapping;
}

function setMapping(mapping = {}) {
  meterMappingGrid?.querySelectorAll("select[name]").forEach((select) => {
    select.value = mapping[select.name] || "";
  });
}

function renderMapping() {
  if (!meterMappingGrid) return;
  if (!meterCsv.headers.length) {
    meterMappingGrid.innerHTML = '<p class="utilities-list-empty">Upload a CSV to map columns.</p>';
    return;
  }
  meterMappingGrid.innerHTML = [
    mappingSelect("account_number", "Account number", true),
    mappingSelect("meter_number", "Meter number", true),
    mappingSelect("current_reading", "Current reading", true),
    mappingSelect("customer_name", "Customer name"),
    mappingSelect("service_address", "Service address"),
    mappingSelect("reading_date", "Reading date"),
    mappingSelect("previous_reading", "Previous reading"),
    mappingSelect("usage_gallons", "Usage gallons"),
  ].join("");
}

function renderCsvPreview() {
  if (!meterPreviewTable || !meterPreviewWrap) return;
  if (!meterCsv.headers.length) {
    meterPreviewWrap.hidden = true;
    meterPreviewTable.innerHTML = "";
    return;
  }
  const previewRows = meterCsv.rows.slice(0, 5);
  meterPreviewTable.innerHTML = `
    <thead><tr>${meterCsv.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>
      ${previewRows.map((row) => `<tr>${meterCsv.headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}</tr>`).join("")}
    </tbody>
  `;
  meterPreviewWrap.hidden = false;
}

function renderMeterTemplates() {
  if (!meterBillingTemplate) return;
  const templates = workspace?.meter_billing?.templates || [];
  meterBillingTemplate.innerHTML = '<option value="">Map manually</option>' + templates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`)
    .join("");
}

function renderMeterHistory() {
  if (!meterBillingHistory) return;
  const runs = workspace?.meter_billing?.runs || [];
  if (!runs.length) {
    meterBillingHistory.innerHTML = '<p class="utilities-list-empty">No billing runs yet.</p>';
    return;
  }
  meterBillingHistory.innerHTML = runs.map((run) => `
    <article class="meter-history-row">
      <strong>${escapeHtml(run.billing_period)}</strong>
      <span>${escapeHtml(titleCase(run.status))} · ${formatMoney(run.total_overage_amount)} · ${Number(run.billable_count || 0)} billable</span>
    </article>
  `).join("");
}

function renderMeterReview() {
  const billing = workspace?.meter_billing || {};
  const run = billing.latest_run || null;
  const items = billing.latest_items || [];
  if (meterBillingCurrentPeriod) meterBillingCurrentPeriod.textContent = run?.billing_period || "No run yet";
  if (meterBillingCurrentSummary) {
    meterBillingCurrentSummary.textContent = run
      ? `${Number(run.item_count || 0)} rows, ${Number(run.billable_count || 0)} billable, ${formatMoney(run.total_overage_amount)} total overage.`
      : "Upload a CSV to create the first billing review.";
  }
  if (meterBillingReviewCopy) {
    meterBillingReviewCopy.textContent = run
      ? `${escapeHtml(run.billing_period)} review rows are stored in Supabase. Approve billable rows before exporting.`
      : "Create a billing run to review calculated overages.";
  }
  if (meterBillingExport) {
    meterBillingExport.disabled = !items.some((item) => item.status === "approved");
  }
  if (!meterReviewTable) return;
  if (!items.length) {
    meterReviewTable.innerHTML = '<tbody><tr><td>No billing rows yet.</td></tr></tbody>';
    return;
  }
  meterReviewTable.innerHTML = `
    <thead>
      <tr>
        <th>Status</th>
        <th>Account</th>
        <th>Customer</th>
        <th>Meter</th>
        <th>Usage</th>
        <th>Overage</th>
        <th>Amount</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item) => `
        <tr>
          <td>
            <select data-billing-item="${escapeHtml(item.id)}">
              ${["pending", "approved", "flagged", "skipped"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${escapeHtml(titleCase(status))}</option>`).join("")}
            </select>
          </td>
          <td>${escapeHtml(item.account_number)}</td>
          <td>${escapeHtml(item.customer_name || "-")}</td>
          <td>${escapeHtml(item.meter_number || "-")}</td>
          <td>${formatNumber(item.usage_gallons)}</td>
          <td>${formatNumber(item.overage_gallons)}</td>
          <td>${formatMoney(item.overage_amount)}</td>
          <td>${escapeHtml(item.notes || "")}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderMeterBilling() {
  renderSummary();
  renderMeterTemplates();
  renderMapping();
  renderCsvPreview();
  renderMeterHistory();
  renderMeterReview();
}

function renderWorkspace() {
  renderHero();
  if (!workspace?.organization) return;
  if (page === "home") renderDashboard();
  if (page === "onboarding") renderOnboarding();
  if (page === "settings") renderSettings();
  if (page === "team") renderTeam();
  if (page === "features") renderModules(workspace.modules || []);
  if (page === "meter-billing") renderMeterBilling();
}

async function loadWorkspace() {
  setStatus("");
  const data = await apiFetch();
  workspace = data.workspace || null;
  renderWorkspace();
  setStatus("");
}

function formDataObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    data[input.name] = input.checked;
  });
  data.organization_id = organizationId();
  return data;
}

async function saveAction(action, payload) {
  setStatus("Saving...");
  await apiFetch({
    method: "PATCH",
    body: JSON.stringify({ action, ...payload }),
  });
  await loadWorkspace();
  setStatus("Saved.", "is-active");
}

profileForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-profile", formDataObject(profileForm)).catch((error) => setStatus(error.message, "is-error"));
});

brandingForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAction("update-branding", formDataObject(brandingForm)).catch((error) => setStatus(error.message, "is-error"));
});

teamForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  setStatus("Creating invite link...");
  apiFetch({
    method: "PATCH",
    body: JSON.stringify({ action: "create-team-invite", ...formDataObject(teamForm) }),
  })
    .then(async (data) => {
      const invite = data?.invite || null;
      teamForm.reset();
      await loadWorkspace();
      if (invite?.code) {
        const inviteUrl = buildInviteUrl(invite);
        const emailSent = invite?.email?.status === "sent";
        const emailSkipped = invite?.email?.status === "skipped";
        const emailReason = invite?.email?.reason === "missing_resend_api_key" ? " Resend is not configured." : "";
        const successCopy = emailSent
          ? "Invite email sent and link copied."
          : `Invite link created and copied. Email not sent.${emailReason}`;
        const successNoCopy = emailSent
          ? "Invite email sent."
          : `Invite link created. Email not sent.${emailReason}`;
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(inviteUrl)
            .then(() => setStatus(successCopy, "is-active"))
            .catch(() => setStatus(`Invite link created: ${inviteUrl}`, "is-active"));
        } else {
          setStatus(emailSent || emailSkipped ? successNoCopy : `Invite link created: ${inviteUrl}`, "is-active");
        }
      } else {
        setStatus("Invite link created.", "is-active");
      }
    })
    .catch((error) => setStatus(error.message, "is-error"));
});

utilityStepList?.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-step-id]");
  if (!select) return;
  saveAction("update-step", {
    organization_id: organizationId(),
    step_id: select.getAttribute("data-step-id"),
    status: select.value,
  }).catch((error) => setStatus(error.message, "is-error"));
});

moduleGrid?.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-module-key]");
  if (!input) return;
  saveAction("update-module-state", {
    organization_id: organizationId(),
    module_key: input.getAttribute("data-module-key"),
    enabled: input.checked,
  }).catch((error) => setStatus(error.message, "is-error"));
});

moduleGrid?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-request-module]");
  if (!button) return;
  saveAction("request-module", {
    organization_id: organizationId(),
    module_key: button.getAttribute("data-request-module"),
  }).catch((error) => setStatus(error.message, "is-error"));
});

meterBillingFile?.addEventListener("change", async () => {
  const file = meterBillingFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.headers.length || !parsed.rows.length) throw new Error("CSV must include a header row and at least one data row.");
    meterCsv = { ...parsed, fileName: file.name };
    renderMapping();
    renderCsvPreview();
    setStatus(`${parsed.rows.length} CSV row${parsed.rows.length === 1 ? "" : "s"} loaded. Map the columns and create a billing run.`, "is-active");
  } catch (error) {
    meterCsv = { headers: [], rows: [], fileName: "" };
    renderMapping();
    renderCsvPreview();
    setStatus(error instanceof Error ? error.message : "Unable to read CSV.", "is-error");
  }
});

meterBillingApplyTemplate?.addEventListener("click", () => {
  const template = (workspace?.meter_billing?.templates || []).find((item) => item.id === meterBillingTemplate?.value);
  if (!template) {
    setStatus("Choose a saved template first.", "is-error");
    return;
  }
  setMapping(template.column_mapping || {});
  setStatus("Template mapping applied.", "is-active");
});

meterBillingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!meterCsv.rows.length) {
    setStatus("Upload a CSV before creating a billing run.", "is-error");
    return;
  }
  const data = formDataObject(meterBillingForm);
  const mapping = currentMapping();
  try {
    setStatus("Creating billing run...");
    const result = await apiFetch({
      method: "PATCH",
      body: JSON.stringify({
        action: "create-meter-billing-run",
        organization_id: organizationId(),
        billing_period: data.billing_period,
        included_gallons: data.included_gallons,
        overage_rate: data.overage_rate,
        template_name: data.template_name,
        file_name: meterCsv.fileName,
        headers: meterCsv.headers,
        rows: meterCsv.rows,
        column_mapping: mapping,
      }),
    });
    await loadWorkspace();
    const errors = result?.billing?.errors || [];
    setStatus(errors.length ? `Billing run created with ${errors.length} skipped row${errors.length === 1 ? "" : "s"}.` : "Billing run created.", errors.length ? "is-error" : "is-active");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to create billing run.", "is-error");
  }
});

meterReviewTable?.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-billing-item]");
  if (!select) return;
  saveAction("update-billing-item", {
    organization_id: organizationId(),
    item_id: select.getAttribute("data-billing-item"),
    status: select.value,
  }).catch((error) => setStatus(error.message, "is-error"));
});

meterBillingExport?.addEventListener("click", async () => {
  const run = workspace?.meter_billing?.latest_run;
  if (!run?.id) return;
  try {
    setStatus("Preparing export...");
    const result = await apiFetch({
      method: "PATCH",
      body: JSON.stringify({
        action: "create-billing-export",
        organization_id: organizationId(),
        billing_run_id: run.id,
      }),
    });
    const items = result?.billing_export?.items || [];
    if (!items.length) throw new Error("Approve at least one billing row before exporting.");
    const rows = [
      ["Customer", "Account", "Service Address", "Meter", "Description", "Quantity", "Rate", "Amount"],
      ...items.map((item) => [
        item.customer_name || item.account_number || "",
        item.account_number || "",
        item.service_address || "",
        item.meter_number || "",
        `Water overage ${run.billing_period}`,
        item.overage_gallons || 0,
        item.overage_rate || 0,
        item.overage_amount || 0,
      ]),
    ];
    downloadCsv(`quickbooks-overages-${run.billing_period}.csv`, rows);
    await loadWorkspace();
    setStatus("Approved billing rows exported.", "is-active");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to export billing CSV.", "is-error");
  }
});

teamMemberList?.addEventListener("change", (event) => {
  const roleSelect = event.target.closest("select[data-team-role]");
  const statusSelect = event.target.closest("select[data-team-status]");
  if (roleSelect) {
    saveAction("update-team-member", {
      organization_id: organizationId(),
      member_id: roleSelect.getAttribute("data-team-role"),
      role_name: roleSelect.value,
    }).catch((error) => setStatus(error.message, "is-error"));
    return;
  }
  if (statusSelect) {
    saveAction("update-team-member", {
      organization_id: organizationId(),
      member_id: statusSelect.getAttribute("data-team-status"),
      status: statusSelect.value,
    }).catch((error) => setStatus(error.message, "is-error"));
  }
});

teamMemberList?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove-team-member]");
  if (!button) return;
  if (!window.confirm("Remove this team member's utility workspace access?")) return;
  saveAction("remove-team-member", {
    organization_id: organizationId(),
    member_id: button.getAttribute("data-remove-team-member"),
  }).catch((error) => setStatus(error.message, "is-error"));
});

teamInviteList?.addEventListener("click", (event) => {
  const copyButton = event.target.closest("button[data-copy-invite]");
  const revokeButton = event.target.closest("button[data-revoke-invite]");
  if (copyButton) {
    const invite = (workspace?.team?.invites || []).find((item) => item.id === copyButton.getAttribute("data-copy-invite"));
    if (!invite) return;
    const inviteUrl = buildInviteUrl(invite);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(inviteUrl)
        .then(() => setStatus("Invite link copied.", "is-active"))
        .catch(() => setStatus(inviteUrl, "is-active"));
    } else {
      setStatus(inviteUrl, "is-active");
    }
    return;
  }
  if (revokeButton) {
    if (!window.confirm("Revoke this pending invite link?")) return;
    saveAction("revoke-team-invite", {
      organization_id: organizationId(),
      invite_id: revokeButton.getAttribute("data-revoke-invite"),
    }).catch((error) => setStatus(error.message, "is-error"));
  }
});

logoutButton?.addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  window.location.replace("/utilities/login");
});

async function init() {
  if (!hasConfig()) {
    setStatus("Missing N3XRA auth configuration.", "is-error");
    return;
  }
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(`/utilities/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    return;
  }
  await loadWorkspace();
}

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Unable to load utility workspace.", "is-error");
});
