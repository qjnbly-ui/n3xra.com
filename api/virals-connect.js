const {
  getBearerToken,
  getExistingViralsAccount,
  hasViralsBusinessConfig,
  updateCreatorConnectAccount,
  verifySupabaseUser,
} = require("./_virals-supabase");
const { createViralsConnectAccount, createViralsConnectOnboardingLink, getOrigin } = require("./_virals-billing");
const { sendJson } = require("./_virals-http");

async function ensureConnectAccount(user, creator) {
  if (creator.stripeConnectAccountId) return creator.stripeConnectAccountId;
  const accountId = await createViralsConnectAccount({
    id: creator.id,
    email: user.email || creator.email,
    userId: user.id,
  });
  await updateCreatorConnectAccount(creator.id, accountId, false);
  return accountId;
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
    const account = await getExistingViralsAccount(user);
    if (!account) return sendJson(res, 409, { error: "Virals enrollment is required.", code: "not_enrolled" });
    const creator = account.creator;
    if (!creator || creator.status !== "approved") return sendJson(res, 403, { error: "Creator approval is required before payout onboarding." });
    const connectAccountId = await ensureConnectAccount(user, creator);
    const origin = getOrigin(req);
    const link = await createViralsConnectOnboardingLink({ accountId: connectAccountId, origin });
    return sendJson(res, 200, { url: link.url });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to start Stripe Connect onboarding." });
  }
};
