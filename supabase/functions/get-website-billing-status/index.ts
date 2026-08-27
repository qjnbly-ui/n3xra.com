import { originFor, requireUser, response, stripeClient } from "../_shared/website-billing.ts";

async function addLivePaymentMethods(rows: Array<Record<string, any>>) {
  if (!rows.length) return rows;
  let stripe: ReturnType<typeof stripeClient>;
  try {
    stripe = stripeClient();
  } catch (error) {
    console.warn("Unable to initialize Stripe while refreshing payment methods:", error instanceof Error ? error.message : error);
    return rows;
  }
  return Promise.all(rows.map(async (row) => {
    const subscriptionId = String(row.stripe_subscription_id || "").trim();
    if (!subscriptionId) return row;
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
      const defaultMethod = subscription.default_payment_method;
      let method = typeof defaultMethod === "object"
        && defaultMethod
        && !("deleted" in defaultMethod)
        ? defaultMethod
        : null;
      if (!method && typeof defaultMethod === "string") {
        const retrievedMethod = await stripe.paymentMethods.retrieve(defaultMethod);
        method = "deleted" in retrievedMethod ? null : retrievedMethod;
      }
      if (!method?.card) return row;
      return {
        ...row,
        subscription_payment_method_brand: method.card.brand || null,
        subscription_payment_method_last4: method.card.last4 || null,
        subscription_payment_method_exp_month: method.card.exp_month || null,
        subscription_payment_method_exp_year: method.card.exp_year || null,
      };
    } catch (error) {
      console.warn("Unable to refresh a website subscription payment method:", error instanceof Error ? error.message : error);
      return row;
    }
  }));
}

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, user, authUser } = await requireUser(request);
    const input = await request.json().catch(() => ({}));
    const projectId = String(input.project_id || "").trim();
    const websiteId = String(input.website_id || "").trim();
    const { data: isAdmin } = await user.rpc("is_platform_admin");
    let projectQuery = admin.from("website_projects").select("id,client_user_id,managed_website_id,name,status,current_stage").order("created_at", { ascending: false });
    if (projectId) projectQuery = projectQuery.eq("id", projectId);
    else if (websiteId) projectQuery = projectQuery.eq("managed_website_id", websiteId);
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
    const liveSubscriptions = await addLivePaymentMethods(subscriptions.data || []);
    return response({
      projects,
      snapshots: snapshots.data,
      subscriptions: liveSubscriptions,
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
