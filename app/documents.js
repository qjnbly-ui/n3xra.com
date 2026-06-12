import { Editor } from "https://esm.sh/@tiptap/core";
import StarterKit from "https://esm.sh/@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "https://esm.sh/@tiptap/extension-table";
import { Color, TextStyle } from "https://esm.sh/@tiptap/extension-text-style";
import Superscript from "https://esm.sh/@tiptap/extension-superscript";
import TextAlign from "https://esm.sh/@tiptap/extension-text-align";
import Underline from "https://esm.sh/@tiptap/extension-underline";
import { createBrowserSupabase, getConfig, hasConfig, getSessionOrNull } from "./lib/supabase-client.js";
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
const documentTemplateCreate = document.getElementById("document-template-create");
const documentTemplateSelect = document.getElementById("document-template-select");
const createFromTemplateButton = document.getElementById("create-from-template-button");
const newTemplateButton = document.getElementById("new-template-button");
const templateManagementSection = document.getElementById("template-management-section");
const appTemplateList = document.getElementById("app-template-list");
const appTemplateEmpty = document.getElementById("app-template-empty");
const documentSave = document.getElementById("document-save");
const documentPrint = document.getElementById("document-print");
const documentEmail = document.getElementById("document-email");
const documentDelete = document.getElementById("document-delete");
const documentPdfModal = document.getElementById("document-pdf-modal");
const documentPdfTitle = document.getElementById("document-pdf-title");
const documentPdfDownload = document.getElementById("document-pdf-download");
const documentPdfPrint = document.getElementById("document-pdf-print");
const documentPdfClose = document.getElementById("document-pdf-close");
const documentPdfFrame = document.getElementById("document-pdf-frame");
const documentConfirmModal = document.getElementById("document-confirm-modal");
const documentConfirmKicker = document.getElementById("document-confirm-kicker");
const documentConfirmTitle = document.getElementById("document-confirm-title");
const documentConfirmCopy = document.getElementById("document-confirm-copy");
const documentConfirmCancel = document.getElementById("document-confirm-cancel");
const documentConfirmOk = document.getElementById("document-confirm-ok");
const mobileLogoutButton = document.getElementById("mobile-logout-button");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
const mobileMenuAccount = document.getElementById("mobile-menu-account");
const mobileMenuLibrary = document.getElementById("mobile-menu-library");
const mobileMenuRecordingsLink = document.getElementById("mobile-menu-recordings-link");

const EMPTY_DOCUMENT = {
  type: "doc",
  content: [
    { type: "paragraph" },
  ],
};

const TEMPLATES = {
  blank: EMPTY_DOCUMENT,
  minutes: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Meeting Minutes" }] },
      { type: "paragraph", content: [{ type: "text", text: "Date:" }] },
      { type: "paragraph", content: [{ type: "text", text: "Attendees:" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agenda" }] },
      {
        type: "bulletList",
        content: ["Call to order", "Reports", "Old business", "New business", "Adjournment"].map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Decisions" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Action Items" }] },
      { type: "paragraph" },
    ],
  },
  letter: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Date:" }] },
      { type: "paragraph", content: [{ type: "text", text: "Recipient:" }] },
      { type: "paragraph", content: [{ type: "text", text: "Dear," }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "Sincerely," }] },
    ],
  },
};

let supabase = null;
let currentSession = null;
let memberships = [];
let activeMembership = null;
let appDocuments = [];
let appTemplates = [];
let activeDocumentId = "";
let activeDocumentKind = "document";
let tiptapEditor = null;
let pendingDocumentConfirmResolve = null;
let activePdfUrl = "";

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

function resolveDocumentConfirm(value) {
  if (!pendingDocumentConfirmResolve) return;
  const resolve = pendingDocumentConfirmResolve;
  pendingDocumentConfirmResolve = null;
  documentConfirmModal.classList.remove("is-open");
  documentConfirmModal.setAttribute("aria-hidden", "true");
  resolve(value);
}

