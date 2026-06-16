const {
  getBearerToken,
  hasViralsBusinessConfig,
  listEligibleCommissions,
  loadCreatorApplicationById,
  markCommissionsPaid,
  verifySupabaseUser,
  isViralsAdmin,
} = require("./_virals-supabase");
const { stripeRequest } = require("./_virals-billing");
const { parseJson, sendJson } = require("./_virals-http");

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
    if (!(await isViralsAdmin(user))) return sendJson(res, 403, { error: "Virals admin access required." });

    const payload = await parseJson(req);
    const application = await loadCreatorApplicationById(String(payload.applicationId || ""));
    if (!application || application.status !== "approved") return sendJson(res, 404, { error: "Approved creator not found." });
    if (!application.stripe_connect_account_id) return sendJson(res, 400, { error: "Creator has not connected Stripe payouts." });

    const rows = await listEligibleCommissions(application.id);
    const amount = rows.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0);
    if (amount <= 0) return sendJson(res, 400, { error: "No eligible commissions to pay." });

    const transfer = await stripeRequest("/transfers", {
      method: "POST",
      idempotencyKey: `virals-payout-${application.id}-${rows.map((row) => row.id).join("-")}`,
      body: {
        amount,
        currency: rows[0]?.currency || "usd",
        destination: application.stripe_connect_account_id,
        metadata: {
          app: "n3xra_virals",
          creator_application_id: application.id,
          commission_count: rows.length,
        },
      },
    });

    await markCommissionsPaid(rows.map((row) => row.id), transfer.id);
    return sendJson(res, 200, { transferId: transfer.id, amount, count: rows.length });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error instanceof Error ? error.message : "Unable to send creator payout." });
  }
};
