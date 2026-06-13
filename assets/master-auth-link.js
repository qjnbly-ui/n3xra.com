import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/app/lib/supabase-client.js";

const authLinks = Array.from(document.querySelectorAll("[data-master-auth-link]"));

function setAuthLinks(session) {
  const isSignedIn = Boolean(session?.user);

  authLinks.forEach((link) => {
    link.textContent = isSignedIn ? "Dashboard" : "Login";
    link.href = "/account";
    link.dataset.authState = isSignedIn ? "signed-in" : "signed-out";
    link.setAttribute("aria-label", isSignedIn ? "Open N3XRA dashboard" : "Sign in to N3XRA");
  });
}

async function initMasterAuthLinks() {
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

initMasterAuthLinks();