function requestDocumentConfirm(options = {}) {
  if (pendingDocumentConfirmResolve) resolveDocumentConfirm(false);
  documentConfirmKicker.textContent = options.kicker || "Confirm action";
  documentConfirmTitle.textContent = options.title || "Are you sure?";
  documentConfirmCopy.textContent = options.copy || "Please confirm to continue.";
  documentConfirmOk.textContent = options.confirmLabel || "Confirm";
  documentConfirmCancel.textContent = options.cancelLabel || "Cancel";
  documentConfirmModal.classList.add("is-open");
  documentConfirmModal.setAttribute("aria-hidden", "false");
  documentConfirmCancel.focus();
  return new Promise((resolve) => {
    pendingDocumentConfirmResolve = resolve;
  });
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
  const blocks = Array.isArray(contentJson?.blocks) ? contentJson.blocks : [];
  if (!blocks.length) return "<p><br></p>";
  return blocks.map(blockToHtml).join("");
}

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const allowed = new Set([
    "P", "DIV", "H1", "H2", "H3", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "U", "A", "BR",
    "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TH", "TD", "SUP", "SPAN",
  ]);

  template.content.querySelectorAll("*").forEach((node) => {
    if (!allowed.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      return;
    }

    const style = node.getAttribute("style") || "";
    const cleanStyles = [];
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    const alignMatch = style.match(/(?:^|;)\s*text-align\s*:\s*([^;]+)/i);
    if (node.tagName === "SPAN" && colorMatch) {
      const color = colorMatch[1].trim();
      if (/^(#[0-9a-f]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|[a-z]+)$/i.test(color)) cleanStyles.push(`color: ${color}`);
    }
    if (["P", "DIV", "H1", "H2", "H3", "TH", "TD"].includes(node.tagName) && alignMatch) {
      const align = alignMatch[1].trim().toLowerCase();
      if (["left", "center", "right", "justify"].includes(align)) cleanStyles.push(`text-align: ${align}`);
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (node.tagName === "A" && name === "href") {
        const href = attr.value.trim();
        if (/^(https?:|mailto:)/i.test(href)) return;
      }
      if (["TD", "TH"].includes(node.tagName) && ["colspan", "rowspan"].includes(name) && /^\d+$/.test(attr.value)) return;
      node.removeAttribute(attr.name);
    });

    if (cleanStyles.length) node.setAttribute("style", cleanStyles.join("; "));

    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener");
    }
  });

  return template.innerHTML.trim() || "<p><br></p>";
}

function contentJsonToTiptapContent(value) {
  if (value?.type === "doc" && Array.isArray(value.content)) return value;
  if (typeof value?.html === "string") return sanitizeHtml(value.html);
  if (Array.isArray(value?.blocks)) return sanitizeHtml(blocksToHtml(value));
  return EMPTY_DOCUMENT;
}

function cloneContentJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value));
  }
  return JSON.parse(JSON.stringify(EMPTY_DOCUMENT));
}

function textFromTiptapJson(node, parts = []) {
  if (!node || typeof node !== "object") return parts;
  if (node.type === "text" && node.text) {
    parts.push(node.text);
  }
  if (node.type === "hardBreak") {
    parts.push("\n");
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => textFromTiptapJson(child, parts));
  }
  if (["paragraph", "heading", "listItem", "tableRow"].includes(node.type)) {
    parts.push("\n");
  }
  if (["tableCell", "tableHeader"].includes(node.type)) parts.push("\t");
  return parts;
}

