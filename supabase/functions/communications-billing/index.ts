import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { originFor, requireUser, response, stripeClient, type SupabaseClient } from "../_shared/website-billing.ts";

const PRODUCT_KEY = "communications";
const APP_KEY = "n3xra_communications";

type BillingAction = "status" | "checkout" | "portal";

type CommunicationsPlan = {
  plan_key: string;
  name: string;
  description: string;
  monthly_price_cents: number;
  included_sms_segments: number;
  included_email_deliveries: number;
  sms_overage_cents: number;
  mms_unit_cents: number;
  email_overage_per_1000_cents: number;
  stripe_price_id: string;
  status: string;
  audience: string;
  sort_order: number;
};

function effectiveProduct(product: Record<string, any>, override?: Record<string, any> | null): Record<string, any> {
  if (!override) return product;
  return {
    ...product,
    setup_fee_cents: override.setup_fee_cents ?? product.setup_fee_cents,
    monthly_price_cents: override.monthly_price_cents ?? product.monthly_price_cents,
    stripe_monthly_price_id: override.stripe_monthly_price_id || product.stripe_monthly_price_id,
    stripe_setup_price_id: override.stripe_setup_price_id || product.stripe_setup_price_id,
    organization_price_override: true,
  };
}

function metadata(values: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries({ app: APP_KEY, product_key: PRODUCT_KEY, ...values })
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([key, value]) => [key, String(value)]),
  );
}

