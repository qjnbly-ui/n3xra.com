import { originFor, requireUser, response } from "../_shared/website-billing.ts";

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, user, authUser } = await requireUser(request);
    const input = await request.json().catch(() => ({}));
    const projectId = String(input.project_id || "").trim();
    const { data: isAdmin } = await user.rpc("is_platform_admin");
    let projectQuery = admin.from("website_projects").select("id,client_user_id,managed_website_id,name,status,current_stage").order("created_at", { ascending: false });
    if (projectId) projectQuery = projectQuery.eq("id", projectId);
    if (isAdmin !== true) projectQuery = projectQuery.eq("client_user_id", authUser.id);
    const { data: projects, error } = await projectQuery;
    if (error) throw new Error(error.message);
    const ids = (projects || []).map((project) => project.id);
    if (!ids.length) return response({ projects: [], snapshots: [], subscriptions: [], invoices: [], customers: [], schedules: [], charges: [], communications: [] }, 200, origin);
    const clientIds = [...new Set((projects || []).map((project) => project.client_user_id))];
    const customerFields = isAdmin === true
      ? "user_id,stripe_customer_id,payment_method_status,payment_method_brand,payment_method_last4,payment_method_exp_month,payment_method_exp_year"
      : "user_id,payment_method_status,payment_method_brand,payment_method_last4,payment_method_exp_month,payment_method_exp_year";
    const [snapshots, subscriptions, invoices, customers, schedules, charges, communications] = await Promise.all([
      admin.from("website_billing_snapshots").select("*,website_billing_snapshot_items(*)").in("project_id", ids).order("created_at", { ascending: false }),
      admin.from("website_subscriptions").select("*,website_billing_customers(payment_method_status,payment_method_brand,payment_method_last4,payment_method_exp_month,payment_method_exp_year)").in("project_id", ids),
      admin.from("website_invoices").select("*,website_invoice_items(*)").in("project_id", ids).order("created_at", { ascending: false }).limit(25),
      admin.from("website_billing_customers").select(customerFields).in("user_id", clientIds),
      admin.from("website_billing_schedules").select("*").in("project_id", ids),
      admin.from("website_billing_charges").select("*").in("project_id", ids).order("created_at", { ascending: false }),
      admin.from("website_billing_communications").select("*").in("project_id", ids).order("created_at", { ascending: false }).limit(50),
    ]);
    const queryError = snapshots.error || subscriptions.error || invoices.error || customers.error || schedules.error || charges.error || communications.error;
    if (queryError) throw new Error(queryError.message);
    return response({
      projects,
      snapshots: snapshots.data,
      subscriptions: subscriptions.data,
      invoices: invoices.data,
      customers: customers.data,
      schedules: schedules.data,
      charges: charges.data,
      communications: isAdmin === true ? communications.data : [],
    }, 200, origin);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to load website billing." }, 400, origin);
  }
});
