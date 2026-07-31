import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId } from "/shared/lib/orgs.js";

const DESKTOP_SHELL_BREAKPOINT = 981;
const RECORDS_AI_HISTORY_LIMIT = 8;

let recordsAiSupabase = null;
let recordsAiHistory = [];
let recordsAiLastFocusedElement = null;

const RECORDS_WORKSPACE_LINKS = [
  { key: "library", label: "Library", href: "/n3xra-records/library" },
  { key: "files", label: "Files", href: "/n3xra-records/files.html" },
  { key: "messages", label: "Communication", href: "/n3xra-records/messages.html" },
  { key: "meeting-notes", label: "Meeting Notes", href: "/n3xra-records/meeting-notes" },
];

const RECORDS_MANAGE_GROUPS = [
  {
    label: "Configuration",
    links: [
      { label: "Library settings", view: "library" },
      { label: "Templates", view: "templates" },
      { label: "Phone Meetings", view: "phone" },
      { label: "AI settings", view: "ai" },
    ],
  },
  {
    label: "People and access",
    links: [
      { label: "Users", view: "users" },
      { label: "Contacts", view: "contacts" },
      { label: "Invites & access", view: "access" },
    ],
  },
  {
    label: "Plan and usage",
    links: [
      { label: "Storage", view: "storage" },
      { label: "Billing", view: "billing" },
    ],
  },
  {
    label: "Audit",
    links: [{ label: "Audit activity", view: "activity" }],
  },
  {
    label: "Support",
    links: [{ label: "N3XRA support access", view: "support" }],
  },
];

function normalizePathname(value = window.location.pathname) {
  return String(value || "")
    .replace(/\/index\.html$/i, "")
    .replace(/\.html$/i, "")
    .replace(/\/+$/, "");
}

function getActiveRecordsPage() {
  const pathname = normalizePathname();
  if (pathname.endsWith("/n3xra-records/account")) return "account";
  if (pathname.endsWith("/n3xra-records/library")) return "library";
  if (pathname.endsWith("/n3xra-records/files") || pathname.endsWith("/n3xra-records/documents")) return "files";
  if (pathname.endsWith("/n3xra-records/messages")) return "messages";
  if (
    pathname.endsWith("/n3xra-records/meeting-notes") ||
    pathname.endsWith("/n3xra-records/all-meeting-notes") ||
    pathname.endsWith("/n3xra-records/recordings") ||
    pathname.endsWith("/n3xra-records/all-recordings")
  ) return "meeting-notes";
  return "";
}

function renderPrimaryLink(item, activePage) {
  const isActive = item.key === activePage;
  return `<a href="${item.href}"${isActive ? ' class="is-active" aria-current="page"' : ""}>${item.label}</a>`;
}

function renderManageGroup(group) {
  return `
    <p class="records-desktop-nav-group-label">${group.label}</p>
    ${group.links
      .map((item) => `<a href="/n3xra-records/account/?view=${item.view}">${item.label}</a>`)
      .join("")}
  `;
}

function buildDesktopNavigation(activePage) {
  const navigation = document.createElement("aside");
  navigation.className = "records-desktop-nav records-shared-desktop-nav";
  navigation.setAttribute("aria-label", "Records navigation");
  navigation.innerHTML = `
    <p class="records-desktop-nav-label">N3XRA Records</p>
    <div class="records-desktop-nav-section">
      <p class="records-desktop-nav-group-label">Workspace</p>
      <nav class="records-desktop-nav-links records-desktop-nav-primary">
        ${RECORDS_WORKSPACE_LINKS.map((item) => renderPrimaryLink(item, activePage)).join("")}
      </nav>

      <button
        class="records-desktop-nav-parent records-desktop-nav-toggle"
        type="button"
        data-records-manage-toggle
        aria-expanded="false"
        aria-controls="records-shared-manage-library-menu"
      >
        <span>Manage library</span>
        <span class="records-desktop-nav-toggle-icon" data-records-manage-indicator aria-hidden="true">+</span>
      </button>
      <nav
        class="records-desktop-nav-links records-desktop-nav-submenu records-desktop-nav-manage"
        id="records-shared-manage-library-menu"
        data-records-manage-menu
        hidden
      >
        ${RECORDS_MANAGE_GROUPS.map(renderManageGroup).join("")}
      </nav>

      <div class="records-desktop-nav-divider"></div>
      <p class="records-desktop-nav-group-label">Account</p>
      <nav class="records-desktop-nav-links records-desktop-nav-account">
        <a href="/n3xra-records/account/?view=profile"${activePage === "account" ? ' class="is-active" aria-current="page"' : ""}>Profile</a>
      </nav>
    </div>
  `;

  const manageToggle = navigation.querySelector("[data-records-manage-toggle]");
  const manageMenu = navigation.querySelector("[data-records-manage-menu]");
  const manageIndicator = navigation.querySelector("[data-records-manage-indicator]");
  manageToggle?.addEventListener("click", () => {
    const isOpen = manageToggle.getAttribute("aria-expanded") === "true";
    manageToggle.setAttribute("aria-expanded", String(!isOpen));
    manageToggle.classList.toggle("records-desktop-nav-parent-active", !isOpen);
    if (manageMenu) manageMenu.hidden = isOpen;
    if (manageIndicator) manageIndicator.textContent = isOpen ? "+" : "−";
  });

  return navigation;
}

