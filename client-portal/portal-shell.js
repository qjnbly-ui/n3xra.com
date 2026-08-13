import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { portalLoginUrl } from "/client-portal/tenant-context.js";

const logoutButton = document.getElementById("portal-logout");

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    if (hasConfig()) {
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
    }
  } finally {
    window.location.replace(portalLoginUrl());
  }
});
