const {
  countApprovedFoundingCreators,
  getBearerToken,
  hasViralsBusinessConfig,
  isViralsAdmin,
  listCreatorApplications,
  loadCreatorApplicationById,
  updateCreatorApplication,
  verifySupabaseUser,
} = require("./_virals-supabase");
const {
  CREATOR_PROGRAMS,
  CUSTOMER_PROMO_DISCOUNT_MONTHS,
  CUSTOMER_PROMO_DISCOUNT_PERCENT,
  createViralsConnectAccount,
  normalizePromoCode,
  stripeRequest,
} = require("./_virals-billing");
const { parseJson, sendJson } = require("./_virals-http");

async function createStripePromoForApplication(application, programId) {
  const code = normalizePromoCode(application.normalized_code || application.requested_code);
  const coupon = application.stripe_coupon_id
    ? { id: application.stripe_coupon_id }
    : await stripeRequest("/coupons", {
        method: "POST",
        idempotencyKey: `virals-coupon-${application.id}`,
        body: {
          percent_off: CUSTOMER_PROMO_DISCOUNT_PERCENT,
          duration: "repeating",
          duration_in_months: CUSTOMER_PROMO_DISCOUNT_MONTHS,
          name: `N3XRA Virals ${code}`,
          metadata: {
            app: "n3xra_virals",
            creator_application_id: application.id,
            program: programId,
          },
        },
      });

  const promotionCode = application.stripe_promotion_code_id
    ? { id: application.stripe_promotion_code_id }
    : await stripeRequest("/promotion_codes", {
        method: "POST",
        idempotencyKey: `virals-promo-${application.id}`,
        body: {
          coupon: coupon.id,
          code,
          active: true,
          metadata: {
            app: "n3xra_virals",
            creator_application_id: application.id,
            program: programId,
          },
        },
      });

  return { couponId: coupon.id, promotionCodeId: promotionCode.id };
}

async function createConnectAccount(application) {
  if (application.stripe_connect_account_id) return application.stripe_connect_account_id;
  return createViralsConnectAccount({
    id: application.id,
    email: application.email,
    userId: application.user_id,
  });
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (!hasViralsBusinessConfig()) return sendJson(res, 503, { error: "Main Supabase billing is not configured." });

  try {
    const token = getBearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Authentication required." });
    const user = await verifySupabaseUser(token);
    if (!(await isViralsAdmin(user))) return sendJson(res, 403, { error: "Virals admin access required." });

    if (req.method === "GET") {
      const status = String(new URL(req.url, "http://localhost").searchParams.get("status") || "");
      const applications = await listCreatorApplications(user, status);
      return sendJson(res, 200, { applications });
    }

    const payload = await parseJson(req);
    const action = String(payload.action || "").trim().toLowerCase();
    const application = await loadCreatorApplicationById(String(payload.id || ""));
    if (!application) return sendJson(res, 404, { error: "Creator application not found." });

    if (action === "reject") {
      const updated = await updateCreatorApplication(application.id, {
        status: "rejected",
        rejected_at: new Date().toISOString(),
        admin_notes: String(payload.adminNotes || "").trim().slice(0, 4000) || null,
      });
      return sendJson(res, 200, { application: updated });
    }

    if (action !== "approve") return sendJson(res, 400, { error: "action must be approve or reject." });

    const programId = String(payload.program || application.requested_program || "standard").trim().toLowerCase() === "founding" ? "founding" : "standard";
    if (programId === "founding" && application.status !== "approved") {
      const foundingCount = await countApprovedFoundingCreators();
      if (foundingCount >= CREATOR_PROGRAMS.founding.maxApproved) {
        return sendJson(res, 409, { error: "The Founding Creator Program already has 25 approved creators." });
      }
    }
    const program = CREATOR_PROGRAMS[programId] || CREATOR_PROGRAMS.standard;
    const promo = await createStripePromoForApplication(application, programId);
    const connectAccountId = await createConnectAccount(application);
    const updated = await updateCreatorApplication(application.id, {
      status: "approved",
      approved_program: programId,
      commission_rate: program.commissionRate,
      customer_discount_percent: CUSTOMER_PROMO_DISCOUNT_PERCENT,
      customer_discount_months: CUSTOMER_PROMO_DISCOUNT_MONTHS,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      rejected_at: null,
      admin_notes: String(payload.adminNotes || "").trim().slice(0, 4000) || null,
      stripe_coupon_id: promo.couponId,
      stripe_promotion_code_id: promo.promotionCodeId,
      stripe_connect_account_id: connectAccountId,
    });
    return sendJson(res, 200, { application: updated });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to manage creator applications." });
  }
};