function installDesktopHeader() {
  const topbarInner = document.querySelector(".topbar > .topbar-inner");
  if (!topbarInner || topbarInner.querySelector(".records-desktop-appbar")) return;

  const appbar = document.createElement("div");
  appbar.className = "records-desktop-appbar";
  appbar.innerHTML = `
    <a class="records-desktop-app-brand" href="/n3xra-records/library" aria-label="N3XRA Records home">
      <img src="/assets/n3xra_logo_transparent_small.png" alt="">
      <span>N3XRA</span>
      <i aria-hidden="true"></i>
      <strong>Records</strong>
    </a>
    <div class="records-desktop-app-actions">
      <button class="records-ai-header-trigger" type="button" data-records-ai-open>Ask Records AI</button>
      <a href="/account/">Dashboard</a>
      <button type="button" data-records-desktop-signout>Sign out</button>
    </div>
  `;

  appbar.querySelector("[data-records-desktop-signout]")?.addEventListener("click", () => {
    document.getElementById("mobile-logout-button")?.click();
  });

  topbarInner.prepend(appbar);
}

function getRecordsAiLibraryName() {
  const activeSelect =
    document.getElementById("active-organization-select")
    || document.getElementById("library-active-organization-select");
  const selectedLabel = activeSelect?.selectedOptions?.[0]?.textContent?.trim();
  if (selectedLabel) return selectedLabel.replace(/\s+\([^)]*\)\s*$/, "");

  const activeName =
    document.getElementById("active-organization-name")
    || document.getElementById("library-active-organization-name");
  return String(activeName?.textContent || "").trim();
}

function appendRecordsAiMessage(container, role, content) {
  if (!container || !content) return;
  const message = document.createElement("div");
  message.className = `records-ai-message is-${role}`;

  const label = document.createElement("p");
  label.className = "records-ai-message-label";
  label.textContent = role === "assistant" ? "Records AI" : "You";

  const copy = document.createElement("p");
  copy.className = "records-ai-message-copy";
  copy.textContent = content;

  message.append(label, copy);
  container.append(message);
  container.scrollTop = container.scrollHeight;
}

function setRecordsAiStatus(message = "", tone = "") {
  const status = document.querySelector("[data-records-ai-status]");
  if (!status) return;
  status.textContent = message;
  status.className = "records-ai-status";
  if (tone) status.classList.add(`is-${tone}`);
}

function openRecordsAiAssistant() {
  const layer = document.querySelector("[data-records-ai-layer]");
  if (!layer) return;
  recordsAiLastFocusedElement = document.activeElement;
  layer.hidden = false;
  window.requestAnimationFrame(() => {
    layer.classList.add("is-open");
    layer.querySelector("[data-records-ai-question]")?.focus();
  });
}

function closeRecordsAiAssistant() {
  const layer = document.querySelector("[data-records-ai-layer]");
  if (!layer || layer.hidden) return;
  layer.classList.remove("is-open");
  window.setTimeout(() => {
    layer.hidden = true;
    if (recordsAiLastFocusedElement instanceof HTMLElement) recordsAiLastFocusedElement.focus();
  }, 220);
}

async function getRecordsAiAccessToken() {
  if (!hasConfig()) throw new Error("Records is not configured on this server.");
  if (!recordsAiSupabase) recordsAiSupabase = createBrowserSupabase();
  const { data: refreshedData } = await recordsAiSupabase.auth.refreshSession();
  const { data: sessionData } = await recordsAiSupabase.auth.getSession();
  return refreshedData?.session?.access_token || sessionData?.session?.access_token || "";
}

