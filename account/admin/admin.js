import { hasConfig } from "/shared/lib/supabase-client.js";
import { getAdminSession } from "/account/admin/admin-session.js?v=3";
import { arrangeAdminWorkspace, renderAdminNavigation } from "/account/admin/admin-navigation.js?v=27";
import { confirmAdminAction, promptAdminText } from "/account/admin/admin-dialogs.js";
import { initializeAdminSelects } from "/account/admin/admin-select.js?v=4";

initializeAdminSelects();

let view = "";
let setupPanel = null;
let adminPanel = null;
let statusEl = null;
let supabase = null;
let session = null;

function bindAdminDom() {
  view = document.body.dataset.adminView || "";
  setupPanel = document.getElementById("setup-panel");
  adminPanel = document.getElementById("admin-panel");
  statusEl = document.getElementById("admin-status");
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function setStatus(message = "", tone = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `admin-status${tone ? ` ${tone}` : ""}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value || "Not provided";
}

function providerLabel(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "Unknown";
  if (provider === "email") return "Email/password or magic link";
  if (provider === "phone") return "Phone";
  if (provider === "azure") return "Microsoft";
  return provider[0].toUpperCase() + provider.slice(1);
}

function deriveStripeState(item) {
  const hasCustomer = Boolean(item?.customerId);
  const hasSubscription = Boolean(item?.subscriptionId);
  const status = String(item?.status || "").trim().toLowerCase();

  if (hasCustomer && hasSubscription) return "Customer + subscription";
  if (hasCustomer) return "Customer only";

  if (["trialing", "trial", "active"].includes(status)) return "Internal access only";
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status)) return "Needs Stripe attention";
  if (["canceled", "cancelled"].includes(status)) return "Canceled";

  return "No Stripe record";
}

async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action, ...payload } });
  if (error) {
    let message = data?.error || error.message || "Admin request failed.";
    if (error.context && typeof error.context.json === "function") {
      try {
        const response = await error.context.json();
        message = response?.error || response?.message || message;
      } catch {
        // Preserve the SDK message when the response does not contain JSON.
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function invokeWebsiteAutomation(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("website-change-automation", { body: { action, ...payload } });
  if (error) {
    let message = data?.error || error.message || "Website automation request failed.";
    if (error.context && typeof error.context.json === "function") {
      try {
        const response = await error.context.json();
        message = response?.error || response?.message || message;
      } catch {
        // Preserve the SDK message when the response does not contain JSON.
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}





const investmentLabels = { shareholders: "Shareholders table", "share-classes": "Share Classes", "share-ledger": "Share Ledger", "board-resolutions": "Board Resolutions", "dividend-history": "Dividend History", "cap-table": "Cap Table", "valuation-history": "Company Valuation History", vesting: "Vesting Schedules", voting: "Voting Rights", certificates: "Stock Certificates", transfers: "Share Transfer Requests", buybacks: "Company Buyback Requests" };

const productAdminApps = {
  websites: {
    label: "Websites",
    sections: {
      overview: ["Website Overview", "Manage client websites, access, files, and lifecycle records.", "/n3xra-admin/websites/"],
      services: ["Services & Ownership", "Manage services, ownership, and related website records.", "/n3xra-admin/services/"],
      requests: ["Website Requests", "Review incoming website requests and their next steps.", "/n3xra-admin/requests/"],
      proposals: ["Website Proposals", "Review proposals and their project context.", "/n3xra-admin/proposals/"],
      progress: ["Website Progress", "Follow active website project progress.", "/n3xra-admin/projects/"],
      onboarding: ["Website Onboarding", "Manage website onboarding workflows.", "/n3xra-admin/onboarding/"],
      assets: ["Files & Assets", "Manage website files and assets.", "/n3xra-admin/assets/"],
      billing: ["Website Billing", "Review website billing records.", "/n3xra-admin/billing/"],
    },
  },
  records: {
    label: "Records",
    sections: {
      organizations: ["Records Organizations", "Manage Records plans, limits, features, trials, and owner support.", "/n3xra-admin/records/organizations/"],
      usage: ["Records Usage", "Review Records usage and limits.", "/n3xra-admin/records/usage/"],
    },
  },
  partners: {
    label: "Partners",
    sections: {
      applications: ["Partner Applications", "Review partner program interest and application decisions.", "/n3xra-admin/partners/"],
    },
  },
  "contact-cards": {
    label: "Contact Cards",
    sections: {
      workspace: ["Contact Cards", "Manage customer cards, public addresses, publishing, and physical-card requests.", "/n3xra-admin/contact-cards/"],
    },
  },
};

const embeddedProductStyles = `
  .site-topbar, .site-mobile-menu, .portal-nav, .site-footer { display: none !important; }
  html, body { min-height: 100%; background: #fff; }
  main.portal-shell { width: 100% !important; max-width: none !important; min-height: 100%; margin: 0 !important; padding: 0 !important; }
  .portal-layout { grid-template-columns: minmax(0, 1fr) !important; gap: 0 !important; width: 100% !important; }
  .portal-layout > .portal-workspace { min-width: 0; }
  .utilities-shell, .utilities-onboarding-page { width: 100% !important; max-width: none !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
  body.utilities-onboarding { background: #07111d !important; }
`;

function fitProductFrame(frame, doc) {
  const height = Math.max(
    doc.documentElement?.scrollHeight || 0,
    doc.body?.scrollHeight || 0,
    doc.documentElement?.offsetHeight || 0,
    doc.body?.offsetHeight || 0,
  );
  frame.style.height = `${Math.max(height, 520)}px`;
}

function embedProductFrame(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc?.head || !doc.body) return;
    doc.body.classList.add("n3xra-embedded-product");
    let style = doc.getElementById("n3xra-embedded-product-styles");
    if (!style) {
      style = doc.createElement("style");
      style.id = "n3xra-embedded-product-styles";
      style.textContent = embeddedProductStyles;
      doc.head.append(style);
    }
    frame.__n3xraProductResizeObserver?.disconnect?.();
    const resize = () => requestAnimationFrame(() => fitProductFrame(frame, doc));
    resize();
    if (doc.defaultView?.ResizeObserver) {
      const observer = new doc.defaultView.ResizeObserver(resize);
      observer.observe(doc.documentElement);
      observer.observe(doc.body);
      frame.__n3xraProductResizeObserver = observer;
    }
    frame.classList.remove("hidden");
    frame.classList.add("is-ready");
  } catch {
    // Product workspaces are same-origin. If that ever changes, leave the original page intact.
    frame.classList.remove("hidden");
  }
}

function loadProductAdminApp() {
  const params = new URLSearchParams(window.location.search);
  const app = productAdminApps[params.get("app")];
  const sectionKey = params.get("section");
  const section = app?.sections?.[sectionKey] || app?.sections?.[Object.keys(app.sections)[0]];
  if (!app || !section) return;
  window.location.replace(section[2]);
}

function selectInvestmentSection() {
  if (document.body.dataset.adminView !== "investment") return;
  const key = window.location.hash.slice(1);
  const label = investmentLabels[key];
  document.querySelectorAll("[data-investment-section]").forEach((link) => link.classList.toggle("is-current", link.dataset.investmentSection === key));
  if (!label) return;
  document.getElementById("investment-workspace-title").textContent = label;
  document.getElementById("investment-workspace-copy").textContent = "This workspace is reserved for the future controlled record and workflow.";
  document.getElementById("investment-empty-title").textContent = `${label} is not active`;
  document.getElementById("investment-empty-copy").textContent = "No records, controls, or workflows have been activated. This area will remain blank until the appropriate legal, accounting, and governance foundation is in place.";
}

window.addEventListener("hashchange", selectInvestmentSection);

async function loadAdminView(adminContext) {
  if (view === "accounts") {
    const accountsController = await import("/account/admin/controllers/accounts.js?v=5");
    await accountsController.startAccounts({ supabase, invoke, escapeHtml, formatDate, formatPhone, providerLabel, setStatus, confirmAdminAction, promptAdminText, platformAdminRole: adminContext.admin?.role, currentUserId: adminContext.user?.id });
  } else if (view === "files") {
    const files = await import("/account/admin/files/files.js?v=24");
    await files.startFiles({ supabase, session, invoke });
  } else if (view === "prospects") {
    const prospects = await import("/account/admin/prospects/prospects.js?v=1");
    await prospects.startProspects({ supabase, session, confirmAdminAction });
  } else if (view === "business-info") {
    const businessInformation = await import("/account/admin/business-info/business-info.js?v=1");
    await businessInformation.startBusinessInformation({ invoke });
  } else if (view === "billing") {
    const billingController = await import("/account/admin/controllers/billing.js?v=3");
    await billingController.startBilling({ invoke, escapeHtml, formatDate, deriveStripeState, setStatus });
  } else if (view === "operations") {
    const operations = await import("/account/admin/operations/operations.js?v=18");
    await operations.startOperations({ supabase, session, invoke });
  } else if (view === "support") {
    const supportController = await import("/account/admin/controllers/support.js?v=8");
    await supportController.startSupport({ invoke, invokeWebsiteAutomation, escapeHtml, formatDate, setStatus, confirmAdminAction });
  } else if (view === "platform-admins") {
    const platformAdmins = await import("/account/admin/controllers/platform-admins.js?v=5");
    await platformAdmins.startPlatformAdmins({ invoke, escapeHtml, setStatus, confirmAdminAction });
  } else if (view === "codebase-ai") {
    const codebaseAi = await import("/account/admin/controllers/codebase-ai.js?v=2");
    await codebaseAi.startCodebaseAi({ session, escapeHtml, formatDate, setStatus });
  } else if (view === "analytics") {
    const analytics = await import("/account/admin/controllers/analytics.js?v=1");
    await analytics.startAnalytics({ session, escapeHtml, formatDate, setStatus });
  } else if (view === "applications") {
    const applications = await import("/account/admin/applications/applications.js?v=8");
    await applications.startApplications({ supabase, session });
  } else if (view === "investment") {
    selectInvestmentSection();
  } else if (view === "product-apps") {
    loadProductAdminApp();
  }
}

export async function startAdmin() {
  bindAdminDom();
  if (!hasConfig()) {
    setupPanel?.classList.remove("hidden");
    document.body.classList.add("admin-ready");
    return;
  }
  const context = await getAdminSession();
  if (!context.allowed) return;
  renderAdminNavigation();
  supabase = context.supabase;
  session = context.session;
  adminPanel?.classList.remove("hidden");
  arrangeAdminWorkspace();
  await loadAdminView(context);
  document.body.classList.add("admin-ready");
}

if (!window.__n3xraAdminSoftNavigation) {
  startAdmin().catch((error) => {
    document.body.classList.add("admin-ready");
    setStatus(error.message || "Unable to load the admin product.", "error");
  });
}