function unixDate(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function accessibleOrganizations(
  admin: SupabaseClient,
  user: SupabaseClient,
  authUserId: string,
  requestedOrganizationId: string,
) {
  const { data: isAdmin } = await user.rpc("is_platform_admin");
  const [membershipResult, ownedResult] = await Promise.all([
    admin.from("organization_memberships").select("organization_id,role").eq("user_id", authUserId),
    admin.from("organizations").select("id").eq("owner_user_id", authUserId),
  ]);
  if (membershipResult.error) throw new Error(membershipResult.error.message);
  if (ownedResult.error) throw new Error(ownedResult.error.message);

  const roles = new Map<string, string>();
  for (const row of membershipResult.data || []) roles.set(row.organization_id, row.role);
  for (const row of ownedResult.data || []) roles.set(row.id, "owner");
  if (requestedOrganizationId) {
    if (isAdmin !== true && !roles.has(requestedOrganizationId)) throw new Error("You cannot manage billing for this organization.");
    return { ids: [requestedOrganizationId], roles, isAdmin: isAdmin === true };
  }
  return { ids: [...roles.keys()], roles, isAdmin: isAdmin === true };
}

async function customerForOrganization(
  admin: SupabaseClient,
  stripe: Stripe,
  organization: Record<string, unknown>,
) {
  let customerId = String(organization.stripe_customer_id || "").trim();
  const ownerUserId = String(organization.owner_user_id || "");
  if (!customerId) {
    const { data: websiteCustomer, error } = await admin
      .from("website_billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", ownerUserId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    customerId = String(websiteCustomer?.stripe_customer_id || "").trim();
  }
  if (!customerId) {
    const { data: ownerResult } = await admin.auth.admin.getUserById(ownerUserId);
    const owner = ownerResult?.user;
    const customer = await stripe.customers.create({
      email: owner?.email,
      name: String(owner?.user_metadata?.full_name || organization.name || "").trim() || undefined,
      metadata: metadata({ organization_id: String(organization.id), n3xra_user_id: ownerUserId }),
    }, { idempotencyKey: `communications-customer-${String(organization.id)}` });
    customerId = customer.id;
  }
  const organizationUpdate = await admin.from("organizations").update({ stripe_customer_id: customerId }).eq("id", organization.id);
  if (organizationUpdate.error) throw new Error(organizationUpdate.error.message);
  const customerUpdate = await admin.from("website_billing_customers").upsert({
    user_id: ownerUserId,
    stripe_customer_id: customerId,
  }, { onConflict: "user_id" });
  if (customerUpdate.error) throw new Error(customerUpdate.error.message);
  return customerId;
}

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  try {
    const { admin, user, authUser } = await requireUser(request);
    const input = await request.json().catch(() => ({}));
    const action = String(input.action || "status") as BillingAction;
    const organizationId = String(input.organization_id || "").trim();
    const requestedPlanKey = String(input.plan_key || "basic").trim().toLowerCase();
    if (!["status", "checkout", "portal"].includes(action)) return response({ error: "Unsupported billing action." }, 400, origin);

    const access = await accessibleOrganizations(admin, user, authUser.id, organizationId);
    if (!access.ids.length) return response({ products: [] }, 200, origin);
    const { data: catalogProduct, error: productError } = await admin
      .from("n3xra_product_catalog")
      .select("product_key,name,description,status,setup_fee_cents,monthly_price_cents,stripe_product_id,stripe_monthly_price_id,stripe_setup_price_id")
      .eq("product_key", PRODUCT_KEY)
      .eq("status", "active")
      .single();
    if (productError || !catalogProduct) throw new Error("Communications billing is not configured.");

    const { data: planRows, error: plansError } = await admin
      .from("communications_plan_catalog")
      .select("plan_key,name,description,monthly_price_cents,included_sms_segments,included_email_deliveries,sms_overage_cents,mms_unit_cents,email_overage_per_1000_cents,stripe_price_id,status,audience,sort_order")
      .in("status", ["active", "grandfathered"])
      .in("audience", ["organization", "all"])
      .order("sort_order");
    if (plansError) throw new Error(plansError.message);
    const plans = (planRows || []) as CommunicationsPlan[];
    const activePlans = plans.filter((plan) => plan.status === "active");
    const defaultPlan = activePlans.find((plan) => plan.plan_key === "basic") || activePlans[0];
    if (!defaultPlan) throw new Error("Communications plans are not configured.");

    if (action === "status") {
      const [organizationsResult, subscriptionsResult, entitlementsResult, workspacesResult, overridesResult, onboardingResult] = await Promise.all([
        admin.from("organizations").select("id,name,owner_user_id,stripe_customer_id").in("id", access.ids).order("name"),
        admin.from("organization_product_subscriptions").select("*").in("organization_id", access.ids).eq("product_key", PRODUCT_KEY),
        admin.from("organization_product_entitlements").select("organization_id,status,source,portal_enabled").in("organization_id", access.ids).eq("product_key", PRODUCT_KEY),
        admin.from("communications_workspaces").select("organization_id,id,status,program_name,plan_key,included_sms_segments,included_email_deliveries,sms_overage_cents,mms_unit_cents,email_overage_per_1000_cents").in("organization_id", access.ids),
        admin.from("organization_product_price_overrides").select("organization_id,setup_fee_cents,monthly_price_cents,stripe_monthly_price_id,stripe_setup_price_id").in("organization_id", access.ids).eq("product_key", PRODUCT_KEY),
        admin.from("communications_carrier_onboarding").select("organization_id,workspace_id,status,submitted_at,updated_at").in("organization_id", access.ids),
      ]);
      const queryError = organizationsResult.error || subscriptionsResult.error || entitlementsResult.error || workspacesResult.error || overridesResult.error || onboardingResult.error;
      if (queryError) throw new Error(queryError.message);
      return response({
        products: (organizationsResult.data || []).map((organization) => ({
          organization,
          product: {
            ...effectiveProduct(catalogProduct, (overridesResult.data || []).find((row) => row.organization_id === organization.id)),
            monthly_price_cents: defaultPlan.monthly_price_cents,
          },
          plans: activePlans,
          subscription: (subscriptionsResult.data || []).find((row) => row.organization_id === organization.id) || null,
          entitlement: (entitlementsResult.data || []).find((row) => row.organization_id === organization.id) || null,
          workspace: (workspacesResult.data || []).find((row) => row.organization_id === organization.id) || null,
          onboarding: (onboardingResult.data || []).find((row) => row.organization_id === organization.id) || null,
          can_manage: access.isAdmin || organization.owner_user_id === authUser.id || access.roles.get(organization.id) === "account_admin",
          customer_ready: Boolean(organization.stripe_customer_id),
        })),
      }, 200, origin);
    }

    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("id,name,owner_user_id,stripe_customer_id")
      .eq("id", organizationId)
      .single();
    if (organizationError || !organization) return response({ error: "Organization billing was not found." }, 404, origin);
    const canManage = access.isAdmin || organization.owner_user_id === authUser.id || access.roles.get(organization.id) === "account_admin";
    if (!canManage) return response({ error: "Account administrator access is required to change billing." }, 403, origin);

    const { data: override, error: overrideError } = await admin
      .from("organization_product_price_overrides")
      .select("setup_fee_cents,monthly_price_cents,stripe_monthly_price_id,stripe_setup_price_id")
      .eq("organization_id", organization.id)
      .eq("product_key", PRODUCT_KEY)
      .maybeSingle();
    if (overrideError) throw new Error(overrideError.message);
    const product = effectiveProduct(catalogProduct, override);
    const selectedPlan = activePlans.find((plan) => plan.plan_key === requestedPlanKey);
    if (!selectedPlan) return response({ error: "Select an available Communications plan." }, 400, origin);

    const stripe = stripeClient();
    const customerId = await customerForOrganization(admin, stripe, organization);
    if (action === "portal") {
      const configuration = Deno.env.get("STRIPE_WEBSITE_PORTAL_CONFIGURATION");
      if (!configuration) throw new Error("Stripe billing management is not configured.");
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration,
        return_url: `${origin}/client-portal/billing/?product=${PRODUCT_KEY}`,
      });
      return response({ url: session.url }, 200, origin);
    }

    const { data: existing, error: existingError } = await admin
      .from("organization_product_subscriptions")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("product_key", PRODUCT_KEY)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (["active", "trialing", "past_due", "unpaid", "paused"].includes(String(existing?.status || ""))) {
      return response({ error: "Communications billing is already active. Open billing management to review it." }, 409, origin);
    }
    if (existing?.plan_key === selectedPlan.plan_key && existing.checkout_url && existing.checkout_expires_at && new Date(existing.checkout_expires_at) > new Date()) {
      return response({ url: existing.checkout_url, reused: true }, 200, origin);
    }
    if (!selectedPlan.stripe_price_id || !product.stripe_setup_price_id) throw new Error("Communications Stripe prices are missing.");

    const checkoutMetadata = metadata({
      organization_id: organization.id,
      n3xra_user_id: organization.owner_user_id,
      plan_key: selectedPlan.plan_key,
    });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: organization.id,
      line_items: [
        { price: selectedPlan.stripe_price_id, quantity: 1 },
        { price: product.stripe_setup_price_id, quantity: 1 },
      ],
      allow_promotion_codes: false,
      billing_address_collection: "auto",
      payment_method_collection: "always",
      success_url: `${origin}/client-portal/communications/onboarding/?billing=success`,
      cancel_url: `${origin}/client-portal/billing/?billing=canceled&product=${PRODUCT_KEY}`,
      metadata: checkoutMetadata,
      subscription_data: { metadata: checkoutMetadata },
    }, { idempotencyKey: `communications-checkout-${organization.id}-${selectedPlan.plan_key}-${Math.floor(Date.now() / 60000)}` });

    const checkoutExpiresAt = unixDate(session.expires_at);
    const stored = await admin.from("organization_product_subscriptions").upsert({
      organization_id: organization.id,
      product_key: PRODUCT_KEY,
      plan_key: selectedPlan.plan_key,
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      checkout_url: session.url,
      checkout_expires_at: checkoutExpiresAt,
      status: "checkout_pending",
      currency: "usd",
      setup_fee_cents: product.setup_fee_cents,
      monthly_price_cents: selectedPlan.monthly_price_cents,
    }, { onConflict: "organization_id,product_key" });
    if (stored.error) throw new Error(stored.error.message);
    return response({ url: session.url }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to manage Communications billing.";
    console.error("communications-billing failed:", message);
    return response({ error: message }, 400, origin);
  }
});
