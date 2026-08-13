import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { portalSignedOutUrl } from "./tenant-context.js";

const logoutButton = document.querySelector<HTMLButtonElement>("#portal-logout");

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = "Signing out…";

  try {
    if (hasConfig()) {
      const supabase = createBrowserSupabase();
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
    }
  } catch (error) {
    console.warn("Portal sign-out did not complete cleanly.", error);
  } finally {
    window.location.replace(portalSignedOutUrl());
  }
});
