const view = document.body.dataset.portalView;
const response = await fetch("/client-portal/");
if (!response.ok) throw new Error("The client portal layout could not be loaded.");
const source = new DOMParser().parseFromString(await response.text(), "text/html");
source.querySelectorAll("script").forEach((script) => script.remove());
document.body.innerHTML = source.body.innerHTML;
document.body.className = `portal-loading client-${view}-view`;

if (view === "assets") {
  document.title = "N3XRA | Files & Assets";
  document.querySelector(".portal-heading h1").textContent = "Website Client Portal";
  document.querySelectorAll("[data-portal-panel]").forEach((panel) => { panel.hidden = panel.dataset.portalPanel !== "files"; });
  document.querySelectorAll("[data-portal-view]").forEach((item) => item.classList.toggle("is-current", item.dataset.portalView === "files"));
}

await import("/assets/site-nav.js");
await import("/client-portal/client-shell.js?v=2");
await import("/client-portal/portal.js?v=15");
