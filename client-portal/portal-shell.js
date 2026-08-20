import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { clearPendingProposalNoticeDismissals } from "./pending-proposal-notice.js";
import { portalSignedOutUrl } from "./tenant-context.js";
async function signOut() {
    const signOutControls = [...document.querySelectorAll("#portal-logout, [data-portal-logout]")];
    signOutControls.forEach((button) => {
        button.disabled = true;
        button.textContent = "Signing out…";
    });
    try {
        if (hasConfig()) {
            const supabase = createBrowserSupabase();
            if (supabase) {
                const { error } = await supabase.auth.signOut({ scope: "local" });
                if (error)
                    throw error;
            }
        }
    }
    catch (error) {
        console.warn("Portal sign-out did not complete cleanly.", error);
    }
    finally {
        clearPendingProposalNoticeDismissals();
        window.location.replace(portalSignedOutUrl());
    }
}
document.querySelectorAll("#portal-logout, [data-portal-logout]").forEach((button) => {
    button.addEventListener("click", signOut);
});
