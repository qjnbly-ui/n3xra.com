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

async function addApprovedPartnerLinks() {
  if (!hasConfig()) return;
  const supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session?.access_token) return;
  const response = await fetch("/api/partner-portal", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) return;

  document.querySelectorAll(".portal-nav, .site-mobile-menu").forEach((nav) => {
    if (nav.querySelector('a[href="/client-portal/partners/"]')) return;
    const link = document.createElement("a");
    link.href = "/client-portal/partners/";
    link.textContent = "Partner portal";
    link.className = nav.classList.contains("site-mobile-menu") ? "site-menu-link" : "";
    const support = nav.querySelector('a[href="/support/"]');
    nav.insertBefore(link, support || null);
  });
}

addApprovedPartnerLinks().catch(() => {});
