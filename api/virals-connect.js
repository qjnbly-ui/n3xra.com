const {
  getBearerToken,
  getViralsAccount,
  hasViralsBusinessConfig,
  updateCreatorConnectAccount,
  verifySupabaseUser,
} = require("./_virals-supabase");
const { getOrigin, stripeRequest } = require("./_virals-billing");
const { sendJson } = require("./_virals-http");

async function ensureConnectAccount(user, creator) {
  if (creator.stripeConnectAccountId) return creator.stripeConnectAccountId;
  const account = await stripeRequest("/accounts", {
    method: "POST",
    idempotencyKey: `virals-connect-${creator.id}`,
    body: {
      type: "express",
      country: "US",
      email: user.email || creator.email || undefined,
      business_type: "individual",
      capabilities: {
        transfers: {
          requested: true,
        },
      },
      metadata: {
        app: "n3xra_virals",
        creator_application_id: creator.id,
        user_id: user.id,
      },
    },
  });
  await updateCreatorConnectAccount(creator.id, account.id, false);
  return account.id;
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
    const account = await getViralsAccount(user);
    const creator = account.creator;
    if (!creator || creator.status !== "approved") return sendJson(res, 403, { error: "Creator approval is required before payout onboarding." });
    const connectAccountId = await ensureConnectAccount(user, creator);
    const origin = getOrigin(req);
    const link = await stripeRequest("/account_links", {
      method: "POST",
      body: {
        account: connectAccountId,
        refresh_url: `${origin}/virals/?connect=refresh`,
        return_url: `${origin}/virals/?connect=return`,
        type: "account_onboarding",
      },
    });
    return sendJson(res, 200, { url: link.url });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to start Stripe Connect onboarding." });
  }
};
