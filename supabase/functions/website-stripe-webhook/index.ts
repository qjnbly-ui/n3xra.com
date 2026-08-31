import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  WEBSITE_APP,
  mapSubscriptionStatus,
  notifyAdmin,
  originFor,
  response,
  stripeClient,
  subscriptionPeriod,
  websiteMetadata,
} from "../_shared/website-billing.ts";
import {
  operationsInvoiceStatus,
  stripeCustomerName,
  stripeInvoiceNumber,
  stripePaidDate,
  unixDateOnly,
} from "../_shared/operations-stripe.mjs";

const COMMUNICATIONS_APP = "n3xra_communications";
const COMMUNICATIONS_PRODUCT_KEY = "communications";

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase webhook configuration is missing.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function appFrom(metadata?: Stripe.Metadata | null) {
  return String(metadata?.app || "").trim().toLowerCase();
}

function subscriptionType(metadata?: Stripe.Metadata | null) {
  return metadata?.subscription_type === "domain" ? "domain" : "service";
}

function customerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  return typeof value === "string" ? value : value?.id || null;
}

function unixDate(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function syncPaymentMethod(admin: ReturnType<typeof createClient>, stripe: Stripe, stripeCustomerId: string) {
  const customer = await stripe.customers.retrieve(stripeCustomerId, { expand: ["invoice_settings.default_payment_method"] });
  if (customer.deleted || ![WEBSITE_APP, COMMUNICATIONS_APP].includes(appFrom(customer.metadata))) return false;
  const method = customer.invoice_settings.default_payment_method;
  let paymentMethod = typeof method === "object" && method && !("deleted" in method) ? method : null;
  if (!paymentMethod) {
    const methods = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 1 });
    paymentMethod = methods.data[0] || null;
  }
  await admin.from("website_billing_customers").update({
    payment_method_status: paymentMethod?.card ? "available" : "missing",
    payment_method_brand: paymentMethod?.card?.brand || null,
    payment_method_last4: paymentMethod?.card?.last4 || null,
    payment_method_exp_month: paymentMethod?.card?.exp_month || null,
    payment_method_exp_year: paymentMethod?.card?.exp_year || null,
  }).eq("stripe_customer_id", stripeCustomerId);
  return true;
}

