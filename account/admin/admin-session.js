import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { clearPlatformAdminAccessCache, getPlatformAdminAccess } from "/client-portal/admin-access.js";

let adminSessionPromise = null;
let adminSessionContext = null;
let authListenerInitialized = false;

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
  const allowed = ["owner", "admin"].includes(String(admin?.role || "").toLowerCase());
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
    if (!context.allowed && redirect) redirectToAccount(context.reason);
    return context;
  });
}

export function clearAdminSession() {
  adminSessionPromise = null;
  adminSessionContext = null;
  clearPlatformAdminAccessCache();
}
