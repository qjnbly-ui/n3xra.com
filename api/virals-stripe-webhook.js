const {
  createCommissionLedger,
  createReferralIfMissing,
  findApplicationByPromotionCode,
  findReferralBySubscription,
  hasViralsBusinessConfig,
  loadCreatorApplicationById,
  updateReferralStatus,
  updateViralsProfileFromSubscription,
} = require("./_virals-supabase");
const { stripeRequest, verifyStripeWebhookSignature } = require("./_virals-billing");
const { readRawBody, sendJson } = require("./_virals-http");

function getUserIdFromSubscription(subscription) {
  return String(subscription?.metadata?.user_id || subscription?.client_reference_id || "").trim();
}

function isViralsObject(object) {
  return String(object?.metadata?.app || "").trim().toLowerCase() === "n3xra_virals";
}

function getPromotionCodeIdFromObject(object) {
  const discounts = Array.isArray(object?.discounts) ? object.discounts : [];
  for (const discount of discounts) {
    const promotionCode = typeof discount?.promotion_code === "string" ? discount.promotion_code : discount?.promotion_code?.id;
    if (promotionCode) return promotionCode;
  }
  const discount = object?.discount;
  const promotionCode = typeof discount?.promotion_code === "string" ? discount.promotion_code : discount?.promotion_code?.id;
  return promotionCode || "";
}

async function loadSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function loadInvoice(invoiceId) {
  if (!invoiceId) return null;
  return stripeRequest(`/invoices/${encodeURIComponent(invoiceId)}`);
}

function getInvoiceId(object) {
  return typeof object?.invoice === "string" ? object.invoice : object?.invoice?.id || "";
}

async function findApplicationForObject(object, fallbackObject = null) {
  const metadataApplicationId = String(
    object?.metadata?.creator_application_id
      || fallbackObject?.metadata?.creator_application_id
      || ""
  ).trim();
  if (metadataApplicationId) {
    const application = await loadCreatorApplicationById(metadataApplicationId).catch(() => null);
    if (application?.status === "approved") return application;
  }

  const promotionCodeId = getPromotionCodeIdFromObject(object) || getPromotionCodeIdFromObject(fallbackObject);
  if (!promotionCodeId) return null;
  return findApplicationByPromotionCode(promotionCodeId);
}

async function handleCheckoutCompleted(session) {
  if (!isViralsObject(session)) return;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const subscription = await loadSubscription(subscriptionId);
  if (!subscription) return;
  const userId = String(session.client_reference_id || subscription.metadata?.user_id || "").trim();
  if (userId) await updateViralsProfileFromSubscription(userId, subscription);

  const promotionCodeId = getPromotionCodeIdFromObject(session) || getPromotionCodeIdFromObject(subscription);
  const application = await findApplicationForObject(session, subscription);
  if (application && userId) {
    const referral = await createReferralIfMissing({
      creatorApplicationId: application.id,
      referredUserId: userId,
      subscription,
      promotionCodeId,
      normalizedCode: application.normalized_code,
      invoiceId: getInvoiceId(session) || null,
    });
    const invoice = await loadInvoice(getInvoiceId(session)).catch(() => null);
    if (invoice) await createCommissionLedger({ application, referral, invoice });
  }
}

async function handleSubscriptionUpdated(subscription) {
  if (!isViralsObject(subscription)) return;
  const userId = getUserIdFromSubscription(subscription);
  if (userId) await updateViralsProfileFromSubscription(userId, subscription);
}

async function handleSubscriptionDeleted(subscription) {
  if (!isViralsObject(subscription)) return;
  await handleSubscriptionUpdated(subscription);
  await updateReferralStatus(subscription.id, "canceled");
}

async function handleInvoicePaid(invoice) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return;
  const guardedSubscription = await loadSubscription(subscriptionId);
  if (!isViralsObject(guardedSubscription)) return;
  let referral = await findReferralBySubscription(subscriptionId);
  let application = referral ? await findApplicationByPromotionCode(referral.stripe_promotion_code_id) : null;
  if (!referral || !application) {
    const subscription = await loadSubscription(subscriptionId);
    const promotionCodeId = getPromotionCodeIdFromObject(invoice) || getPromotionCodeIdFromObject(subscription);
    application = await findApplicationForObject(invoice, subscription);
    const userId = getUserIdFromSubscription(subscription);
    if (application && userId) {
      referral = await createReferralIfMissing({
        creatorApplicationId: application.id,
        referredUserId: userId,
        subscription,
        promotionCodeId,
        normalizedCode: application.normalized_code,
        invoiceId: invoice.id,
      });
    }
  }
  if (!referral || !application) return;
  await createCommissionLedger({ application, referral, invoice });
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (!hasViralsBusinessConfig()) return sendJson(res, 503, { error: "Main Supabase billing is not configured." });

  try {
    const rawBody = await readRawBody(req);
    verifyStripeWebhookSignature(rawBody, req.headers["stripe-signature"]);
    const event = JSON.parse(rawBody);
    const object = event?.data?.object || {};

    if (event.type === "checkout.session.completed") await handleCheckoutCompleted(object);
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") await handleSubscriptionUpdated(object);
    if (event.type === "customer.subscription.deleted") await handleSubscriptionDeleted(object);
    if (event.type === "invoice.payment_succeeded") await handleInvoicePaid(object);

    return sendJson(res, 200, { received: true });
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : "Virals webhook failed." });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