async function syncCommunicationsSubscription(admin: ReturnType<typeof createClient>, subscription: Stripe.Subscription) {
  if (appFrom(subscription.metadata) !== COMMUNICATIONS_APP) return false;
  const organizationId = String(subscription.metadata.organization_id || "").trim();
  const productKey = String(subscription.metadata.product_key || COMMUNICATIONS_PRODUCT_KEY).trim();
  if (!organizationId || productKey !== COMMUNICATIONS_PRODUCT_KEY) return false;
  const stripeCustomerId = customerId(subscription.customer);
  if (!stripeCustomerId) return false;
  const period = subscriptionPeriod(subscription);
  const firstItem = subscription.items.data[0];
  const metadataPlanKey = String(subscription.metadata.plan_key || "").trim().toLowerCase();
  const status = mapSubscriptionStatus(subscription.status);
  const entitlementStatus = status === "unpaid" ? "past_due" : status === "incomplete" ? "paused" : status;
  const activePortal = ["active", "trialing", "past_due"].includes(entitlementStatus);
  let planQuery = admin
    .from("communications_plan_catalog")
    .select("plan_key,monthly_price_cents,included_sms_segments,included_email_deliveries,sms_overage_cents,mms_unit_cents,email_overage_per_1000_cents,stripe_price_id");
  planQuery = metadataPlanKey
    ? planQuery.eq("plan_key", metadataPlanKey)
    : planQuery.eq("stripe_price_id", firstItem?.price?.id || "");
  const [catalogResult, overrideResult, existingResult, planResult] = await Promise.all([
    admin.from("n3xra_product_catalog").select("setup_fee_cents,monthly_price_cents").eq("product_key", productKey).single(),
    admin.from("organization_product_price_overrides").select("setup_fee_cents,monthly_price_cents").eq("organization_id", organizationId).eq("product_key", productKey).maybeSingle(),
    admin.from("organization_product_subscriptions").select("setup_fee_cents,monthly_price_cents,plan_key").eq("organization_id", organizationId).eq("product_key", productKey).maybeSingle(),
    planQuery.maybeSingle(),
  ]);
  if (catalogResult.error) throw new Error(catalogResult.error.message);
  if (overrideResult.error) throw new Error(overrideResult.error.message);
  if (existingResult.error) throw new Error(existingResult.error.message);
  if (planResult.error) throw new Error(planResult.error.message);
  const catalog = catalogResult.data;
  const plan = planResult.data;
  const planKey = plan?.plan_key || metadataPlanKey || existingResult.data?.plan_key || null;
  const setupFeeCents = Number(existingResult.data?.setup_fee_cents ?? overrideResult.data?.setup_fee_cents ?? catalog.setup_fee_cents ?? 0);
  const monthlyPriceCents = Number(plan?.monthly_price_cents ?? existingResult.data?.monthly_price_cents ?? overrideResult.data?.monthly_price_cents ?? firstItem?.price?.unit_amount ?? catalog.monthly_price_cents ?? 0);
  const stored = await admin.from("organization_product_subscriptions").upsert({
    organization_id: organizationId,
    product_key: productKey,
    plan_key: planKey,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: firstItem?.price?.id || null,
    status,
    currency: firstItem?.price?.currency || "usd",
    setup_fee_cents: setupFeeCents,
    monthly_price_cents: monthlyPriceCents,
    current_period_start: unixDate(period.start),
    current_period_end: unixDate(period.end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    checkout_url: null,
    checkout_expires_at: null,
  }, { onConflict: "organization_id,product_key" });
  if (stored.error) throw new Error(stored.error.message);

  const { data: existingEntitlement } = await admin
    .from("organization_product_entitlements")
    .select("metadata,starts_at")
    .eq("organization_id", organizationId)
    .eq("product_key", productKey)
    .maybeSingle();
  const entitlement = await admin.from("organization_product_entitlements").upsert({
    organization_id: organizationId,
    product_key: productKey,
    status: entitlementStatus,
    portal_enabled: activePortal,
    source: "subscription",
    external_reference: subscription.id,
    starts_at: existingEntitlement?.starts_at || (activePortal ? new Date().toISOString() : null),
    ends_at: entitlementStatus === "canceled" ? unixDate(period.end) || new Date().toISOString() : null,
    metadata: {
      ...(existingEntitlement?.metadata || {}),
      billing_source: "stripe",
      stripe_customer_id: stripeCustomerId,
      plan_key: planKey,
    },
  }, { onConflict: "organization_id,product_key" });
  if (entitlement.error) throw new Error(entitlement.error.message);
  if (plan) {
    const workspace = await admin.from("communications_workspaces").update({
      plan_key: plan.plan_key,
      included_sms_segments: plan.included_sms_segments,
      included_email_deliveries: plan.included_email_deliveries,
      sms_overage_cents: plan.sms_overage_cents,
      mms_unit_cents: plan.mms_unit_cents,
      email_overage_per_1000_cents: plan.email_overage_per_1000_cents,
    }).eq("organization_id", organizationId);
    if (workspace.error) throw new Error(workspace.error.message);
  }
  await admin.from("organizations").update({ stripe_customer_id: stripeCustomerId }).eq("id", organizationId);
  return true;
}

async function syncCommunicationsInvoice(
  admin: ReturnType<typeof createClient>,
  stripe: Stripe,
  invoice: Stripe.Invoice,
) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || null;
  let subscription: Stripe.Subscription | null = null;
  if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const billingMetadata = subscription?.metadata || invoice.metadata;
  if (appFrom(billingMetadata) !== COMMUNICATIONS_APP) return false;
  if (subscription) await syncCommunicationsSubscription(admin, subscription);
  if (invoice.status === "paid" && subscriptionId) {
    const update = await admin.from("organization_product_subscriptions").update({ setup_fee_paid: true }).eq("stripe_subscription_id", subscriptionId);
    if (update.error) throw new Error(update.error.message);
  }
  return true;
}

