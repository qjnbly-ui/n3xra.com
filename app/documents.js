import { createBrowserSupabase, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
import {
  buildMembershipMap,
  dedupeMembershipsByOrganization,
  formatRoleLabel,
  getCapabilities,
  isPlatformAdminEmail,
  resolveActiveOrganization,
  setStoredActiveOrganizationId,
} from "./lib/orgs.js";

const setupPanel = document.getElementById("setup-panel");
const documentsPanel = document.getElementById("documents-panel");
const noAccessNotice = document.getElementById("documents-no-access-notice");
const activeOrganizationSelect = document.getElementById("active-organization-select");
const activeMembershipRole = document.getElementById("active-membership-role");
const appDocumentCount = document.getElementById("app-document-count");
const documentSearch = document.getElementById("document-search");
const appDocumentList = document.getElementById("app-document-list");
const appDocumentEmpty = document.getElementById("app-document-empty");
const documentsStatus = document.getElementById("documents-status");
const editorEmpty = document.getElementById("document-editor-empty");
const editorForm = document.getElementById("document-editor-form");
const documentTitle = document.getElementById("document-title");
const documentStatus = document.getElementById("document-status");
const documentEditor = document.getElementById("document-editor");
const editorStatus = document.getElementById("document-editor-status");
const newDocumentButton = document.getElementById("new-document-button");
const newMinutesButton = document.getElementById("new-minutes-button");
const newLetterButton = document.getElementById("new-letter-button");
const documentSave = document.getElementById("document-save");
const documentPrint = document.getElementById("document-print");
const documentEmail = document.getElementById("document-email");
const documentDelete = document.getElementById("document-delete");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");

const EMPTY_DOCUMENT = {
  type: "records_document",
  version: 1,
  blocks: [
    { type: "paragraph", text: "" },
  ],
};

const TEMPLATES = {
  blank: EMPTY_DOCUMENT,
  minutes: {
    type: "records_document",
    version: 1,
    blocks: [
      { type: "heading", level: 1, text: "Meeting Minutes" },
      { type: "paragraph", text: "Date:" },
      { type: "paragraph", text: "Attendees:" },
      { type: "heading", level: 2, text: "Agenda" },
      { type: "list", items: ["Call to order", "Reports", "Old business", "New business", "Adjournment"] },
      { type: "heading", level: 2, text: "Decisions" },
      { type: "paragraph", text: "" },
      { type: "heading", level: 2, text: "Action Items" },
      { type: "paragraph", text: "" },
    ],
  },
  letter: {
    type: "records_document",
    version: 1,
    blocks: [
      { type: "paragraph", text: "Date:" },
      { type: "paragraph", text: "Recipient:" },
      { type: "paragraph", text: "Dear," },
      { type: "paragraph", text: "" },
      { type: "paragraph", text: "Sincerely," },
    ],
  },
};

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let appDocuments = [];
let activeDocumentId = "";
let lastSavedHtml = "";

function show(el, visible) {
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message || "";
  el.className = "status";
  if (tone) el.classList.add(tone);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function closeMobileMenu() {
  mobileMenu.classList.remove("is-open");
  mobileMenu.classList.add("hidden");
  mobileMenuToggle.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const nextOpen = !mobileMenu.classList.contains("is-open");
  mobileMenu.classList.toggle("is-open", nextOpen);
  mobileMenu.classList.toggle("hidden", !nextOpen);
  mobileMenuToggle.setAttribute("aria-expanded", String(nextOpen));
}

function getActiveOrganization() {
  return activeMembership?.organization || null;
}

function getActiveCapabilities() {
  return getCapabilities(
    activeMembership,
    currentSession?.user?.id || "",
    isPlatformAdminEmail(currentSession?.user?.email)
  );
}

function normalizeContentJson(value) {
  if (!value || typeof value !== "object") return EMPTY_DOCUMENT;
  if (Array.isArray(value.blocks)) return value;
  if (typeof value.html === "string") {
    return { type: "records_document", version: 1, blocks: htmlToBlocks(value.html) };
  }
  return EMPTY_DOCUMENT;
}

function blockToHtml(block) {
  const type = String(block?.type || "paragraph");
  if (type === "heading") {
    const level = Number(block?.level) === 1 ? 1 : 2;
    return `<h${level}>${escapeHtml(block?.text || "")}</h${level}>`;
  }
  if (type === "list") {
    const items = Array.isArray(block?.items) ? block.items : [];
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }
  if (type === "html") {
    return sanitizeHtml(block?.html || "");
  }
  return `<p>${escapeHtml(block?.text || "") || "<br>"}</p>`;
}

function blocksToHtml(contentJson) {
  const blocks = normalizeContentJson(contentJson).blocks;
  if (!blocks.length) return "<p><br></p>";
  return blocks.map(blockToHtml).join("");
}

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const allowed = new Set(["P", "DIV", "H1", "H2", "H3", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "U", "A", "BR"]);

  template.content.querySelectorAll("*").forEach((node) => {
    if (!allowed.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (node.tagName === "A" && name === "href") {
        const href = attr.value.trim();
        if (/^(https?:|mailto:)/i.test(href)) return;
      }
      node.removeAttribute(attr.name);
    });

    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener");
    }
  });

  return template.innerHTML.trim() || "<p><br></p>";
}

