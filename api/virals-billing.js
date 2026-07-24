const {
  attachViralsStripeCustomer,
  ensureViralsProfileAndPeriod,
  findApplicationByPromoCode,
  getBearerToken,
  hasViralsBusinessConfig,
  loadViralsProfile,
  verifySupabaseUser,
} = require("./_virals-supabase");
const { getOrigin, requirePaidPlan, stripeRequest } = require("./_virals-billing");
const { parseJson, sendJson } = require("./_virals-http");

async function getOrCreateCustomer(user, profile) {
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;
  const customer = await stripeRequest("/customers", {
    method: "POST",
    idempotencyKey: `virals-customer-${user.id}`,
    body: {
      email: user.email || undefined,
      name: profile?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email || undefined,
      metadata: {
        app: "n3xra_virals",
        user_id: user.id,
      },
    },
  });
  await attachViralsStripeCustomer(user.id, customer.id);
  return customer.id;
}

async function getReferralDiscountPayload(code) {
  const application = await findApplicationByPromoCode(code);
  if (!application?.stripe_promotion_code_id) return null;
  return {
    discounts: [{ promotion_code: application.stripe_promotion_code_id }],
    referralCode: application.normalized_code || "",
    referralPromotionCodeId: application.stripe_promotion_code_id,
    referralApplicationId: application.id,
  };
}

function getViralsPortalConfiguration() {
  const configuration = process.env.STRIPE_VIRALS_PORTAL_CONFIGURATION;
  if (!configuration) {
    throw new Error("Missing STRIPE_VIRALS_PORTAL_CONFIGURATION.");
  }
  return configuration;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (!hasViralsBusinessConfig()) return sendJson(res, 503, { error: "Main Supabase billing is not configured." });

  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Authentication required." });
    const user = await verifySupabaseUser(token);
    const payload = await parseJson(req);
    const action = String(payload.action || "").trim();
    const origin = getOrigin(req);
    await ensureViralsProfileAndPeriod(user);
    const profile = await loadViralsProfile(user.id);
    const customerId = await getOrCreateCustomer(user, profile);

    if (action === "create-checkout-session") {
      const plan = requirePaidPlan(payload.planId);
      const priceId = process.env[plan.priceEnv];
      if (!priceId) throw new Error(`Missing ${plan.priceEnv}.`);
      const referral = await getReferralDiscountPayload(payload.promoCode);
      const checkoutBody = {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: user.id,
        success_url: `${origin}/virals/?billing=success`,
        cancel_url: `${origin}/virals/?billing=canceled`,
        metadata: {
          app: "n3xra_virals",
          user_id: user.id,
          plan_id: plan.id,
          referral_code: referral?.referralCode || undefined,
          creator_application_id: referral?.referralApplicationId || undefined,
        },
        subscription_data: {
          metadata: {
            app: "n3xra_virals",
            user_id: user.id,
            plan_id: plan.id,
            referral_code: referral?.referralCode || undefined,
            creator_application_id: referral?.referralApplicationId || undefined,
          },
        },
      };
      if (referral?.discounts) {
        checkoutBody.discounts = referral.discounts;
      } else {
        checkoutBody.allow_promotion_codes = true;
      }
      const session = await stripeRequest("/checkout/sessions", {
        method: "POST",
        body: checkoutBody,
      });
      return sendJson(res, 200, { url: session.url });
    }

    if (action === "create-portal-session") {
      const session = await stripeRequest("/billing_portal/sessions", {
        method: "POST",
        body: {
          customer: customerId,
          configuration: getViralsPortalConfiguration(),
          return_url: `${origin}/virals/?billing=portal`,
        },
      });
      return sendJson(res, 200, { url: session.url });
    }

    return sendJson(res, 400, { error: "Unsupported billing action." });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to start Virals billing." });
  }
};