async function syncSubscription(admin: ReturnType<typeof createClient>, subscription: Stripe.Subscription) {
  if (appFrom(subscription.metadata) !== WEBSITE_APP) return false;
  const snapshotId = String(subscription.metadata.billing_snapshot_id || "").trim();
  const { data: snapshot } = await admin.from("website_billing_snapshots").select("*").eq("id", snapshotId).maybeSingle();
  if (!snapshot) return false;
  const stripeCustomerId = customerId(subscription.customer);
  if (!stripeCustomerId) return false;
  const { data: billingCustomer } = await admin.from("website_billing_customers").select("id").eq("stripe_customer_id", stripeCustomerId).single();
  if (!billingCustomer) return false;
  const period = subscriptionPeriod(subscription);
  const type = subscriptionType(subscription.metadata);
  const firstItem = subscription.items.data[0];
  const interval = firstItem?.price?.recurring?.interval === "year" ? "yearly" : "monthly";
  const amountCents = subscription.items.data.reduce((sum, item) => sum + Number(item.price.unit_amount || 0) * Number(item.quantity || 1), 0);
  await admin.from("website_subscriptions").upsert({
    project_id: snapshot.project_id,
    snapshot_id: snapshot.id,
    subscription_type: type,
    client_user_id: snapshot.client_user_id,
    website_billing_customer_id: billingCustomer.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: firstItem?.price?.id || null,
    service_plan: snapshot.service_plan,
    billing_interval: interval,
    amount_cents: amountCents,
    status: mapSubscriptionStatus(subscription.status),
    current_period_start: unixDate(period.start),
    current_period_end: unixDate(period.end),
    commitment_ends_at: interval === "yearly" ? unixDate(period.end) : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    annual_partner_qualifying: snapshot.annual_partner_qualifying,
    referral_code: snapshot.referral_code,
    offer_code: snapshot.offer_code,
  }, { onConflict: "project_id,subscription_type" });
  const waitsForOfflineInvoice = Boolean(subscription.metadata.offline_payment_method);
  if (type === "service" && (subscription.status === "active" || subscription.status === "trialing") && !waitsForOfflineInvoice) {
    await activateSnapshot(admin, snapshot.id, snapshot.project_id);
    await admin.from("website_billing_schedules").update({
      status: "active",
      activated_at: new Date().toISOString(),
    }).eq("snapshot_id", snapshot.id);
  }
  return true;
}

async function activateSnapshot(admin: ReturnType<typeof createClient>, snapshotId: string, projectId: string) {
  await admin.from("website_billing_snapshots").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", snapshotId);
  await admin.from("website_projects").update({ current_stage: "onboarding" }).eq("id", projectId).eq("current_stage", "billing");
  await admin.from("website_project_milestones").update({ status: "complete", completed_at: new Date().toISOString() }).eq("project_id", projectId).eq("stage", "billing");
}

async function operationsPartyId(
  admin: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
  snapshot: Record<string, unknown>,
) {
  const accountUserId = String(snapshot.client_user_id || "");
  const { data: existing, error: selectError } = await admin
    .from("operations_parties")
    .select("id")
    .eq("account_user_id", accountUserId)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existing) return existing.id;

  const { data: inserted, error: insertError } = await admin
    .from("operations_parties")
    .insert({
      party_type: "customer",
      name: stripeCustomerName(invoice),
      email: invoice.customer_email || null,
      account_user_id: accountUserId,
      status: "active",
      notes: "Created automatically from a verified Stripe website invoice.",
      created_by_user_id: snapshot.prepared_by_user_id,
    })
    .select("id")
    .single();
  if (!insertError) return inserted.id;
  if (insertError.code !== "23505") throw new Error(insertError.message);

  const { data: raced, error: racedError } = await admin
    .from("operations_parties")
    .select("id")
    .eq("account_user_id", accountUserId)
    .single();
  if (racedError) throw new Error(racedError.message);
  return raced.id;
}

