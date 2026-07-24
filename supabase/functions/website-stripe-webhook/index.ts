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

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase webhook configuration is missing.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function appFrom(metadata?: Stripe.Metadata | null) {
  return String(metadata?.app || "").trim().toLowerCase();
}

function customerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  return typeof value === "string" ? value : value?.id || null;
}

function unixDate(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function syncPaymentMethod(admin: ReturnType<typeof createClient>, stripe: Stripe, stripeCustomerId: string) {
  const customer = await stripe.customers.retrieve(stripeCustomerId, { expand: ["invoice_settings.default_payment_method"] });
  if (customer.deleted || appFrom(customer.metadata) !== WEBSITE_APP) return false;
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
  await admin.from("website_subscriptions").upsert({
    project_id: snapshot.project_id,
    snapshot_id: snapshot.id,
    client_user_id: snapshot.client_user_id,
    website_billing_customer_id: billingCustomer.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: subscription.items.data[0]?.price?.id || null,
    service_plan: snapshot.service_plan,
    billing_interval: snapshot.recurring_interval,
    amount_cents: snapshot.recurring_cents,
    status: mapSubscriptionStatus(subscription.status),
    current_period_start: unixDate(period.start),
    current_period_end: unixDate(period.end),
    commitment_ends_at: snapshot.recurring_interval === "yearly" ? unixDate(period.end) : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    annual_partner_qualifying: snapshot.annual_partner_qualifying,
    referral_code: snapshot.referral_code,
  }, { onConflict: "project_id" });
  if (subscription.status === "active" || subscription.status === "trialing") {
    await activateSnapshot(admin, snapshot.id, snapshot.project_id);
  }
  return true;
}

async function activateSnapshot(admin: ReturnType<typeof createClient>, snapshotId: string, projectId: string) {
  await admin.from("website_billing_snapshots").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", snapshotId);
  await admin.from("website_projects").update({ current_stage: "onboarding" }).eq("id", projectId).eq("current_stage", "billing");
  await admin.from("website_project_milestones").update({ status: "complete", completed_at: new Date().toISOString() }).eq("project_id", projectId).eq("stage", "billing");
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
  if (eventType === "invoice.payment_failed") {
    await admin.from("website_billing_snapshots").update({ status: "payment_failed" }).eq("id", snapshot.id).neq("status", "active");
  } else if (eventType === "invoice.voided" && !subscriptionId) {
    await admin.from("website_billing_snapshots").update({ status: "canceled" }).eq("id", snapshot.id).neq("status", "active");
  }
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
    if (inserted.error?.code === "23505") return response({ received: true, duplicate: true }, 200, origin);
    if (inserted.error) throw new Error(inserted.error.message);

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
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      handled = await syncSubscription(admin, object as Stripe.Subscription);
    } else if (["invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided"].includes(event.type)) {
      handled = await syncInvoice(admin, stripe, object as Stripe.Invoice, event.type);
      if (handled && event.type === "invoice.payment_failed") {
        const invoice = object as Stripe.Invoice;
        await notifyAdmin(admin, "Website payment failed", "A website invoice payment failed. Review the website billing account.", { stripe_invoice_id: invoice.id });
      }
    } else if (event.type === "customer.updated") {
      const customer = object as Stripe.Customer;
      if (appFrom(customer.metadata) === WEBSITE_APP) handled = await syncPaymentMethod(admin, stripe, customer.id);
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