function plainTextFromTiptapJson(contentJson) {
  return textFromTiptapJson(contentJson, [])
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function downloadFilename(value, extension = "pdf") {
  const base = String(value || "document")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9 _.-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "document";
  return `${base}.${extension}`;
}

function updateToolbarStates() {
  const buttons = document.querySelectorAll("[data-tiptap-button]");
  buttons.forEach((button) => {
    const command = button.getAttribute("data-tiptap-button");
    const editable = Boolean(tiptapEditor?.isEditable);
    const disabledForHistory =
      (command === "undo" && !tiptapEditor?.can().undo()) ||
      (command === "redo" && !tiptapEditor?.can().redo());
    button.disabled = !editable || disabledForHistory;
    const isActive =
      command === "bold" ? tiptapEditor?.isActive("bold") :
      command === "italic" ? tiptapEditor?.isActive("italic") :
      command === "underline" ? tiptapEditor?.isActive("underline") :
      command === "h1" ? tiptapEditor?.isActive("heading", { level: 1 }) :
      command === "h2" ? tiptapEditor?.isActive("heading", { level: 2 }) :
      command === "paragraph" ? tiptapEditor?.isActive("paragraph") :
      command === "bulletList" ? tiptapEditor?.isActive("bulletList") :
      command === "orderedList" ? tiptapEditor?.isActive("orderedList") :
      command === "blockquote" ? tiptapEditor?.isActive("blockquote") :
      command === "alignLeft" ? tiptapEditor?.isActive({ textAlign: "left" }) :
      command === "alignCenter" ? tiptapEditor?.isActive({ textAlign: "center" }) :
      command === "alignRight" ? tiptapEditor?.isActive({ textAlign: "right" }) :
      command === "alignJustify" ? tiptapEditor?.isActive({ textAlign: "justify" }) :
      false;
    button.classList.toggle("is-active", Boolean(isActive));
  });
}

function initTiptapEditor() {
  if (tiptapEditor) return;
  tiptapEditor = new Editor({
    element: documentEditor,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Superscript,
      Underline,
    ],
    content: EMPTY_DOCUMENT,
    editable: false,
    onCreate: updateToolbarStates,
    onSelectionUpdate: updateToolbarStates,
    onUpdate: updateToolbarStates,
  });
}

function documentToEditor(doc) {
  activeDocumentId = doc?.id || "";
  activeDocumentKind = doc?.document_kind === "template" ? "template" : "document";
  documentTitle.value = doc?.title || "";
  documentStatus.value = doc?.status || "draft";
  const isTemplate = activeDocumentKind === "template";
  documentSave.textContent = isTemplate ? "Save template" : "Save";
  documentDelete.textContent = isTemplate ? "Delete template" : "Delete";
  initTiptapEditor();
  tiptapEditor.commands.setContent(contentJsonToTiptapContent(doc?.content_json || EMPTY_DOCUMENT));
  show(editorEmpty, false);
  show(editorForm, true);
  renderAppDocuments();
  renderAppTemplates();
  setStatus(editorStatus, "");
}

function editorToPayload() {
  const contentJson = tiptapEditor?.getJSON() || EMPTY_DOCUMENT;
  return {
    title: documentTitle.value.trim() || "Untitled document",
    status: documentStatus.value,
    content_json: contentJson,
    plain_text: plainTextFromTiptapJson(contentJson),
  };
}