function htmlToBlocks(html) {
  const clean = sanitizeHtml(html);
  const template = document.createElement("template");
  template.innerHTML = clean;
  const blocks = [];

  Array.from(template.content.children).forEach((node) => {
    const tag = node.tagName;
    if (tag === "H1" || tag === "H2" || tag === "H3") {
      blocks.push({ type: "heading", level: tag === "H1" ? 1 : 2, text: node.textContent.trim() });
      return;
    }
    if (tag === "UL" || tag === "OL") {
      const items = Array.from(node.querySelectorAll("li")).map((item) => item.textContent.trim()).filter(Boolean);
      blocks.push({ type: "list", items });
      return;
    }
    const text = node.textContent.trim();
    const inner = node.innerHTML.trim();
    if (inner && inner !== escapeHtml(text)) {
      blocks.push({ type: "html", html: node.outerHTML });
      return;
    }
    blocks.push({ type: "paragraph", text });
  });

  if (!blocks.length) {
    const text = template.content.textContent.trim();
    blocks.push({ type: "paragraph", text });
  }
  return blocks;
}

function documentToEditor(doc) {
  activeDocumentId = doc?.id || "";
  documentTitle.value = doc?.title || "";
  documentStatus.value = doc?.status || "draft";
  const html = sanitizeHtml(blocksToHtml(doc?.content_json || EMPTY_DOCUMENT));
  documentEditor.innerHTML = html;
  lastSavedHtml = html;
  show(editorEmpty, false);
  show(editorForm, true);
  renderAppDocuments();
  setStatus(editorStatus, "");
}

