import { privateProductPath, type PrivateProduct } from "./private-products.js";
interface Organization { id: string; name: string; account_status: string; }
interface Website { id: string; name: string; portal_slug: string; status: string; }
interface Product { product_key: string; name: string; status: string; manage_path: string; }
const html = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function startOrganizations({ supabase }: { supabase: any }): Promise<void> {
  const root = document.querySelector<HTMLElement>("#organizations-workspace");
  if (!root) return;
  const {data, error} = await supabase.from("organizations").select("id,name,account_status").order("name");
  if (error) throw error;
  const organizations: Organization[] = data || [];
  let selected = new URLSearchParams(location.search).get("organization") || organizations[0]?.id || "";
  let revision = 0;
  root.innerHTML = `<aside class="org-directory"><label for="org-search">Organizations</label><input id="org-search" type="search" placeholder="Search organizations"><div id="org-list"></div></aside><section class="org-detail" id="org-detail" aria-live="polite"></section>`;
  const list = root.querySelector<HTMLElement>("#org-list")!;
  const detail = root.querySelector<HTMLElement>("#org-detail")!;
  function renderList(search = ""): void {
    list.innerHTML = organizations.filter(o => o.name.toLowerCase().includes(search.toLowerCase())).map(o => `<button type="button" data-org="${html(o.id)}" aria-pressed="${o.id === selected}"><strong>${html(o.name)}</strong><small>${html(o.account_status)}</small></button>`).join("") || "<p>No organizations found.</p>";
  }
  async function show(id: string): Promise<void> {
    const org = organizations.find(o => o.id === id);
    if (!org) { detail.textContent = "Choose an organization to view its products."; return; }
    selected = id; const request = ++revision; renderList((root!.querySelector<HTMLInputElement>("#org-search")!).value);
    detail.textContent = "Loading organization…";
    const url = new URL(location.href); url.searchParams.set("organization", id); history.replaceState(history.state, "", url);
    const results = await Promise.all([
      supabase.from("client_websites").select("id,name,portal_slug,status").eq("organization_id", id).order("name"),
      supabase.from("organization_private_products").select("id,organization_id,name,description,app_path,status").eq("organization_id", id).order("name"),
      supabase.rpc("client_portal_organization_access_snapshot", { input_organization_id: id }),
    ]);
    if (request !== revision || !root!.isConnected) return;
    const failed = results.find(r => r.error); if (failed) throw failed.error;
    const websites: Website[] = results[0].data || [];
    const products: PrivateProduct[] = results[1].data || [];
    const shared: Product[] = (results[2].data?.products || []).filter((p: Product) => p.product_key !== "website");
    const preview = `/client-portal/organization/?organization=${encodeURIComponent(id)}`;
    detail.innerHTML = `<header><p class="org-eyebrow">Organization</p><h1>${html(org.name)}</h1><p>${html(org.account_status)} · ${websites.length} websites · ${products.length + shared.length} products</p><a class="org-button" href="${preview}">Open organization portal</a><a class="org-button secondary" href="/client-portal/team/?organization=${encodeURIComponent(id)}">Manage members</a></header>
      <section><h2>Private products</h2><p>Built for this organization. Active products are available to its members after sign-in.</p><div class="org-cards">${products.map(p => `<article><span class="org-eyebrow">Private · ${html(p.status)}</span><h3>${html(p.name)}</h3><p>${html(p.description)}</p><small>${html(p.app_path)}</small><div class="org-actions">${p.status === "active" ? `<a href="${html(privateProductPath(p.app_path,id,p.id))}">Open product</a>` : ""}<button type="button" data-edit="${html(p.id)}">Edit</button></div></article>`).join("") || "<p>No private products yet. Add the application when it is ready.</p>"}</div>
      <form id="private-product-form"><h3 id="product-form-title">Add private product</h3><input name="id" type="hidden"><label>Name<input name="name" required maxlength="120"></label><label>Description<textarea name="description" maxlength="2000"></textarea></label><label>Application path<input name="app_path" required placeholder="/client-portal/your-product/"><small>The application must enforce organization access in its data and APIs.</small></label><label>Status<select name="status"><option value="draft">Draft — hidden from members</option><option value="active">Active — visible to members</option><option value="paused">Paused — access disabled</option></select></label><div class="org-actions"><button class="org-button" type="submit">Save product</button><button type="reset">Clear</button></div><p id="product-save-status" role="status"></p></form></section>
      <section><h2>Shared products</h2><div class="org-cards">${shared.map(p => `<article><h3>${html(p.name)}</h3><p>${html(p.status)}</p><a href="${preview}">Open in organization portal</a></article>`).join("") || "<p>No shared products enabled.</p>"}</div></section>
      <section><h2>Websites &amp; sign-in</h2><div class="org-cards">${websites.map(w => `<article><h3>${html(w.name)}</h3><p>${html(w.status)}</p>${/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(w.portal_slug) ? `<a href="https://${html(w.portal_slug)}.portal.n3xra.com/client-portal/login/">Open website sign-in</a>` : "<p>Portal address is not configured.</p>"}</article>`).join("") || "<p>No website is linked to this organization yet.</p>"}</div></section>`;
    const form = detail.querySelector<HTMLFormElement>("form")!;
    detail.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach(button => button.addEventListener("click", () => {
      const product = products.find(p => p.id === button.dataset.edit)!;
      for (const key of ["id","name","description","app_path","status"] as const) (form.elements.namedItem(key) as HTMLInputElement).value = product[key];
      detail.querySelector("#product-form-title")!.textContent = "Edit private product";
      form.scrollIntoView({block:"nearest"});
    }));
    form.addEventListener("reset", () => { detail.querySelector("#product-form-title")!.textContent = "Add private product"; });
    form.addEventListener("submit", async event => {
      event.preventDefault(); const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      const status = form.querySelector<HTMLElement>("#product-save-status")!; button.disabled = true;
      try {
        const values = new FormData(form); const productId = String(values.get("id") || "");
        const appPath = String(values.get("app_path") || "").trim();
        if (!privateProductPath(appPath,id,productId)) throw new Error("Use a local application path without a domain, query string, or parent directory.");
        const row = {organization_id:id,name:String(values.get("name") || "").trim(),description:String(values.get("description") || "").trim(),app_path:appPath,status:String(values.get("status"))};
        const query = supabase.from("organization_private_products");
        const saved = productId ? await query.update(row).eq("id",productId).eq("organization_id",id).select("id").single() : await query.insert(row).select("id").single();
        if (saved.error) throw saved.error;
        await show(id);
      } catch (error) { status.textContent = (error as Error).message || "Unable to save product."; }
      finally { button.disabled = false; }
    });
  }
  const showError = (error: unknown): void => { detail.textContent = (error as Error).message || "Unable to load organization."; };
  root.querySelector("#org-search")!.addEventListener("input", e => renderList((e.target as HTMLInputElement).value));
  list.addEventListener("click", e => { const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-org]"); if (button) void show(button.dataset.org!).catch(showError); });
  renderList(); await show(selected).catch(showError);
}
