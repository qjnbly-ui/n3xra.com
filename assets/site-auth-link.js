import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/shared/lib/orgs.js";

const authLinks = Array.from(document.querySelectorAll("[data-site-auth-link]"));

function getDashboardHref(session) {
  return isPlatformAdminEmail(session?.user?.email) ? "/n3xra-admin/records" : "/n3xra-records/library";
}

function setAuthLinks(session) {
  const isSignedIn = Boolean(session?.user);

  authLinks.forEach((link) => {
    link.textContent = isSignedIn ? "Dashboard" : "Login";
    link.href = isSignedIn ? getDashboardHref(session) : "/n3xra-records/login";
    link.dataset.authState = isSignedIn ? "signed-in" : "signed-out";
    link.setAttribute("aria-label", isSignedIn ? "Open dashboard" : "Sign in");
  });
}

async function initAuthLink() {
  if (!authLinks.length) return;

  setAuthLinks(null);
  if (!hasConfig()) return;

  const supabase = createBrowserSupabase();
  if (!supabase) return;

  try {
    const session = await getSessionOrNull(supabase);
    setAuthLinks(session);

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      setAuthLinks(nextSession);
    });
  } catch (_error) {
    setAuthLinks(null);
  }
}

initAuthLink();