async function askRecordsAi(question) {
  const accessToken = await getRecordsAiAccessToken();
  if (!accessToken) throw new Error("Your session expired. Sign in again and retry.");

  const organizationId = getStoredActiveOrganizationId();
  if (!organizationId) throw new Error("Choose an active library before asking Records AI.");

  const response = await fetch("/api/records-help", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      question,
      history: recordsAiHistory,
      context: {
        organizationId,
        libraryName: getRecordsAiLibraryName(),
        role: "",
        plan: "",
        currentPath: window.location.pathname,
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Records AI is unavailable right now.");
  return String(data?.answer || "").trim();
}

async function handleRecordsAiSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const questionInput = form.querySelector("[data-records-ai-question]");
  const submitButton = form.querySelector("[data-records-ai-submit]");
  const messages = document.querySelector("[data-records-ai-messages]");
  const question = String(questionInput?.value || "").trim();
  if (!question) {
    setRecordsAiStatus("Enter a question first.", "error");
    questionInput?.focus();
    return;
  }

  appendRecordsAiMessage(messages, "user", question);
  questionInput.value = "";
  submitButton.disabled = true;
  setRecordsAiStatus("Records AI is thinking…");

  try {
    const answer = await askRecordsAi(question);
    if (!answer) throw new Error("Records AI returned an empty answer.");
    appendRecordsAiMessage(messages, "assistant", answer);
    recordsAiHistory.push(
      { role: "user", content: question },
      { role: "assistant", content: answer }
    );
    if (recordsAiHistory.length > RECORDS_AI_HISTORY_LIMIT) {
      recordsAiHistory = recordsAiHistory.slice(-RECORDS_AI_HISTORY_LIMIT);
    }
    setRecordsAiStatus("");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to ask Records AI.";
    appendRecordsAiMessage(messages, "assistant", message);
    setRecordsAiStatus(message, "error");
  } finally {
    submitButton.disabled = false;
    questionInput?.focus();
  }
}

function installRecordsAiAssistant() {
  if (document.querySelector("[data-records-ai-layer]")) return;

  const mobileMenu = document.getElementById("mobile-menu");
  if (mobileMenu && !mobileMenu.querySelector("[data-records-ai-open]")) {
    const mobileTrigger = document.createElement("button");
    mobileTrigger.className = "mobile-menu-link records-ai-mobile-trigger";
    mobileTrigger.type = "button";
    mobileTrigger.dataset.recordsAiOpen = "";
    mobileTrigger.textContent = "Ask Records AI";
    mobileMenu.append(mobileTrigger);
  }

  const layer = document.createElement("div");
  layer.className = "records-ai-layer";
  layer.dataset.recordsAiLayer = "";
  layer.hidden = true;
  layer.innerHTML = `
    <button class="records-ai-scrim" type="button" data-records-ai-close aria-label="Close Records AI"></button>
    <aside class="records-ai-drawer" role="dialog" aria-modal="true" aria-labelledby="records-ai-title">
      <header class="records-ai-drawer-head">
        <div>
          <p class="records-ai-kicker">N3XRA Records</p>
          <h2 id="records-ai-title">Ask Records AI</h2>
          <p>Get help using the app and finding the right workflow.</p>
        </div>
        <button class="records-ai-close" type="button" data-records-ai-close aria-label="Close Records AI">×</button>
      </header>
      <div class="records-ai-messages" data-records-ai-messages aria-live="polite"></div>
      <div class="records-ai-starters" aria-label="Suggested questions">
        <button type="button" data-records-ai-prompt="How do I start and finish a meeting note?">Meeting notes</button>
        <button type="button" data-records-ai-prompt="How do I invite someone and control their access?">Invite a user</button>
        <button type="button" data-records-ai-prompt="Where can I change the AI settings for my library?">AI settings</button>
      </div>
      <form class="records-ai-composer" data-records-ai-form>
        <label for="records-ai-question">Ask a Records question</label>
        <div>
          <textarea id="records-ai-question" data-records-ai-question rows="2" maxlength="900" placeholder="How do I…"></textarea>
          <button type="submit" data-records-ai-submit>Ask</button>
        </div>
        <p class="records-ai-status" data-records-ai-status></p>
      </form>
    </aside>
  `;
  document.body.append(layer);

  const messages = layer.querySelector("[data-records-ai-messages]");
  appendRecordsAiMessage(
    messages,
    "assistant",
    "Hi—ask me how to use N3XRA Records, where to find a setting, or what to do next."
  );

  document.querySelectorAll("[data-records-ai-open]").forEach((button) => {
    button.addEventListener("click", openRecordsAiAssistant);
  });
  layer.querySelectorAll("[data-records-ai-close]").forEach((button) => {
    button.addEventListener("click", closeRecordsAiAssistant);
  });
  layer.querySelector("[data-records-ai-form]")?.addEventListener("submit", handleRecordsAiSubmit);
  layer.querySelectorAll("[data-records-ai-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = layer.querySelector("[data-records-ai-question]");
      input.value = button.dataset.recordsAiPrompt || "";
      input.focus();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !layer.hidden) closeRecordsAiAssistant();
  });
}

function installDesktopShell() {
  const body = document.body;
  const shell = body?.querySelector(":scope > .shell");
  const main = shell?.querySelector(":scope > main.main");
  if (!body || !shell || !main) return;

  installDesktopHeader();
  installRecordsAiAssistant();

  if (body.classList.contains("records-account-page") || shell.querySelector(":scope > .records-desktop-frame")) return;

  const frame = document.createElement("div");
  frame.className = "records-desktop-frame";
  frame.append(buildDesktopNavigation(getActiveRecordsPage()), main);
  shell.append(frame);
  body.classList.add("records-shared-desktop-shell-page");

  if (window.innerWidth >= DESKTOP_SHELL_BREAKPOINT) {
    main.scrollTop = 0;
  }
}

installDesktopShell();
