(function () {
  const root = document.documentElement;
  const logo = document.getElementById("portal-logo");
  const brandName = document.getElementById("portal-brand-name");
  const mobileTitle = document.getElementById("portal-mobile-title");
  const title = document.getElementById("portal-title");
  const lede = document.getElementById("portal-lede");
  const eyebrow = document.getElementById("portal-eyebrow");
  const launchStatus = document.getElementById("portal-launch-status");
  const statusTitle = document.getElementById("portal-status-title");
  const statusCopy = document.getElementById("portal-status-copy");
  const primaryAction = document.getElementById("portal-primary-action");
  const supportAction = document.getElementById("portal-support-action");
  const payLink = document.getElementById("portal-pay-link");
  const mobilePayLink = document.getElementById("portal-mobile-pay-link");
  const websiteLink = document.getElementById("portal-website-link");
  const mobileWebsiteLink = document.getElementById("portal-mobile-website-link");
  const supportCopy = document.getElementById("portal-support-copy");
  const paymentCopy = document.getElementById("portal-payment-copy");
  const stepList = document.getElementById("portal-step-list");
  const footerName = document.getElementById("portal-footer-name");

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getSlug() {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("slug");
    if (explicit) return explicit;
    const parts = window.location.pathname.split("/").filter(Boolean);
    const portalIndex = parts.indexOf("portal");
    return portalIndex >= 0 ? parts[portalIndex + 1] || "" : "";
  }

  function setLink(link, href) {
    if (!link) return;
    if (!href) {
      link.hidden = true;
      link.removeAttribute("href");
      return;
    }
    link.href = href;
    link.hidden = false;
  }

  function setBrandColors(branding) {
    if (branding.primary_color) root.style.setProperty("--mint", branding.primary_color);
    if (branding.secondary_color) root.style.setProperty("--cyan", branding.secondary_color);
  }

  function renderSteps(steps) {
    if (!Array.isArray(steps) || !steps.length) {
      stepList.innerHTML = '<p class="utilities-list-empty">Launch checklist is not available yet.</p>';
      return;
    }

    stepList.innerHTML = steps
      .map((step) => `
        <div class="portal-step">
          <span class="portal-step-status">${escapeHtml(titleCase(step.status))}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <small>${step.required ? "Required" : "Optional"}</small>
        </div>
      `)
      .join("");
  }

  function renderPortal(data) {
    const organization = data.organization || {};
    const branding = data.branding || {};
    const settings = data.settings || {};
    const payment = settings.payment || {};
    const displayName = branding.portal_display_name || organization.name || "Utility Portal";
    const isLive = organization.launch_status === "live";
    const payUrl = payment.existing_payment_url || "";
    const supportEmail = organization.support_email || "";
    const supportPhone = organization.support_phone || "";

    document.title = `${displayName} | Customer Portal`;
    setBrandColors(branding);
    brandName.textContent = displayName;
    mobileTitle.textContent = displayName;
    footerName.textContent = displayName;
    title.textContent = displayName;
    eyebrow.textContent = `${titleCase(organization.status)} Portal`;
    lede.textContent = isLive
      ? "Access customer services, support, payments, and updates from one place."
      : "This branded customer portal has been created and is currently being prepared for launch.";

    if (branding.logo_url) {
      logo.src = branding.logo_url;
      logo.alt = displayName;
    }

    launchStatus.textContent = titleCase(organization.launch_status || "draft");
    statusTitle.textContent = isLive ? "Portal is live" : "Portal setup in progress";
    statusCopy.textContent = isLive
      ? "Customer-facing services are available through this portal."
      : "N3XRA and this utility are completing setup before customer services go live.";

    setLink(primaryAction, payUrl);
    setLink(payLink, payUrl);
    setLink(mobilePayLink, payUrl);
    setLink(websiteLink, organization.website);
    setLink(mobileWebsiteLink, organization.website);
    setLink(supportAction, supportEmail ? `mailto:${supportEmail}` : "");

    supportCopy.textContent = [supportEmail, supportPhone].filter(Boolean).join(" · ") || "Support contact details are not configured yet.";
    paymentCopy.textContent = payUrl
      ? "This provider has connected an external payment link for customer bill payment."
      : payment.wants_stripe_connect
        ? "Stripe Connect payments have been requested and are waiting for activation."
        : "Payments are not configured yet.";

    renderSteps(data.launch_steps || []);
  }

  async function loadPortal() {
    const slug = getSlug();
    if (!slug) throw new Error("Missing utility portal slug.");
    const response = await fetch(`/api/utilities-portal?slug=${encodeURIComponent(slug)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Unable to load utility portal.");
    renderPortal(data);
  }

  loadPortal().catch((error) => {
    title.textContent = "Utility portal unavailable";
    lede.textContent = error instanceof Error ? error.message : "Unable to load this portal.";
    statusTitle.textContent = "Portal not found";
    statusCopy.textContent = "Check the portal slug or contact N3XRA support.";
    stepList.innerHTML = "";
  });
})();