function editorToPayload() {
  const html = sanitizeHtml(documentEditor.innerHTML);
  if (documentEditor.innerHTML !== html) {
    documentEditor.innerHTML = html;
  }
  return {
    title: documentTitle.value.trim() || "Untitled document",
    status: documentStatus.value,
    content_json: {
      type: "records_document",
      version: 1,
      blocks: htmlToBlocks(html),
      html,
    },
    plain_text: documentEditor.innerText.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function isMissingAppDocumentsSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("app_documents") && (message.includes("does not exist") || message.includes("schema cache"));
}

async function bootstrapAccess() {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select(`
      id,
      role,
      organization:organizations (
        id,
        name,
        subscription_tier,
        owner_user_id
      )
    `)
    .eq("user_id", currentSession.user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;
  memberships = dedupeMembershipsByOrganization(buildMembershipMap(data || []));
  activeMembership = resolveActiveOrganization(memberships);
  if (activeMembership?.organization?.id) {
    setStoredActiveOrganizationId(activeMembership.organization.id);
  }
}

function renderOrganizationSelector() {
  const organization = getActiveOrganization();
  show(noAccessNotice, !organization);
  activeOrganizationSelect.disabled = !memberships.length;
  activeOrganizationSelect.innerHTML = "";
  if (!organization) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeMembershipRole.textContent = "No library access";
    appDocumentCount.textContent = "0";
    return;
  }

  memberships.forEach((membership) => {
    const option = document.createElement("option");
    option.value = membership.organization.id;
    option.textContent = membership.organization.name || "Untitled library";
    option.selected = membership.organization.id === organization.id;
    activeOrganizationSelect.append(option);
  });

  const capabilities = getActiveCapabilities();
  activeMembershipRole.textContent = formatRoleLabel(activeMembership.role);
  newDocumentButton.disabled = !capabilities.canEditDocuments;
  newMinutesButton.disabled = !capabilities.canEditDocuments;
  newLetterButton.disabled = !capabilities.canEditDocuments;
  documentSave.disabled = !capabilities.canEditDocuments;
  documentDelete.disabled = !capabilities.canDeleteDocuments;
  documentEditor.contentEditable = capabilities.canEditDocuments ? "true" : "false";
}

function renderAppDocuments() {
  const query = documentSearch.value.trim().toLowerCase();
  const filtered = appDocuments.filter((doc) => {
    const haystack = `${doc.title || ""} ${doc.plain_text || ""}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  appDocumentList.innerHTML = "";
  appDocumentCount.textContent = String(appDocuments.length);
  show(appDocumentEmpty, filtered.length === 0);

  filtered.forEach((doc) => {
    const button = document.createElement("button");
    button.className = "document-list-item";
    button.type = "button";
    button.setAttribute("data-id", doc.id);
    button.classList.toggle("is-active", doc.id === activeDocumentId);
    button.innerHTML = `
      <span class="document-list-title">${escapeHtml(doc.title || "Untitled document")}</span>
      <span class="document-list-meta">${escapeHtml(doc.status || "draft")} · ${escapeHtml(new Date(doc.updated_at || doc.created_at).toLocaleDateString())}</span>
    `;
    appDocumentList.append(button);
  });
}

async function loadAppDocuments(preferredId = "") {
  const organization = getActiveOrganization();
  if (!organization) {
    appDocuments = [];
    renderAppDocuments();
    return;
  }

  setStatus(documentsStatus, "Loading editable documents...");
  const { data, error } = await supabase
    .from("app_documents")
    .select("id, title, content_json, plain_text, status, document_kind, source_document_id, created_at, updated_at")
    .eq("organization_id", organization.id)
    .order("updated_at", { ascending: false });

  if (error) {
    const message = isMissingAppDocumentsSchemaError(error)
      ? "Run the app_documents migration before using the editor."
      : error.message;
    setStatus(documentsStatus, message, "error");
    return;
  }

  appDocuments = Array.isArray(data) ? data : [];
  renderAppDocuments();
  const target = appDocuments.find((doc) => doc.id === preferredId) || appDocuments.find((doc) => doc.id === activeDocumentId);
  if (target) {
    documentToEditor(target);
  } else if (!appDocuments.length) {
    activeDocumentId = "";
    show(editorEmpty, true);
    show(editorForm, false);
  }
  setStatus(documentsStatus, `${appDocuments.length} editable document${appDocuments.length === 1 ? "" : "s"} loaded.`, "success");
}

async function createAppDocument(kind = "blank") {
  const organization = getActiveOrganization();
  if (!organization || !getActiveCapabilities().canEditDocuments) return;
  const template = TEMPLATES[kind] || TEMPLATES.blank;
  const title = kind === "minutes" ? "Meeting Minutes" : kind === "letter" ? "Letter" : "Untitled document";
  const html = blocksToHtml(template);
  const { data, error } = await supabase
    .from("app_documents")
    .insert({
      organization_id: organization.id,
      created_by_user_id: currentSession.user.id,
      title,
      content_json: { ...template, html },
      plain_text: new DOMParser().parseFromString(html, "text/html").body.textContent.trim(),
      status: "draft",
    })
    .select("id, title, content_json, plain_text, status, document_kind, source_document_id, created_at, updated_at")
    .single();

  if (error) {
    setStatus(documentsStatus, isMissingAppDocumentsSchemaError(error) ? "Run the app_documents migration before creating documents." : error.message, "error");
    return;
  }

  await loadAppDocuments(data.id);
}

async function saveActiveDocument(event) {
  event.preventDefault();
  if (!activeDocumentId || !getActiveCapabilities().canEditDocuments) return;
  setStatus(editorStatus, "Saving...");
  documentSave.disabled = true;
  const payload = editorToPayload();
  const { data, error } = await supabase
    .from("app_documents")
    .update(payload)
    .eq("id", activeDocumentId)
    .select("id, title, content_json, plain_text, status, document_kind, source_document_id, created_at, updated_at")
    .single();

  documentSave.disabled = false;
  if (error) {
    setStatus(editorStatus, error.message, "error");
    return;
  }

  const index = appDocuments.findIndex((doc) => doc.id === data.id);
  if (index >= 0) appDocuments[index] = data;
  lastSavedHtml = payload.content_json.html;
  renderAppDocuments();
  setStatus(editorStatus, "Saved.", "success");
}

async function deleteActiveDocument() {
  if (!activeDocumentId || !getActiveCapabilities().canDeleteDocuments) return;
  const ok = window.confirm("Delete this editable document? The uploaded source file is not deleted.");
  if (!ok) return;
  const { error } = await supabase.from("app_documents").delete().eq("id", activeDocumentId);
  if (error) {
    setStatus(editorStatus, error.message, "error");
    return;
  }
  activeDocumentId = "";
  show(editorEmpty, true);
  show(editorForm, false);
  await loadAppDocuments();
}

function printActiveDocument() {
  if (!activeDocumentId) return;
  window.print();
}

async function emailActiveDocument() {
  if (!activeDocumentId) return;
  const payload = editorToPayload();
  const subject = encodeURIComponent(payload.title);
  const body = encodeURIComponent(payload.plain_text || payload.title);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
  await supabase.from("app_documents").update({ last_sent_at: new Date().toISOString() }).eq("id", activeDocumentId);
}

async function handleOrganizationChange() {
  const nextOrganizationId = activeOrganizationSelect.value;
  const nextMembership = memberships.find((membership) => membership.organization?.id === nextOrganizationId);
  if (!nextMembership) return;
  activeMembership = nextMembership;
  activeDocumentId = "";
  setStoredActiveOrganizationId(nextOrganizationId);
  renderOrganizationSelector();
  await loadAppDocuments();
}

async function handleSignout() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    setStatus(documentsStatus, error.message, "error");
    return;
  }
  setStoredActiveOrganizationId("");
  window.location.replace("./login.html");
}

function applyToolbarAction(event) {
  const button = event.target.closest("button");
  if (!button || !documentEditor.isContentEditable) return;
  const command = button.getAttribute("data-command");
  const block = button.getAttribute("data-block");
  documentEditor.focus();
  if (command) document.execCommand(command, false, null);
  if (block) document.execCommand("formatBlock", false, block);
}

async function init() {
  show(setupPanel, !hasConfig());
  show(documentsPanel, false);
  if (!hasConfig()) return;

  supabase = createBrowserSupabase();
  currentSession = await getSessionOrNull(supabase);
  if (!currentSession?.user) {
    window.location.replace("./login.html");
    return;
  }
  if (isPlatformAdminEmail(currentSession.user.email)) {
    window.location.replace("./admin.html");
    return;
  }

  show(setupPanel, false);
  show(documentsPanel, true);

  mobileLogoutButton.addEventListener("click", handleSignout);
  mobileMenuToggle.addEventListener("click", toggleMobileMenu);
  mobileMenuAccount.addEventListener("click", () => {
    window.location.href = "./dashboard.html?section=account";
  });
  mobileMenuLibrary.addEventListener("click", () => {
    window.location.href = "./dashboard.html?section=library";
  });
  activeOrganizationSelect.addEventListener("change", handleOrganizationChange);
  documentSearch.addEventListener("input", renderAppDocuments);
  newDocumentButton.addEventListener("click", () => createAppDocument("blank"));
  newMinutesButton.addEventListener("click", () => createAppDocument("minutes"));
  newLetterButton.addEventListener("click", () => createAppDocument("letter"));
  editorForm.addEventListener("submit", saveActiveDocument);
  documentDelete.addEventListener("click", deleteActiveDocument);
  documentPrint.addEventListener("click", printActiveDocument);
  documentEmail.addEventListener("click", emailActiveDocument);
  document.querySelector(".document-toolbar")?.addEventListener("click", applyToolbarAction);
  appDocumentList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-id]") : null;
    const id = target?.getAttribute("data-id");
    const doc = appDocuments.find((item) => item.id === id);
    if (doc) documentToEditor(doc);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && activeDocumentId) {
      event.preventDefault();
      editorForm.requestSubmit();
      return;
    }
    if (event.key === "Escape") closeMobileMenu();
  });
  document.addEventListener("click", (event) => {
    if (!mobileMenu.classList.contains("is-open")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (mobileMenu.contains(target) || mobileMenuToggle.contains(target)) return;
    closeMobileMenu();
  });

  try {
    await bootstrapAccess();
    renderOrganizationSelector();
    const preferredId = new URLSearchParams(window.location.search).get("id") || "";
    await loadAppDocuments(preferredId);
  } catch (error) {
    setStatus(documentsStatus, error?.message || "Unable to load documents.", "error");
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      window.location.replace("./login.html");
    }
  });
}

window.addEventListener("beforeunload", (event) => {
  if (!activeDocumentId) return;
  const currentHtml = sanitizeHtml(documentEditor.innerHTML);
  if (currentHtml === lastSavedHtml) return;
  event.preventDefault();
  event.returnValue = "";
});

init();