async function genericOperationsPartyId(admin: ReturnType<typeof createClient>, invoice: Stripe.Invoice, actorId: string) {
  const email = String(invoice.customer_email || "").trim().toLowerCase();
  const name = stripeCustomerName(invoice);
  let query = admin.from("operations_parties").select("id").limit(1);
  query = email ? query.ilike("email", email) : query.ilike("name", name);
  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing.id;
  const { data: created, error: createError } = await admin.from("operations_parties").insert({
    party_type: "customer", name, email: email || null, status: "active",
    notes: "Created automatically from a Stripe invoice.", created_by_user_id: actorId,
  }).select("id").single();
  if (createError) throw new Error(createError.message);
  return created.id;
}

async function syncGenericOperationsInvoice(admin: ReturnType<typeof createClient>, invoice: Stripe.Invoice) {
  if ((invoice.currency || "usd").toLowerCase() !== "usd" || (invoice.total || 0) <= 0) return false;
  const { data: owner, error: ownerError } = await admin.from("platform_admins").select("user_id").eq("status", "active").order("role").limit(1).maybeSingle();
  if (ownerError) throw new Error(ownerError.message);
  if (!owner?.user_id) throw new Error("No active platform administrator is available for Stripe sync.");
  const partyId = await genericOperationsPartyId(admin, invoice, owner.user_id);
  const { data: storedInvoice, error: invoiceError } = await admin.from("operations_invoices").upsert({
    invoice_number: stripeInvoiceNumber(invoice), customer_id: partyId, issue_date: unixDateOnly(invoice.created),
    due_date: invoice.due_date ? unixDateOnly(invoice.due_date) : null, total_cents: invoice.total,
    status: operationsInvoiceStatus(invoice.status), recurring: Boolean(invoice.subscription),
    external_url: invoice.hosted_invoice_url || invoice.invoice_pdf || null, notes: "Synchronized automatically from Stripe.",
    created_by_user_id: owner.user_id, source: "stripe", external_id: invoice.id,
  }, { onConflict: "source,external_id" }).select("id").single();
  if (invoiceError) throw new Error(invoiceError.message);
  if ((invoice.status === "paid" || (invoice.amount_paid || 0) > 0) && (invoice.amount_paid || 0) > 0) {
    const { error: transactionError } = await admin.from("operations_transactions").upsert({
      transaction_type: "revenue", transaction_date: stripePaidDate(invoice), amount_cents: invoice.amount_paid,
      status: "completed", party_id: partyId, invoice_id: storedInvoice.id, category: "stripe_revenue",
      payment_method: "stripe", recurring: Boolean(invoice.subscription), description: `Stripe payment for invoice ${stripeInvoiceNumber(invoice)}`,
      reference_number: invoice.id, notes: "Synchronized automatically from Stripe.", created_by_user_id: owner.user_id,
      source: "stripe", external_id: invoice.id,
    }, { onConflict: "source,external_id" });
    if (transactionError) throw new Error(transactionError.message);
  }
  return true;
}