async function persistActiveDocument(statusTarget = editorStatus) {
  const capabilities = getActiveCapabilities();
  const canSave = activeDocumentKind === "template" ? capabilities.canManageTemplates : capabilities.canEditDocuments;
  if (!activeDocumentId || !canSave) return null;

  setStatus(statusTarget, "Saving...");
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
    setStatus(statusTarget, error.message, "error");
    return null;
  }

  const list = data.document_kind === "template" ? appTemplates : appDocuments;
  const index = list.findIndex((doc) => doc.id === data.id);
  if (index >= 0) list[index] = data;
  renderAppDocuments();
  renderAppTemplates();
  return data;
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
  const capabilities = getActiveCapabilities();
  show(noAccessNotice, !organization);
  activeOrganizationSelect.disabled = !memberships.length;
  activeOrganizationSelect.innerHTML = "";
  if (!organization) {
    activeOrganizationSelect.innerHTML = '<option value="">No active library</option>';
    activeMembershipRole.textContent = "No library access";
    appDocumentCount.textContent = "0";
    show(templateManagementSection, false);
    return;
  }

  memberships.forEach((membership) => {
    const option = document.createElement("option");
    option.value = membership.organization.id;
    option.textContent = membership.organization.name || "Untitled library";
    option.selected = membership.organization.id === organization.id;
    activeOrganizationSelect.append(option);
  });

  activeMembershipRole.textContent = formatRoleLabel(activeMembership.role);
  newDocumentButton.disabled = !capabilities.canEditDocuments;
  newMinutesButton.disabled = !capabilities.canEditDocuments;
  newLetterButton.disabled = !capabilities.canEditDocuments;
  newTemplateButton.disabled = !capabilities.canManageTemplates;
  createFromTemplateButton.disabled = !capabilities.canEditDocuments || !appTemplates.length;
  documentTemplateSelect.disabled = !capabilities.canEditDocuments || !appTemplates.length;
  show(newTemplateButton, capabilities.canManageTemplates);
  show(templateManagementSection, capabilities.canManageTemplates);
  show(documentTemplateCreate, capabilities.canManageTemplates || (capabilities.canEditDocuments && appTemplates.length > 0));
  documentDelete.disabled = activeDocumentKind === "template" ? !capabilities.canManageTemplates : !capabilities.canDeleteDocuments;
  const canEditActive = activeDocumentKind === "template" ? capabilities.canManageTemplates : capabilities.canEditDocuments;
  documentSave.disabled = !canEditActive;
  tiptapEditor?.setEditable(canEditActive);
  documentEditor.classList.toggle("is-readonly", !canEditActive);
  updateToolbarStates();
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

function renderAppTemplates() {
  const capabilities = getActiveCapabilities();
  appTemplateList.innerHTML = "";
  documentTemplateSelect.innerHTML = "";
  show(appTemplateEmpty, appTemplates.length === 0);
  show(templateManagementSection, capabilities.canManageTemplates);
  show(documentTemplateCreate, capabilities.canManageTemplates || (capabilities.canEditDocuments && appTemplates.length > 0));

  if (!appTemplates.length) {
    documentTemplateSelect.innerHTML = '<option value="">No templates</option>';
    createFromTemplateButton.disabled = true;
    return;
  }

  appTemplates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.title || "Untitled template";
    documentTemplateSelect.append(option);

    if (!capabilities.canManageTemplates) return;
    const item = document.createElement("div");
    item.className = "document-list-item document-template-item";
    item.classList.toggle("is-active", template.id === activeDocumentId);
    item.innerHTML = `
      <button class="document-template-edit" type="button" data-template-id="${escapeHtml(template.id)}">
        <span class="document-list-title">${escapeHtml(template.title || "Untitled template")}</span>
        <span class="document-list-meta">${escapeHtml(template.status || "draft")} · ${escapeHtml(new Date(template.updated_at || template.created_at).toLocaleDateString())}</span>
      </button>
      <div class="document-template-actions">
        <button class="document-template-action" type="button" data-template-id="${escapeHtml(template.id)}">Edit</button>
        <button class="document-template-action danger" type="button" data-template-delete-id="${escapeHtml(template.id)}">Delete</button>
      </div>
    `;
    appTemplateList.append(item);
  });

  createFromTemplateButton.disabled = !capabilities.canEditDocuments;
  documentTemplateSelect.disabled = !capabilities.canEditDocuments;
}

