import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/app/lib/supabase-client.js";
import { isPlatformAdminEmail } from "/app/lib/orgs.js";

const authLinks = Array.from(document.querySelectorAll("[data-site-auth-link]"));

function getDashboardHref(session) {
  return isPlatformAdminEmail(session?.user?.email) ? "/app/admin" : "/app/library";
}

function setAuthLinks(session) {
  const isSignedIn = Boolean(session?.user);

  authLinks.forEach((link) => {
    link.textContent = isSignedIn ? "Dashboard" : "Login";
    link.href = isSignedIn ? getDashboardHref(session) : "/app/login";
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