async function syncOperationsInvoice(
  admin: ReturnType<typeof createClient>,
  invoice: Stripe.Invoice,
  snapshot: Record<string, unknown>,
  subscriptionId: string | null,
  metadata?: Stripe.Metadata | null,
) {
  if ((invoice.currency || "usd").toLowerCase() !== "usd") {
    throw new Error("Operations currently supports USD Stripe invoices only.");
  }
  if ((invoice.total || 0) <= 0) return;

  const partyId = await operationsPartyId(admin, invoice, snapshot);
  const invoiceNumber = stripeInvoiceNumber(invoice);
  if (!invoiceNumber) throw new Error("Stripe invoice number is missing.");

  const { data: operationsInvoice, error: invoiceError } = await admin
    .from("operations_invoices")
    .upsert({
      invoice_number: invoiceNumber,
      customer_id: partyId,
      issue_date: unixDateOnly(invoice.created),
      due_date: invoice.due_date ? unixDateOnly(invoice.due_date) : null,
      total_cents: invoice.total,
      status: operationsInvoiceStatus(invoice.status),
      recurring: Boolean(subscriptionId),
      external_url: invoice.hosted_invoice_url || invoice.invoice_pdf || null,
      notes: "Synchronized automatically from Stripe website billing.",
      created_by_user_id: snapshot.prepared_by_user_id,
      source: "stripe",
      external_id: invoice.id,
    }, { onConflict: "source,external_id" })
    .select("id")
    .single();
  if (invoiceError) throw new Error(invoiceError.message);

  if (invoice.status !== "paid" || (invoice.amount_paid || 0) <= 0) return;
  const offlineMethod = String(metadata?.offline_payment_method || "").trim();
  const paidOutsideStripe = Boolean(invoice.paid_out_of_band);
  const paymentMethod = paidOutsideStripe && ["cash", "check", "bank_transfer", "other"].includes(offlineMethod)
    ? offlineMethod
    : "stripe";
  const offlineReceivedOn = String(metadata?.offline_received_on || "").trim();
  const transactionDate = paidOutsideStripe && /^\d{4}-\d{2}-\d{2}$/.test(offlineReceivedOn)
    ? offlineReceivedOn
    : stripePaidDate(invoice);
  const offlineReference = String(metadata?.offline_reference || "").trim();
  const { error: transactionError } = await admin
    .from("operations_transactions")
    .upsert({
      transaction_type: "revenue",
      transaction_date: transactionDate,
      amount_cents: invoice.amount_paid,
      status: "completed",
      party_id: partyId,
      invoice_id: operationsInvoice.id,
      category: "website_revenue",
      payment_method: paymentMethod,
      recurring: Boolean(subscriptionId),
      description: paidOutsideStripe ? `Payment received outside Stripe for invoice ${invoiceNumber}` : `Stripe payment for invoice ${invoiceNumber}`,
      reference_number: offlineReference || invoice.id,
      notes: paidOutsideStripe
        ? "Invoice created in Stripe and marked paid outside Stripe from Website Billing. No card was charged."
        : "Synchronized automatically from a verified Stripe invoice.paid event.",
      created_by_user_id: snapshot.prepared_by_user_id,
      source: "stripe",
      external_id: invoice.id,
    }, { onConflict: "source,external_id" });
  if (transactionError) throw new Error(transactionError.message);
}

