import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";

const logoutButton = document.getElementById("portal-logout");

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    if (hasConfig()) {
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
    }
  } finally {
    window.location.replace("/account");
  }
});
