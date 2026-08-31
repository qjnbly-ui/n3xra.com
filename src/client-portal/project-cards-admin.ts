import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";

interface ProjectRow { organization_id: string }
interface CardRow { organization_id: string; project_id: string | null }
interface EntitlementRow { organization_id: string; organization: { id: string; name: string } | Array<{ id: string; name: string }> | null }

const one = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const organization = (row: EntitlementRow): { id: string; name: string } | null => Array.isArray(row.organization) ? row.organization[0] || null : row.organization;

async function start(): Promise<void> {
  if (!hasConfig()) throw new Error("The N3XRA data connection is not configured.");
  const supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) { window.location.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`); return; }
  const { data: allowed, error: adminError } = await supabase.rpc("is_platform_admin");
  if (adminError || allowed !== true) { window.location.replace("/account"); return; }
  const [{ data: entitlements, error: entitlementError }, { data: projects, error: projectError }, { data: cards, error: cardError }] = await Promise.all([
    supabase.from("organization_product_entitlements").select("organization_id,organization:organizations(id,name)").eq("product_key", "project_cards").in("status", ["trialing", "active", "past_due"]),
    supabase.from("project_card_projects").select("organization_id"),
    supabase.from("project_card_devices").select("organization_id,project_id").neq("status", "retired"),
  ]);
  if (entitlementError) throw entitlementError;
  if (projectError) throw projectError;
  if (cardError) throw cardError;
  const access = (entitlements || []) as EntitlementRow[];
  const projectRows = (projects || []) as ProjectRow[];
  const cardRows = (cards || []) as CardRow[];
  const target = one<HTMLElement>("#pca-organizations");
  if (target) target.innerHTML = access.length ? `<div class="pca-org-table">${access.map((row) => { const org = organization(row); const projectCount = projectRows.filter((project) => project.organization_id === row.organization_id).length; const orgCards = cardRows.filter((card) => card.organization_id === row.organization_id); return `<div class="pca-org-row"><strong>${escape(org?.name || "Organization")}</strong><span>${projectCount} project${projectCount === 1 ? "" : "s"}</span><span>${orgCards.length} card${orgCards.length === 1 ? "" : "s"}</span><span>${orgCards.filter((card) => card.project_id).length} assigned</span></div>`; }).join("")}</div>` : "";
  const values: Record<string, number> = { "#pca-org-total": access.length, "#pca-project-total": projectRows.length, "#pca-card-total": cardRows.length, "#pca-assigned-total": cardRows.filter((card) => card.project_id).length };
  Object.entries(values).forEach(([selector, value]) => { const node = one<HTMLElement>(selector); if (node) node.textContent = String(value); });
  const empty = one<HTMLElement>("#pca-empty"); if (empty) empty.hidden = access.length !== 0;
  one<HTMLElement>("#pca-status")!.hidden = true;
  one<HTMLElement>("#pca-app")!.hidden = false;
  document.body.classList.remove("portal-loading");
}

void start().catch((error: unknown) => { const status = one<HTMLElement>("#pca-status"); if (status) status.textContent = error instanceof Error ? error.message : "Unable to open Project Cards administration."; document.body.classList.remove("portal-loading"); });