async function syncInvoice(admin: ReturnType<typeof createClient>, stripe: Stripe, invoice: Stripe.Invoice, eventType: string) {
  let subscription: Stripe.Subscription | null = null;
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || null;
  if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const metadata = subscription?.metadata || invoice.metadata;
  if (appFrom(metadata) !== WEBSITE_APP) return false;
  const snapshotId = String(metadata.billing_snapshot_id || "").trim();
  const { data: snapshot } = await admin.from("website_billing_snapshots").select("*").eq("id", snapshotId).maybeSingle();
  if (!snapshot) return false;
  if (subscription) await syncSubscription(admin, subscription);
  const { data: localSubscription } = subscriptionId
    ? await admin.from("website_subscriptions").select("id").eq("stripe_subscription_id", subscriptionId).maybeSingle()
    : { data: null };
  const discount = (invoice.total_discount_amounts || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const { data: localInvoice, error } = await admin.from("website_invoices").upsert({
    project_id: snapshot.project_id,
    snapshot_id: snapshot.id,
    subscription_id: localSubscription?.id || null,
    client_user_id: snapshot.client_user_id,
    stripe_invoice_id: invoice.id,
    stripe_customer_id: customerId(invoice.customer) || "",
    stripe_subscription_id: subscriptionId,
    status: invoice.status || "draft",
    currency: invoice.currency || "usd",
    subtotal_cents: invoice.subtotal || 0,
    discount_cents: discount,
    total_cents: invoice.total || 0,
    amount_due_cents: invoice.amount_due || 0,
    amount_paid_cents: invoice.amount_paid || 0,
    hosted_invoice_url: invoice.hosted_invoice_url,
    invoice_pdf_url: invoice.invoice_pdf,
    due_at: unixDate(invoice.due_date),
    paid_at: unixDate(invoice.status_transitions?.paid_at),
  }, { onConflict: "stripe_invoice_id" }).select("id").single();
  if (error) throw new Error(error.message);
  if (subscription && invoice.status === "paid" && metadata?.offline_payment_method) {
    await activateSnapshot(admin, snapshot.id, snapshot.project_id);
    await admin.from("website_billing_schedules").update({
      status: "active",
      activated_at: new Date().toISOString(),
    }).eq("snapshot_id", snapshot.id);
  }
  if (subscription && subscriptionType(metadata) === "domain" && invoice.status === "paid") {
    await admin.from("website_billing_snapshots").update({
      status: "prepared",
      checkout_url: null,
      checkout_expires_at: null,
    }).eq("id", snapshot.id).eq("status", "checkout_pending");
  }
  await admin.from("website_invoice_items").delete().eq("invoice_id", localInvoice.id);
  const lines = (invoice.lines?.data || []).map((line) => ({
    invoice_id: localInvoice.id,
    stripe_invoice_line_id: line.id,
    description: line.description || "Website billing item",
    quantity: line.quantity || 1,
    unit_amount_cents: line.quantity ? Math.round((line.amount || 0) / line.quantity) : line.amount || 0,
    total_amount_cents: Math.max(0, line.amount || 0),
    currency: line.currency || invoice.currency || "usd",
  }));
  if (lines.length) await admin.from("website_invoice_items").insert(lines);
  const chargeId = String(invoice.metadata?.billing_charge_id || metadata?.billing_charge_id || "").trim();
  if (chargeId) {
    let chargeStatus = "invoiced";
    if (eventType === "invoice.paid" || invoice.status === "paid") chargeStatus = "paid";
    else if (eventType === "invoice.payment_failed") chargeStatus = "failed";
    else if (eventType === "invoice.voided" || invoice.status === "void") chargeStatus = "void";
    await admin.from("website_billing_charges").update({
      local_invoice_id: localInvoice.id,
      stripe_invoice_id: invoice.id,
      status: chargeStatus,
    }).eq("id", chargeId).eq("project_id", snapshot.project_id);
  }
  if (eventType === "invoice.payment_failed") {
    await admin.from("website_billing_snapshots").update({ status: "payment_failed" }).eq("id", snapshot.id).neq("status", "active");
  } else if (eventType === "invoice.voided" && !subscriptionId) {
    await admin.from("website_billing_snapshots").update({ status: "canceled" }).eq("id", snapshot.id).neq("status", "active");
  }
  await syncOperationsInvoice(admin, invoice, snapshot, subscriptionId, metadata);
  return true;
}

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405, origin);
  const admin = serviceClient();
  let event: Stripe.Event | null = null;
  try {
    const signature = request.headers.get("stripe-signature");
    const secret = Deno.env.get("STRIPE_WEBSITE_WEBHOOK_SECRET");
    if (!signature || !secret) throw new Error("Website webhook signature configuration is missing.");
    const stripe = stripeClient();
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret);
    const object = event.data.object as Stripe.Event.Data.Object;
    const inserted = await admin.from("website_stripe_events").insert({
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_object_id: "id" in object ? String(object.id || "") : null,
      livemode: event.livemode,
    });
    if (inserted.error?.code === "23505") {
      const { data: previous, error: previousError } = await admin
        .from("website_stripe_events")
        .select("processing_status,received_at")
        .eq("stripe_event_id", event.id)
        .single();
      if (previousError) throw new Error(previousError.message);
      const staleProcessing = previous.processing_status === "processing"
        && Date.now() - new Date(previous.received_at).getTime() > 5 * 60 * 1000;
      if (previous.processing_status !== "failed" && !staleProcessing) {
        return response({ received: true, duplicate: true }, 200, origin);
      }
      const retried = await admin.from("website_stripe_events").update({
        processing_status: "processing",
        error_message: null,
        processed_at: null,
        received_at: new Date().toISOString(),
      }).eq("stripe_event_id", event.id);
      if (retried.error) throw new Error(retried.error.message);
    }
    if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);

    let handled = false;
    if (event.type === "checkout.session.completed") {
      const session = object as Stripe.Checkout.Session;
      if (appFrom(session.metadata) === WEBSITE_APP) {
        handled = true;
        const snapshotId = String(session.metadata?.billing_snapshot_id || "").trim();
        const { data: snapshot } = await admin.from("website_billing_snapshots").select("*").eq("id", snapshotId).single();
        const stripeCustomerId = customerId(session.customer);
        if (stripeCustomerId) await syncPaymentMethod(admin, stripe, stripeCustomerId);
        if (typeof session.subscription === "string") {
          await syncSubscription(admin, await stripe.subscriptions.retrieve(session.subscription));
        } else if (session.payment_status === "paid") {
          await activateSnapshot(admin, snapshot.id, snapshot.project_id);
        }
      } else if (appFrom(session.metadata) === COMMUNICATIONS_APP) {
        handled = true;
        const stripeCustomerId = customerId(session.customer);
        if (stripeCustomerId) await syncPaymentMethod(admin, stripe, stripeCustomerId);
        if (typeof session.subscription === "string") {
          await syncCommunicationsSubscription(admin, await stripe.subscriptions.retrieve(session.subscription));
          if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
            const paid = await admin.from("organization_product_subscriptions").update({ setup_fee_paid: true }).eq("stripe_subscription_id", session.subscription);
            if (paid.error) throw new Error(paid.error.message);
          }
        }
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const subscription = object as Stripe.Subscription;
      handled = appFrom(subscription.metadata) === COMMUNICATIONS_APP
        ? await syncCommunicationsSubscription(admin, subscription)
        : await syncSubscription(admin, subscription);
    } else if (["invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided"].includes(event.type)) {
      const invoice = object as Stripe.Invoice;
      const websiteHandled = await syncInvoice(admin, stripe, invoice, event.type);
      const communicationsHandled = websiteHandled ? false : await syncCommunicationsInvoice(admin, stripe, invoice);
      handled = websiteHandled || await syncGenericOperationsInvoice(admin, invoice) || communicationsHandled;
      if (handled && event.type === "invoice.payment_failed") {
        await notifyAdmin(admin, "Stripe payment failed", "A customer invoice payment failed. Review the billing account.", { stripe_invoice_id: invoice.id });
      }
    } else if (event.type === "customer.updated") {
      const customer = object as Stripe.Customer;
      if ([WEBSITE_APP, COMMUNICATIONS_APP].includes(appFrom(customer.metadata))) handled = await syncPaymentMethod(admin, stripe, customer.id);
    } else if (event.type === "payment_method.attached" || event.type === "payment_method.detached") {
      const method = object as Stripe.PaymentMethod;
      const id = typeof method.customer === "string" ? method.customer : method.customer?.id;
      if (id) handled = await syncPaymentMethod(admin, stripe, id);
      if (handled && event.type === "payment_method.detached") {
        await notifyAdmin(admin, "Website payment method removed", "A website client removed a saved payment method. Review the account before the next renewal.", { stripe_customer_id: id });
      }
    }
    await admin.from("website_stripe_events").update({ processing_status: handled ? "processed" : "ignored", processed_at: new Date().toISOString() }).eq("stripe_event_id", event.id);
    return response({ received: true }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website webhook processing failed.";
    if (event) await admin.from("website_stripe_events").update({ processing_status: "failed", error_message: message.slice(0, 500), processed_at: new Date().toISOString() }).eq("stripe_event_id", event.id);
    await notifyAdmin(admin, "Website billing webhook error", "A verified website billing event could not be processed.", { stripe_event_id: event?.id || null });
    return response({ error: message }, 400, origin);
  }
});
