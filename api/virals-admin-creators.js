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
const { buildCreatorDecisionEmail, sendCreatorDecisionEmail } = require("./_virals-email");
const { fetchTikTokProfile } = require("./_virals-tiktok");

function withStage(error, stage) {
  if (error && typeof error === "object" && !error.stage) error.stage = stage;
  return error;
}

async function createStripePromoForApplication(application, programId) {
  const code = normalizePromoCode(application.normalized_code || application.requested_code);
  let coupon = application.stripe_coupon_id ? { id: application.stripe_coupon_id } : null;
  if (!coupon) {
    try {
      coupon = await stripeRequest("/coupons", {
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
    } catch (error) {
      throw withStage(error, "stripe_coupon");
    }
  }

  let promotionCode = application.stripe_promotion_code_id
    ? { id: application.stripe_promotion_code_id }
    : null;

  if (!promotionCode) {
    try {
      promotionCode = await stripeRequest("/promotion_codes", {
        method: "POST",
        idempotencyKey: `virals-promo-${application.id}`,
        body: {
          promotion: {
            type: "coupon",
            coupon: coupon.id,
          },
          code,
          active: true,
          metadata: {
            app: "n3xra_virals",
            creator_application_id: application.id,
            program: programId,
          },
        },
      });
    } catch (error) {
      const existing = await findExistingPromotionCodeForApplication(code, application.id).catch((lookupError) => {
        throw withStage(lookupError, "stripe_promotion_code_lookup");
      });
      if (!existing) throw withStage(error, "stripe_promotion_code");
      promotionCode = existing;
    }
  }

  return { couponId: coupon.id, promotionCodeId: promotionCode.id };
}

async function findExistingPromotionCodeForApplication(code, applicationId) {
  const response = await stripeRequest(`/promotion_codes?code=${encodeURIComponent(code)}&limit=20`);
  const matches = Array.isArray(response?.data) ? response.data : [];
  return matches.find((promotionCode) => {
    const metadata = promotionCode?.metadata || {};
    return promotionCode.active !== false
      && normalizePromoCode(promotionCode.code) === code
      && metadata.app === "n3xra_virals"
      && metadata.creator_application_id === applicationId;
  }) || null;
}

async function createConnectAccount(application) {
  const existingAccountId = application.stripe_connect_account_id || application.stripeConnectAccountId;
  if (existingAccountId) return existingAccountId;
  return createViralsConnectAccount({
    id: application.id,
    email: application.email,
    userId: application.user_id || application.userId,
  });
}

async function backfillCreatorProfiles(applications = []) {
  const enriched = [];
  for (const application of applications) {
    if (application?.aiEvaluation?.profile || !application?.tiktokUsername) {
      enriched.push(application);
      continue;
    }
    try {
      const profile = await fetchTikTokProfile(application.tiktokUsername);
      const aiEvaluation = {
        ...(application.aiEvaluation || {}),
        profile,
        summary:
          application.aiEvaluation?.summary ||
          `TikTok profile loaded for @${profile.handle}: ${Number(profile.followerCount || 0).toLocaleString()} followers, ${Number(profile.likeCount || 0).toLocaleString()} likes, ${Number(profile.videoCount || 0).toLocaleString()} videos. Review content fit manually.`,
        fit: application.aiEvaluation?.fit || "profile_loaded_manual_review",
      };
      enriched.push(await updateCreatorApplication(application.id, { ai_evaluation: aiEvaluation }));
    } catch (error) {
      console.warn("Virals creator profile backfill failed.", {
        stage: error?.stage || "tiktok_profile_backfill",
        applicationId: application?.id,
        message: error?.message || String(error),
      });
      enriched.push(application);
    }
  }
  return enriched;
}

async function sendDecisionEmailWithWarning(application, action, programId) {
  try {
    return { email: await sendCreatorDecisionEmail(application, action, programId) };
  } catch (error) {
    return { emailWarning: error instanceof Error ? error.message : "Creator decision email failed to send." };
  }
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
    const user = await verifySupabaseUser(token).catch((error) => {
      throw withStage(error, "supabase_verify_user");
    });
    const admin = await isViralsAdmin(user).catch((error) => {
      throw withStage(error, "supabase_admin_check");
    });
    if (!admin) return sendJson(res, 403, { error: "Virals admin access required.", stage: "admin_access" });

    if (req.method === "GET") {
      const status = String(new URL(req.url, "http://localhost").searchParams.get("status") || "");
      const applications = await listCreatorApplications(user, status).catch((error) => {
        throw withStage(error, "supabase_list_applications");
      });
      return sendJson(res, 200, { applications: await backfillCreatorProfiles(applications) });
    }

    const payload = await parseJson(req);
    const action = String(payload.action || "").trim().toLowerCase();
    const application = await loadCreatorApplicationById(String(payload.id || "")).catch((error) => {
      throw withStage(error, "supabase_load_application");
    });
    if (!application) return sendJson(res, 404, { error: "Creator application not found.", stage: "supabase_load_application" });
    const programId = String(payload.program || application.requested_program || "standard").trim().toLowerCase() === "founding" ? "founding" : "standard";

    if (action === "preview") {
      const decision = String(payload.decision || "").trim().toLowerCase() === "reject" ? "reject" : "approve";
      return sendJson(res, 200, { email: buildCreatorDecisionEmail(application, decision, programId) });
    }

    if (action === "reject") {
      const updated = await updateCreatorApplication(application.id, {
        status: "rejected",
        rejected_at: new Date().toISOString(),
        admin_notes: String(payload.adminNotes || "").trim().slice(0, 4000) || null,
      }).catch((error) => {
        throw withStage(error, "supabase_reject_update");
      });
      const emailResult = await sendDecisionEmailWithWarning(updated, "reject", programId);
      return sendJson(res, 200, { application: updated, ...emailResult });
    }

    if (action !== "approve") return sendJson(res, 400, { error: "action must be approve or reject." });

    if (programId === "founding" && application.status !== "approved") {
      const foundingCount = await countApprovedFoundingCreators().catch((error) => {
        throw withStage(error, "supabase_founding_count");
      });
      if (foundingCount >= CREATOR_PROGRAMS.founding.maxApproved) {
        return sendJson(res, 409, { error: "The Founding Creator Program already has 25 approved creators." });
      }
    }
    const program = CREATOR_PROGRAMS[programId] || CREATOR_PROGRAMS.standard;
    const promo = await createStripePromoForApplication(application, programId);
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
    }).catch((error) => {
      throw withStage(error, "supabase_approval_update");
    });
    let finalApplication = updated;
    let connectWarning = "";
    try {
      const connectAccountId = await createConnectAccount(updated);
      finalApplication = await updateCreatorApplication(application.id, {
        stripe_connect_account_id: connectAccountId,
      });
    } catch (error) {
      connectWarning = error instanceof Error ? error.message : "Stripe payout account setup failed.";
    }
    const emailResult = await sendDecisionEmailWithWarning(finalApplication, "approve", programId);
    return sendJson(res, 200, { application: finalApplication, connectWarning, ...emailResult });
  } catch (error) {
    console.error("Virals admin creator action failed.", {
      stage: error?.stage || "unknown",
      status: error?.status || 500,
      message: error instanceof Error ? error.message : String(error),
      data: error?.data || null,
    });
    return sendJson(res, error.status || 500, {
      error: error instanceof Error ? error.message : "Unable to manage creator applications.",
      stage: error?.stage || "unknown",
    });
  }
};