async function loadAppDocuments(preferredId = "") {
  const organization = getActiveOrganization();
  if (!organization) {
    appDocuments = [];
    appTemplates = [];
    renderAppDocuments();
    renderAppTemplates();
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

  const rows = Array.isArray(data) ? data : [];
  appDocuments = rows.filter((doc) => doc.document_kind !== "template");
  appTemplates = rows.filter((doc) => doc.document_kind === "template");
  renderAppDocuments();
  renderAppTemplates();
  const allRows = [...appDocuments, ...appTemplates];
  const target = allRows.find((doc) => doc.id === preferredId) || allRows.find((doc) => doc.id === activeDocumentId);
  if (target) {
    documentToEditor(target);
  } else if (!allRows.length) {
    activeDocumentId = "";
    activeDocumentKind = "document";
    show(editorEmpty, true);
    show(editorForm, false);
  }
  renderOrganizationSelector();
  setStatus(documentsStatus, `${appDocuments.length} editable document${appDocuments.length === 1 ? "" : "s"} and ${appTemplates.length} template${appTemplates.length === 1 ? "" : "s"} loaded.`, "success");
}

async function createAppDocument(kind = "blank") {
  const organization = getActiveOrganization();
  if (!organization || !getActiveCapabilities().canEditDocuments) return;
  const template = cloneContentJson(TEMPLATES[kind] || TEMPLATES.blank);
  const title = kind === "minutes" ? "Meeting Minutes" : kind === "letter" ? "Letter" : "Untitled document";
  const { data, error } = await supabase
    .from("app_documents")
    .insert({
      organization_id: organization.id,
      created_by_user_id: currentSession.user.id,
      title,
      content_json: template,
      plain_text: plainTextFromTiptapJson(template),
      document_kind: "document",
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

async function createTemplate() {
  const organization = getActiveOrganization();
  if (!organization || !getActiveCapabilities().canManageTemplates) return;
  const template = cloneContentJson(EMPTY_DOCUMENT);
  const { data, error } = await supabase
    .from("app_documents")
    .insert({
      organization_id: organization.id,
      created_by_user_id: currentSession.user.id,
      title: "Untitled template",
      content_json: template,
      plain_text: "",
      document_kind: "template",
      status: "draft",
    })
    .select("id, title, content_json, plain_text, status, document_kind, source_document_id, created_at, updated_at")
    .single();

  if (error) {
    setStatus(documentsStatus, isMissingAppDocumentsSchemaError(error) ? "Run the template management migration before creating templates." : error.message, "error");
    return;
  }

  await loadAppDocuments(data.id);
}

async function createDocumentFromTemplate() {
  const organization = getActiveOrganization();
  if (!organization || !getActiveCapabilities().canEditDocuments) return;
  const template = appTemplates.find((item) => item.id === documentTemplateSelect.value);
  if (!template) {
    setStatus(documentsStatus, "Choose a template first.", "error");
    return;
  }

  const contentJson = cloneContentJson(template.content_json || EMPTY_DOCUMENT);
  const { data, error } = await supabase
    .from("app_documents")
    .insert({
      organization_id: organization.id,
      created_by_user_id: currentSession.user.id,
      title: template.title || "Untitled document",
      content_json: contentJson,
      plain_text: template.plain_text || plainTextFromTiptapJson(contentJson),
      document_kind: "document",
      status: "draft",
    })
    .select("id, title, content_json, plain_text, status, document_kind, source_document_id, created_at, updated_at")
    .single();

  if (error) {
    setStatus(documentsStatus, error.message, "error");
    return;
  }

  await loadAppDocuments(data.id);
}

async function deleteTemplate(template) {
  if (!template || !getActiveCapabilities().canManageTemplates) return;
  const ok = await requestDocumentConfirm({
    kicker: "Delete template",
    title: "Remove this reusable template?",
    copy: "Existing documents created from this template will stay. Users will no longer be able to create new documents from it.",
    confirmLabel: "Delete",
  });
  if (!ok) return;

  const { error } = await supabase
    .from("app_documents")
    .delete()
    .eq("id", template.id)
    .eq("document_kind", "template");

  if (error) {
    setStatus(documentsStatus, error.message, "error");
    return;
  }

  if (activeDocumentId === template.id) {
    activeDocumentId = "";
    activeDocumentKind = "document";
    documentSave.textContent = "Save";
    documentDelete.textContent = "Delete";
    show(editorEmpty, true);
    show(editorForm, false);
  }
  await loadAppDocuments();
}

async function saveActiveDocument(event) {
  event.preventDefault();
  const data = await persistActiveDocument(editorStatus);
  if (data) setStatus(editorStatus, "Saved.", "success");
}

async function deleteActiveDocument() {
  const capabilities = getActiveCapabilities();
  const canDelete = activeDocumentKind === "template" ? capabilities.canManageTemplates : capabilities.canDeleteDocuments;
  if (!activeDocumentId || !canDelete) return;
  const ok = await requestDocumentConfirm({
    kicker: activeDocumentKind === "template" ? "Delete template" : "Delete document",
    title: activeDocumentKind === "template" ? "Remove this reusable template?" : "Remove this editable document?",
    copy: activeDocumentKind === "template" ? "Users will no longer be able to create documents from this template." : "The uploaded source file is not deleted. This only removes the app-native editable draft.",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const { error } = await supabase.from("app_documents").delete().eq("id", activeDocumentId);
  if (error) {
    setStatus(editorStatus, error.message, "error");
    return;
  }
  activeDocumentId = "";
  activeDocumentKind = "document";
  show(editorEmpty, true);
  show(editorForm, false);
  await loadAppDocuments();
}

function closeDocumentPdfModal() {
  if (!documentPdfModal) return;
  documentPdfModal.classList.remove("is-open");
  documentPdfModal.setAttribute("aria-hidden", "true");
  if (documentPdfFrame) documentPdfFrame.removeAttribute("src");
  if (documentPdfDownload) documentPdfDownload.removeAttribute("href");
  if (activePdfUrl) {
    URL.revokeObjectURL(activePdfUrl);
    activePdfUrl = "";
  }
}

function printDocumentPdf() {
  if (!activePdfUrl) return;
  try {
    const frameWindow = documentPdfFrame?.contentWindow;
    if (!frameWindow) throw new Error("PDF frame is not ready.");
    frameWindow.focus();
    frameWindow.print();
  } catch (_error) {
    window.open(activePdfUrl, "_blank", "noopener");
  }
}

async function openActiveDocumentPdf() {
  if (!activeDocumentId) return;
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    setStatus(editorStatus, "Supabase config is missing.", "error");
    return;
  }

  const currentDoc = [...appDocuments, ...appTemplates].find((doc) => doc.id === activeDocumentId);
  const saved = await persistActiveDocument(editorStatus);
  if (!saved && tiptapEditor?.isEditable) return;

  setStatus(editorStatus, "Generating PDF...");
  documentPrint.disabled = true;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token || currentSession?.access_token || "";
  if (sessionError || !accessToken) {
    documentPrint.disabled = false;
    setStatus(editorStatus, sessionError?.message || "Sign in again before generating a PDF.", "error");
    return;
  }

  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/generate-app-document-pdf`, {
      method: "POST",
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ documentId: activeDocumentId }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload?.error || "PDF generation failed.");
    }

    const blob = await response.blob();
    closeDocumentPdfModal();
    activePdfUrl = URL.createObjectURL(blob);
    const filename = downloadFilename((saved || currentDoc)?.title || documentTitle.value);
    const title = (saved || currentDoc)?.title || documentTitle.value || "PDF preview";
    if (documentPdfTitle) documentPdfTitle.textContent = `${title} PDF`;
    if (documentPdfDownload) {
      documentPdfDownload.href = activePdfUrl;
      documentPdfDownload.download = filename;
    }
    if (documentPdfFrame) documentPdfFrame.src = activePdfUrl;
    if (documentPdfModal) {
      documentPdfModal.classList.add("is-open");
      documentPdfModal.setAttribute("aria-hidden", "false");
    }
    setStatus(editorStatus, "PDF ready.", "success");
  } catch (error) {
    setStatus(editorStatus, error?.message || "Unable to generate PDF.", "error");
  } finally {
    documentPrint.disabled = false;
  }
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
  activeDocumentKind = "document";
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
  if (!button || !tiptapEditor?.isEditable) return;
  const command = button.getAttribute("data-tiptap-button");
  const chain = tiptapEditor.chain().focus();

  if (command === "bold") chain.toggleBold().run();
  if (command === "italic") chain.toggleItalic().run();
  if (command === "underline") chain.toggleUnderline().run();
  if (command === "h1") chain.toggleHeading({ level: 1 }).run();
  if (command === "h2") chain.toggleHeading({ level: 2 }).run();
  if (command === "paragraph") chain.setParagraph().run();
  if (command === "bulletList") chain.toggleBulletList().run();
  if (command === "orderedList") chain.toggleOrderedList().run();
  if (command === "blockquote") chain.toggleBlockquote().run();
  if (command === "alignLeft") chain.setTextAlign("left").run();
  if (command === "alignCenter") chain.setTextAlign("center").run();
  if (command === "alignRight") chain.setTextAlign("right").run();
  if (command === "alignJustify") chain.setTextAlign("justify").run();
  if (command === "undo") tiptapEditor.chain().focus().undo().run();
  if (command === "redo") tiptapEditor.chain().focus().redo().run();
  updateToolbarStates();
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
  initTiptapEditor();

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
  newTemplateButton.addEventListener("click", createTemplate);
  createFromTemplateButton.addEventListener("click", createDocumentFromTemplate);
  editorForm.addEventListener("submit", saveActiveDocument);
  documentDelete.addEventListener("click", deleteActiveDocument);
  documentConfirmCancel.addEventListener("click", () => resolveDocumentConfirm(false));
  documentConfirmOk.addEventListener("click", () => resolveDocumentConfirm(true));
  documentConfirmModal.addEventListener("click", (event) => {
    if (event.target === documentConfirmModal) resolveDocumentConfirm(false);
  });
  documentPrint.addEventListener("click", openActiveDocumentPdf);
  documentPdfClose.addEventListener("click", closeDocumentPdfModal);
  documentPdfPrint.addEventListener("click", printDocumentPdf);
  documentPdfModal.addEventListener("click", (event) => {
    if (event.target === documentPdfModal) closeDocumentPdfModal();
  });
  documentEmail.addEventListener("click", emailActiveDocument);
  document.querySelector(".document-toolbar")?.addEventListener("click", applyToolbarAction);
  appDocumentList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-id]") : null;
    const id = target?.getAttribute("data-id");
    const doc = appDocuments.find((item) => item.id === id);
    if (doc) documentToEditor(doc);
  });
  appTemplateList.addEventListener("click", (event) => {
    const deleteTarget = event.target instanceof Element ? event.target.closest("[data-template-delete-id]") : null;
    if (deleteTarget) {
      const id = deleteTarget.getAttribute("data-template-delete-id");
      const template = appTemplates.find((item) => item.id === id);
      if (template) deleteTemplate(template);
      return;
    }

    const target = event.target instanceof Element ? event.target.closest("[data-template-id]") : null;
    const id = target?.getAttribute("data-template-id");
    const template = appTemplates.find((item) => item.id === id);
    if (template) documentToEditor(template);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && activeDocumentId) {
      event.preventDefault();
      editorForm.requestSubmit();
      return;
    }
    if (event.key === "Escape" && documentConfirmModal.classList.contains("is-open")) {
      resolveDocumentConfirm(false);
      return;
    }
    if (event.key === "Escape" && documentPdfModal.classList.contains("is-open")) {
      closeDocumentPdfModal();
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

init();
