import { originFor, requireUser, response, stripeClient } from "../_shared/website-billing.ts";

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, authUser } = await requireUser(request);
    const { project_id } = await request.json();
    const { data: project } = await admin.from("website_projects").select("client_user_id").eq("id", project_id).eq("client_user_id", authUser.id).maybeSingle();
    if (!project) return response({ error: "Website billing was not found." }, 404, origin);
    const { data: customer } = await admin.from("website_billing_customers").select("stripe_customer_id").eq("user_id", authUser.id).single();
    if (!customer?.stripe_customer_id) return response({ error: "Stripe customer is missing." }, 409, origin);
    const configuration = Deno.env.get("STRIPE_WEBSITE_PORTAL_CONFIGURATION");
    if (!configuration) throw new Error("Website Customer Portal is not configured.");
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      configuration,
      return_url: `${origin}/client-portal/billing/?project=${project_id}`,
    });
    return response({ url: session.url }, 200, origin);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to open billing management." }, 400, origin);
  }
});
