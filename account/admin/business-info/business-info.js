let businessInvoke = null;
let businessState = { profile: {}, fileLinks: [], files: [] };

const profileFieldMap = {
  legalName: "legal_name",
  doingBusinessAs: "doing_business_as",
  entityType: "entity_type",
  businessStatus: "business_status",
  formationJurisdiction: "formation_jurisdiction",
  formationDate: "formation_date",
  stateRegistrationNumber: "state_registration_number",
  ein: "ein",
  dunsNumber: "duns_number",
  uniqueEntityId: "unique_entity_id",
  cageCode: "cage_code",
  naicsCodes: "naics_codes",
  websiteUrl: "website_url",
  businessEmail: "business_email",
  businessPhone: "business_phone",
  principalAddress: "principal_address",
  mailingAddress: "mailing_address",
  registeredAgent: "registered_agent",
  fiscalYearEnd: "fiscal_year_end",
  notes: "notes",
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function setBusinessStatus(message = "", tone = "") {
  const status = document.getElementById("admin-status");
  if (!status) return;
  status.textContent = message;
  status.className = `admin-status${tone ? ` ${tone}` : ""}`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not saved yet";
  return date.toLocaleString(undefined, includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function fileLeaf(value) {
  return String(value || "File").split(/[\\/]+/).filter(Boolean).at(-1) || "File";
}

function fileType(file) {
  const extension = fileLeaf(file?.name).split(".").pop()?.toUpperCase() || "FILE";
  return extension.slice(0, 4);
}

function linkedFile(link) {
  const relation = Array.isArray(link.file) ? link.file[0] : link.file;
  return relation || businessState.files.find((file) => String(file.id) === String(link.file_id)) || { id: link.file_id, name: "Linked file" };
}

function renderQuickAccess() {
  const profile = businessState.profile || {};
  const items = [
    ["Legal name", "legal_name"],
    ["EIN", "ein"],
    ["D-U-N-S", "duns_number"],
    ["Unique Entity ID", "unique_entity_id"],
  ];
  const grid = document.getElementById("business-quick-grid");
  if (grid) {
    grid.innerHTML = items.map(([label, key]) => {
      const value = profile[key] || "Not added";
      return `<article class="business-quick-card"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div><button class="business-copy-button" type="button" data-business-copy="${escapeHtml(key)}"${profile[key] ? "" : " disabled"}>Copy</button></article>`;
    }).join("");
  }
  const updated = document.getElementById("business-last-updated");
  if (updated) updated.textContent = profile.updated_at ? `Updated ${formatDate(profile.updated_at, true)}` : "Not saved yet";
}

function fillProfileForm() {
  const form = document.getElementById("business-profile-form");
  if (!form) return;
  Object.entries(profileFieldMap).forEach(([fieldName, profileKey]) => {
    const field = form.elements.namedItem(fieldName);
    if (field) field.value = businessState.profile?.[profileKey] || "";
  });
}

function renderFileSelect() {
  const select = document.getElementById("business-file-select");
  if (!select) return;
  const linkedIds = new Set(businessState.fileLinks.map((link) => String(link.file_id)));
  const available = businessState.files
    .filter((file) => !linkedIds.has(String(file.id)))
    .sort((first, second) => {
      const firstBusiness = String(first.name || "").startsWith("Business Records/") ? 0 : 1;
      const secondBusiness = String(second.name || "").startsWith("Business Records/") ? 0 : 1;
      return firstBusiness - secondBusiness || String(first.name || "").localeCompare(String(second.name || ""));
    });
  select.innerHTML = `<option value="">${available.length ? "Choose a file" : "No unlinked files available"}</option>${available.map((file) => `<option value="${escapeHtml(file.id)}">${escapeHtml(file.name)}</option>`).join("")}`;
  select.disabled = !available.length;
  const button = document.getElementById("business-attach-button");
  if (button) button.disabled = !available.length;
}

function renderDocuments() {
  const list = document.getElementById("business-document-list");
  if (!list) return;
  if (!businessState.fileLinks.length) {
    list.innerHTML = '<p class="business-document-empty">No supporting records are linked yet. Upload documents to the Business Records folder, then link them here.</p>';
    renderFileSelect();
    return;
  }
  list.innerHTML = businessState.fileLinks.map((link) => {
    const file = linkedFile(link);
    return `<article class="business-document-card"><div class="business-document-name"><span class="business-document-icon" aria-hidden="true">${escapeHtml(fileType(file))}</span><div class="business-document-meta"><span>${escapeHtml(link.document_type || "Supporting record")}</span><strong title="${escapeHtml(file.name)}">${escapeHtml(fileLeaf(file.name))}</strong><small>${escapeHtml(formatFileSize(file.size_bytes))} · Linked ${escapeHtml(formatDate(link.created_at))}</small></div></div><div class="business-document-actions"><button type="button" data-business-file-open="${escapeHtml(file.id)}">Open</button><button type="button" data-business-file-detach="${escapeHtml(file.id)}">Remove link</button></div></article>`;
  }).join("");
  renderFileSelect();
}

function renderBusinessInformation() {
  renderQuickAccess();
  fillProfileForm();
  renderDocuments();
}

async function loadBusinessInformation() {
  setBusinessStatus("Loading business information…");
  const [business, files] = await Promise.all([
    businessInvoke("get-business-information"),
    businessInvoke("list-n3xra-files"),
  ]);
  businessState = {
    profile: business.profile || {},
    fileLinks: business.fileLinks || [],
    files: files.files || [],
  };
  renderBusinessInformation();
  setBusinessStatus();
}

async function saveBusinessInformation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("business-save-button");
  const payload = Object.fromEntries(new FormData(form).entries());
  if (button) button.disabled = true;
  setBusinessStatus("Saving business information…");
  try {
    const result = await businessInvoke("save-business-information", payload);
    businessState.profile = result.profile || businessState.profile;
    renderQuickAccess();
    fillProfileForm();
    setBusinessStatus("Business information saved.", "success");
  } catch (error) {
    setBusinessStatus(error.message || "Unable to save business information.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function attachBusinessFile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("business-attach-button");
  const payload = Object.fromEntries(new FormData(form).entries());
  if (!payload.fileId) return;
  if (button) button.disabled = true;
  setBusinessStatus("Linking file…");
  try {
    await businessInvoke("attach-business-file", payload);
    form.reset();
    await loadBusinessInformation();
    setBusinessStatus("Supporting file linked.", "success");
  } catch (error) {
    setBusinessStatus(error.message || "Unable to link that file.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleBusinessAction(event) {
  const copy = event.target.closest("[data-business-copy]");
  if (copy) {
    const value = businessState.profile?.[copy.dataset.businessCopy];
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
      setBusinessStatus(`${copy.closest(".business-quick-card")?.querySelector("span")?.textContent || "Value"} copied.`, "success");
    } catch {
      setBusinessStatus("Unable to copy this value automatically.", "error");
    }
    return;
  }
  const open = event.target.closest("[data-business-file-open]");
  if (open) {
    const preview = window.open("about:blank", "_blank");
    try {
      const result = await businessInvoke("get-n3xra-file-url", { fileId: open.dataset.businessFileOpen });
      if (preview) preview.location.href = result.url;
      else window.location.assign(result.url);
    } catch (error) {
      preview?.close();
      setBusinessStatus(error.message || "Unable to open that file.", "error");
    }
    return;
  }
  const detach = event.target.closest("[data-business-file-detach]");
  if (!detach) return;
  detach.disabled = true;
  setBusinessStatus("Removing file link…");
  try {
    await businessInvoke("detach-business-file", { fileId: detach.dataset.businessFileDetach });
    await loadBusinessInformation();
    setBusinessStatus("File link removed. The original file is still in Internal Files.", "success");
  } catch (error) {
    detach.disabled = false;
    setBusinessStatus(error.message || "Unable to remove this file link.", "error");
  }
}

export async function startBusinessInformation({ invoke }) {
  businessInvoke = invoke;
  document.getElementById("business-profile-form")?.addEventListener("submit", saveBusinessInformation);
  document.getElementById("business-attach-form")?.addEventListener("submit", attachBusinessFile);
  document.querySelector(".business-info-workspace")?.addEventListener("click", handleBusinessAction);
  await loadBusinessInformation();
}
