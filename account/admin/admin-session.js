import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { clearPlatformAdminAccessCache, getPlatformAdminAccess } from "/client-portal/admin-access.js";

let adminSessionPromise = null;
let adminSessionContext = null;
let authListenerInitialized = false;

const OPERATIONS_ADMIN_PATHS = new Set([
  "/account/admin/inbox/",
  "/account/admin/accounts/",
  "/account/admin/support/",
  "/account/admin/billing/",
  "/account/admin/operations/",
  "/account/admin/analytics/",
  "/account/admin/applications/",
  "/account/admin/business-info/",
  "/account/admin/files/",
  "/account/admin/communications/",
  "/account/notifications/",
  "/n3xra-admin/websites/",
  "/n3xra-admin/website-portal/",
  "/n3xra-admin/services/",
  "/n3xra-admin/requests/",
  "/n3xra-admin/proposals/",
  "/n3xra-admin/projects/",
  "/n3xra-admin/onboarding/",
  "/n3xra-admin/assets/",
  "/n3xra-admin/billing/",
  "/n3xra-admin/records/organizations/",
  "/n3xra-admin/records/usage/",
  "/n3xra-admin/communications/",
  "/n3xra-admin/communications/websites-forms/",
  "/n3xra-admin/communications/subscribers/",
  "/n3xra-admin/communications/topics-signup/",
  "/n3xra-admin/communications/activity-usage/",
  "/n3xra-admin/communications/email-readiness/",
  "/n3xra-admin/communications/texting-readiness/",
  "/n3xra-admin/communications/pricing-activation/",
  "/n3xra-admin/communications/requests/",
]);

function normalizeAdminPath(pathname = window.location.pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "");
  return path ? `${path}/` : "/";
}

export function canOpenAdminPath(role, pathname = window.location.pathname) {
  const normalizedRole = String(role || "").toLowerCase();
  if (["owner", "admin"].includes(normalizedRole)) return true;
  return normalizedRole === "operations_admin" && OPERATIONS_ADMIN_PATHS.has(normalizeAdminPath(pathname));
}

function accountUrl() {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/account?next=${encodeURIComponent(next)}`;
}

function redirectToAccount(reason = "signed-out") {
  const destination = reason === "unauthorized" ? "/account" : accountUrl();
  if (`${window.location.pathname}${window.location.search}` !== destination) {
    window.location.replace(destination);
  }
}

function watchAuthState(supabase) {
  if (authListenerInitialized) return;
  authListenerInitialized = true;
  supabase.auth.onAuthStateChange((event, nextSession) => {
    if (nextSession && adminSessionContext?.session) {
      Object.assign(adminSessionContext.session, nextSession);
      adminSessionContext.user = nextSession.user;
    }
    if (event === "SIGNED_OUT") {
      adminSessionPromise = null;
      adminSessionContext = null;
      clearPlatformAdminAccessCache();
      redirectToAccount("signed-out");
    }
  });
}

async function loadAdminSession() {
  if (!hasConfig()) throw new Error("N3XRA is not connected to Supabase.");

  const supabase = createBrowserSupabase();
  watchAuthState(supabase);
  const session = await getSessionOrNull(supabase);
  if (!session?.user) return { allowed: false, reason: "signed-out", supabase, session: null, user: null, admin: null };

  const admin = await getPlatformAdminAccess(supabase, session.user);
  const allowed = canOpenAdminPath(admin?.role);
  document.body.dataset.adminRole = String(admin?.role || "").toLowerCase();
  window.__n3xraAdminRole = String(admin?.role || "").toLowerCase();
  adminSessionContext = {
    allowed,
    reason: allowed ? "" : "unauthorized",
    supabase,
    session,
    user: session.user,
    admin,
  };
  return adminSessionContext;
}

export function getAdminSession({ redirect = true, force = false } = {}) {
  if (force || !adminSessionPromise) {
    adminSessionPromise = loadAdminSession().catch((error) => {
      adminSessionPromise = null;
      throw error;
    });
  }

  return adminSessionPromise.then((context) => {
    const allowed = Boolean(context.admin && canOpenAdminPath(context.admin.role));
    const currentContext = { ...context, allowed, reason: allowed ? "" : context.user ? "unauthorized" : context.reason };
    if (!currentContext.allowed && redirect) redirectToAccount(currentContext.reason);
    return currentContext;
  });
}

export function clearAdminSession() {
  adminSessionPromise = null;
  adminSessionContext = null;
  clearPlatformAdminAccessCache();
}
