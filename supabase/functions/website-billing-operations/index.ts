import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import {
  mapSubscriptionStatus,
  originFor,
  requireAdmin,
  response,
  snapshotItemPriceEnvironment,
  stripeClient,
  subscriptionPeriod,
  websiteMetadata,
} from "../_shared/website-billing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHARGE_SOURCES = new Set(["proposal_balance", "milestone", "domain", "third_party", "extra_edits", "additional_service"]);
const CHARGE_CATEGORIES = new Set(["website_build", "domain", "hosting", "maintenance", "email", "ssl_cdn", "content", "ecommerce", "integration", "other"]);
const TEMPLATES = new Set(["billing_setup_ready", "invoice_issued", "payment_received", "upcoming_renewal", "payment_failed", "card_expiring", "cancellation_scheduled"]);

function clean(value: unknown, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cents(value: unknown) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function iso(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function html(value: unknown) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(value / 100);
}

async function getProjectContext(admin: any, projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Choose a valid website project.");
  const { data: project, error } = await admin
    .from("website_projects")
    .select("id,name,client_user_id,status")
    .eq("id", projectId)
    .single();
  if (error || !project) throw new Error("Website project not found.");
  const [{ data: snapshot }, { data: customer }, userResult] = await Promise.all([
    admin.from("website_billing_snapshots").select("*,website_billing_snapshot_items(*)").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("website_billing_customers").select("*").eq("user_id", project.client_user_id).maybeSingle(),
    admin.auth.admin.getUserById(project.client_user_id),
  ]);
  const user = userResult?.data?.user;
  return { project, snapshot, customer, user };
}

async function ensureCustomer(admin: any, stripe: Stripe, context: Awaited<ReturnType<typeof getProjectContext>>) {
  if (context.customer?.stripe_customer_id) return context.customer;
  const customer = await stripe.customers.create({
    email: context.user?.email,
    name: clean(context.user?.user_metadata?.full_name || context.user?.user_metadata?.name, 180) || undefined,
    metadata: websiteMetadata({ n3xra_user_id: context.project.client_user_id }),
  }, { idempotencyKey: `website-customer-${context.project.client_user_id}` });
  const { data, error } = await admin.from("website_billing_customers").upsert({
    user_id: context.project.client_user_id,
    stripe_customer_id: customer.id,
  }, { onConflict: "user_id" }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

function communicationCopy(template: string, options: {
  firstName: string;
  projectName: string;
  amount?: number;
  dueAt?: string | null;
  invoiceUrl?: string | null;
}) {
  const projectName = options.projectName || "your website";
  const date = options.dueAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(options.dueAt))
    : null;
  const amount = options.amount ? money(options.amount) : null;
  const copies: Record<string, { subject: string; heading: string; body: string }> = {
    billing_setup_ready: {
      subject: `Complete billing setup for ${projectName}`,
      heading: "Your website billing setup is ready.",
      body: `Secure billing is ready for ${projectName}. Review the approved amount and complete setup from your N3XRA dashboard.`,
    },
    invoice_issued: {
      subject: `New invoice for ${projectName}`,
      heading: "A new website invoice is ready.",
      body: `A ${amount || ""} invoice for ${projectName} is ready${date ? ` and is due ${date}` : ""}.`,
    },
    payment_received: {
      subject: `Payment received for ${projectName}`,
      heading: "Thank you—your payment was received.",
      body: `We received your ${amount || ""} payment for ${projectName}.`,
    },
    upcoming_renewal: {
      subject: `Upcoming renewal for ${projectName}`,
      heading: "Your website service will renew soon.",
      body: `${projectName} is scheduled to renew${date ? ` on ${date}` : " soon"}. You can review billing details or update your payment method in your dashboard.`,
    },
    payment_failed: {
      subject: `Payment needs attention for ${projectName}`,
      heading: "We could not complete your website payment.",
      body: `Please review the billing information for ${projectName} and update your payment method in the secure Stripe portal.`,
    },
    card_expiring: {
      subject: `Update the payment method for ${projectName}`,
      heading: "Your saved card is expiring soon.",
      body: `Please update the payment method for ${projectName} before the next charge to avoid an interruption.`,
    },
    cancellation_scheduled: {
      subject: `Website service cancellation scheduled for ${projectName}`,
      heading: "Your cancellation has been scheduled.",
      body: `${projectName} will remain active through the current paid term${date ? ` ending ${date}` : ""}.`,
    },
  };
  return copies[template];
}

function communicationHtml(copy: { heading: string; body: string }, firstName: string, invoiceUrl?: string | null) {
  return `<div style="margin:0;padding:28px;background:#f4f7fa;font-family:Manrope,Trebuchet MS,sans-serif;color:#111827">
    <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #dfe5eb;border-radius:18px;overflow:hidden">
      <div style="padding:24px 28px;background:#0b121c;color:#fff"><div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#8ee5da">N3XRA website billing</div><h1 style="margin:10px 0 0;font-size:28px">${html(copy.heading)}</h1></div>
      <div style="padding:28px"><p>Hi ${html(firstName || "there")},</p><p style="line-height:1.65;color:#445166">${html(copy.body)}</p>
      <a href="${html(invoiceUrl || "https://www.n3xra.com/client-portal/billing/")}" style="display:inline-block;margin-top:12px;padding:13px 18px;border-radius:999px;background:#0b121c;color:#fff;text-decoration:none;font-weight:700">Open secure website billing</a>
      <p style="margin-top:24px;padding-top:18px;border-top:1px solid #e5e7eb;color:#667085;font-size:13px">N3XRA never stores complete card information. Secure payments are handled by Stripe.</p></div>
    </div></div>`;
}

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return response({ ok: true }, 200, origin);
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405, origin);
  try {
    const { admin, authUser } = await requireAdmin(request);
    const input = await request.json().catch(() => ({}));
    const action = clean(input.action, 80);
    const projectId = clean(input.project_id, 80);
    const context = await getProjectContext(admin, projectId);
    if (!context.snapshot) throw new Error("Prepare the approved proposal for billing first.");

    if (action === "record_offline_subscription_payment") {
      const paymentMethod = clean(input.payment_method, 40);
      const allowedMethods = new Set(["cash", "check", "bank_transfer", "other"]);
      if (!allowedMethods.has(paymentMethod)) throw new Error("Choose how the recurring plan was paid.");
      const receivedOn = clean(input.received_on, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) throw new Error("Enter the date the payment was received.");
      const receivedDate = new Date(`${receivedOn}T12:00:00Z`);
      if (Number.isNaN(receivedDate.getTime())) throw new Error("Enter a valid payment date.");
      if (receivedDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new Error("The payment date cannot be in the future.");
      const reference = clean(input.reference, 160) || null;

      const { data: existingSubscription } = await admin
        .from("website_subscriptions")
        .select("id,stripe_subscription_id,status")
        .eq("project_id", context.project.id)
        .eq("subscription_type", "service")
        .maybeSingle();
      const recurringItems = (context.snapshot.website_billing_snapshot_items || [])
        .filter((item: Record<string, unknown>) => item.billing_type === "recurring" && item.included_in_initial_checkout)
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
      if (!recurringItems.length || Number(context.snapshot.recurring_cents || 0) <= 0) {
        throw new Error("This approved proposal does not contain a recurring service to activate.");
      }
      const intervals = new Set(recurringItems.map((item: Record<string, unknown>) => String(item.recurring_interval || "")));
      if (intervals.size !== 1 || !intervals.has(String(context.snapshot.recurring_interval || ""))) {
        throw new Error("The approved recurring items do not share one billing schedule.");
      }
      const stripeItems: Stripe.SubscriptionCreateParams.Item[] = recurringItems.map((item: Record<string, unknown>) => {
        const price = snapshotItemPriceEnvironment(item, context.snapshot.service_plan);
        if (!price) throw new Error(`Stripe pricing is not configured for ${String(item.name || "this recurring item")}.`);
        return { price, quantity: Math.max(1, Number(item.quantity || 1)) };
      });

      const stripe = stripeClient();
      const customer = await ensureCustomer(admin, stripe, context);
      const metadata = websiteMetadata({
        n3xra_user_id: context.project.client_user_id,
        website_project_id: context.project.id,
        proposal_version_id: context.snapshot.proposal_version_id,
        billing_snapshot_id: context.snapshot.id,
        referral_code: context.snapshot.referral_code,
        offer_code: context.snapshot.offer_code,
        offline_payment_method: paymentMethod,
        offline_received_on: receivedOn,
        offline_reference: reference,
      });
      const key = `website-offline-subscription-${context.snapshot.id}`;
      let subscription: Stripe.Subscription;
      if (existingSubscription?.stripe_subscription_id) {
        subscription = await stripe.subscriptions.retrieve(existingSubscription.stripe_subscription_id, { expand: ["latest_invoice"] });
        if (String(subscription.metadata.billing_snapshot_id || "") !== context.snapshot.id || !subscription.metadata.offline_payment_method) {
          throw new Error("This website already has a different Stripe subscription. Open its existing billing record instead.");
        }
      } else {
        const customerSubscriptions = await stripe.subscriptions.list({
          customer: customer.stripe_customer_id,
          status: "all",
          limit: 100,
          expand: ["data.latest_invoice"],
        });
        const matchingSubscription = customerSubscriptions.data.find((item) =>
          String(item.metadata.billing_snapshot_id || "") === context.snapshot.id
          && Boolean(item.metadata.offline_payment_method)
        );
        subscription = matchingSubscription || await stripe.subscriptions.create({
            customer: customer.stripe_customer_id,
            items: stripeItems,
            collection_method: "send_invoice",
            days_until_due: 7,
            description: `${context.project.name} — recurring website service`,
            metadata,
            expand: ["latest_invoice"],
          }, { idempotencyKey: key });
      }

      if (!subscription.latest_invoice) throw new Error("Stripe did not create the recurring invoice.");
      let invoice = typeof subscription.latest_invoice === "object" && subscription.latest_invoice
        ? subscription.latest_invoice as Stripe.Invoice
        : await stripe.invoices.retrieve(String(subscription.latest_invoice));
      if (invoice.status === "draft") {
        invoice = await stripe.invoices.finalizeInvoice(
          invoice.id,
          { auto_advance: false },
          { idempotencyKey: `${key}-finalize` },
        );
      }
      if (invoice.status === "open") {
        invoice = await stripe.invoices.pay(
          invoice.id,
          { paid_out_of_band: true },
          { idempotencyKey: `${key}-pay` },
        );
      }
      if (invoice.status !== "paid") throw new Error("Stripe did not finish marking the recurring invoice paid.");
      subscription = await stripe.subscriptions.retrieve(subscription.id);
      const period = subscriptionPeriod(subscription);
      const periodStart = period.start ? new Date(period.start * 1000).toISOString() : null;
      const periodEnd = period.end ? new Date(period.end * 1000).toISOString() : null;
      const { data: localSubscription, error: subscriptionError } = await admin
        .from("website_subscriptions")
        .upsert({
          project_id: context.project.id,
          snapshot_id: context.snapshot.id,
          subscription_type: "service",
          client_user_id: context.project.client_user_id,
          website_billing_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          stripe_price_id: subscription.items.data[0]?.price?.id || null,
          service_plan: context.snapshot.service_plan,
          billing_interval: context.snapshot.recurring_interval,
          amount_cents: context.snapshot.recurring_cents,
          status: mapSubscriptionStatus(subscription.status),
          current_period_start: periodStart,
          current_period_end: periodEnd,
          commitment_ends_at: context.snapshot.recurring_interval === "yearly" ? periodEnd : null,
          cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
          annual_partner_qualifying: context.snapshot.annual_partner_qualifying,
          referral_code: context.snapshot.referral_code,
          offer_code: context.snapshot.offer_code,
        }, { onConflict: "project_id,subscription_type" })
        .select("id")
        .single();
      if (subscriptionError) throw new Error(subscriptionError.message);

      const discount = (invoice.total_discount_amounts || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const { data: localInvoice, error: invoiceError } = await admin
        .from("website_invoices")
        .upsert({
          project_id: context.project.id,
          snapshot_id: context.snapshot.id,
          subscription_id: localSubscription.id,
          client_user_id: context.project.client_user_id,
          stripe_invoice_id: invoice.id,
          stripe_customer_id: customer.stripe_customer_id,
          stripe_subscription_id: subscription.id,
          status: invoice.status,
          currency: invoice.currency || "usd",
          subtotal_cents: invoice.subtotal || 0,
          discount_cents: discount,
          total_cents: invoice.total || 0,
          amount_due_cents: invoice.amount_due || 0,
          amount_paid_cents: invoice.amount_paid || 0,
          hosted_invoice_url: invoice.hosted_invoice_url,
          invoice_pdf_url: invoice.invoice_pdf,
          due_at: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
          paid_at: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
        }, { onConflict: "stripe_invoice_id" })
        .select("id")
        .single();
      if (invoiceError) throw new Error(invoiceError.message);
      await admin.from("website_invoice_items").delete().eq("invoice_id", localInvoice.id);
      const invoiceItems = (invoice.lines?.data || []).map((line) => ({
        invoice_id: localInvoice.id,
        stripe_invoice_line_id: line.id,
        description: line.description || "Website billing item",
        quantity: line.quantity || 1,
        unit_amount_cents: line.quantity ? Math.round((line.amount || 0) / line.quantity) : line.amount || 0,
        total_amount_cents: Math.max(0, line.amount || 0),
        currency: line.currency || invoice.currency || "usd",
      }));
      if (invoiceItems.length) {
        const { error: itemError } = await admin.from("website_invoice_items").insert(invoiceItems);
        if (itemError) throw new Error(itemError.message);
      }
      await admin.from("website_billing_snapshots").update({
        status: "active",
        activated_at: new Date().toISOString(),
      }).eq("id", context.snapshot.id);
      await admin.from("website_billing_schedules").update({
        status: "active",
        activated_at: new Date().toISOString(),
      }).eq("snapshot_id", context.snapshot.id);
      return response({
        subscription_id: subscription.id,
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        status: invoice.status,
      }, 200, origin);
    }

    if (action === "save_schedule") {
      if (context.snapshot.status === "active") throw new Error("The active subscription schedule is controlled by Stripe.");
      const serviceStartAt = iso(input.service_start_at);
      if (input.service_start_at && !serviceStartAt) throw new Error("Enter a valid service start date.");
      if (serviceStartAt && new Date(serviceStartAt).getTime() < Date.now() - 60_000) throw new Error("The service start cannot be in the past.");
      if (serviceStartAt) {
        const leadTime = new Date(serviceStartAt).getTime() - Date.now();
        if (leadTime > 60_000 && leadTime < 48 * 60 * 60 * 1000) {
          throw new Error("A future subscription start must be at least 48 hours away. Leave it blank to begin after checkout.");
        }
      }
      const collectionMethod = input.collection_method === "send_invoice" ? "send_invoice" : "charge_automatically";
      const daysUntilDue = collectionMethod === "send_invoice" ? Math.min(60, Math.max(1, Number(input.days_until_due || 7))) : null;
      const anchorDay = serviceStartAt ? new Date(serviceStartAt).getUTCDate() : null;
      if (anchorDay && anchorDay > 28) throw new Error("Choose a service start date between the 1st and 28th so renewals remain predictable.");
      const { data, error } = await admin.from("website_billing_schedules").upsert({
        project_id: context.project.id,
        snapshot_id: context.snapshot.id,
        client_user_id: context.project.client_user_id,
        service_start_at: serviceStartAt,
        billing_anchor_day: anchorDay,
        collection_method: collectionMethod,
        days_until_due: daysUntilDue,
        require_payment_method: true,
        status: "approved",
        approved_by_user_id: authUser.id,
        approved_at: new Date().toISOString(),
        created_by_user_id: authUser.id,
      }, { onConflict: "project_id" }).select().single();
      if (error) throw new Error(error.message);
      return response({ schedule: data }, 200, origin);
    }

    if (action === "create_charge") {
      const source = clean(input.source, 60);
      const category = clean(input.category, 60);
      const name = clean(input.name, 160);
      const description = clean(input.description, 1000) || null;
      const amount = cents(input.amount_cents);
      const scheduledFor = iso(input.scheduled_for);
      const collectionMethod = input.collection_method === "charge_automatically" ? "charge_automatically" : "send_invoice";
      const daysUntilDue = collectionMethod === "send_invoice" ? Math.min(60, Math.max(1, Number(input.days_until_due || 7))) : null;
      const approvalReference = clean(input.approval_reference, 500) || null;
      if (!CHARGE_SOURCES.has(source) || !CHARGE_CATEGORIES.has(category) || !name || !amount) throw new Error("Complete the approved charge details.");
      if (scheduledFor && new Date(scheduledFor).getTime() < Date.now() - 60_000) throw new Error("The invoice date cannot be in the past.");
      if (scheduledFor && new Date(scheduledFor).getTime() > Date.now() + 5 * 365 * 24 * 60 * 60 * 1000) {
        throw new Error("Stripe invoices can be scheduled no more than five years ahead.");
      }

      const proposalApproved = source === "proposal_balance" || source === "milestone";
      if (!proposalApproved && (!input.approval_confirmed || !approvalReference || approvalReference.length < 8)) {
        throw new Error("Additional work requires documented client approval before it can be billed.");
      }
      if (proposalApproved) {
        const { data: prior } = await admin.from("website_billing_charges")
          .select("amount_cents,status")
          .eq("snapshot_id", context.snapshot.id)
          .in("source", ["proposal_balance", "milestone"])
          .not("status", "in", '("canceled","void")');
        const committed = (prior || []).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
        if (committed + amount > Number(context.snapshot.remaining_build_balance_cents || 0)) {
          throw new Error("This installment would exceed the remaining approved proposal balance.");
        }
      }
      const idempotencyKey = `website-charge-${crypto.randomUUID()}`;
      const { data, error } = await admin.from("website_billing_charges").insert({
        project_id: context.project.id,
        snapshot_id: context.snapshot.id,
        client_user_id: context.project.client_user_id,
        source,
        category,
        name,
        description,
        amount_cents: amount,
        currency: context.snapshot.currency || "usd",
        approval_status: "approved",
        approval_reference: approvalReference || "Accepted proposal balance",
        approved_by_user_id: authUser.id,
        approved_at: new Date().toISOString(),
        collection_method: collectionMethod,
        scheduled_for: scheduledFor,
        days_until_due: daysUntilDue,
        status: "draft",
        idempotency_key: idempotencyKey,
        created_by_user_id: authUser.id,
      }).select().single();
      if (error) throw new Error(error.message);
      return response({ charge: data }, 200, origin);
    }

    if (action === "issue_charge") {
      const chargeId = clean(input.charge_id, 80);
      const { data: charge, error } = await admin.from("website_billing_charges")
        .select("*").eq("id", chargeId).eq("project_id", context.project.id).single();
      if (error || !charge) throw new Error("Approved charge not found.");
      if (charge.approval_status !== "approved") throw new Error("Client approval must be recorded before invoicing.");
      if (charge.stripe_invoice_id) return response({ invoice_id: charge.stripe_invoice_id, reused: true }, 200, origin);
      const stripe = stripeClient();
      const customer = await ensureCustomer(admin, stripe, context);
      if (charge.collection_method === "charge_automatically" && customer.payment_method_status !== "available") {
        throw new Error("A valid saved payment method is required before automatic collection.");
      }
      const metadata = websiteMetadata({
        n3xra_user_id: context.project.client_user_id,
        website_project_id: context.project.id,
        proposal_version_id: context.snapshot.proposal_version_id,
        billing_snapshot_id: context.snapshot.id,
        billing_charge_id: charge.id,
        referral_code: context.snapshot.referral_code,
      });
      const scheduled = charge.scheduled_for && new Date(charge.scheduled_for).getTime() > Date.now() + 5 * 60_000;
      const invoiceParams: Stripe.InvoiceCreateParams = {
        customer: customer.stripe_customer_id,
        currency: charge.currency,
        collection_method: charge.collection_method,
        auto_advance: scheduled,
        description: `${context.project.name} — ${charge.name}`,
        metadata,
        custom_fields: [{ name: "Website", value: context.project.name.slice(0, 140) }],
        ...(charge.collection_method === "send_invoice" ? { days_until_due: charge.days_until_due || 7 } : {}),
        ...(scheduled ? { automatically_finalizes_at: Math.floor(new Date(charge.scheduled_for).getTime() / 1000) } : {}),
      };
      const invoice = await stripe.invoices.create(invoiceParams, { idempotencyKey: `${charge.idempotency_key}-invoice` });
      await stripe.invoiceItems.create({
        customer: customer.stripe_customer_id,
        invoice: invoice.id,
        amount: charge.amount_cents,
        currency: charge.currency,
        description: charge.description ? `${charge.name} — ${charge.description}` : charge.name,
        metadata,
      }, { idempotencyKey: `${charge.idempotency_key}-item` });
      let finalInvoice = invoice;
      if (!scheduled) {
        finalInvoice = await stripe.invoices.finalizeInvoice(
          invoice.id,
          { auto_advance: charge.collection_method === "charge_automatically" },
          { idempotencyKey: `${charge.idempotency_key}-finalize` },
        );
        if (charge.collection_method === "send_invoice" && finalInvoice.status === "open") {
          finalInvoice = await stripe.invoices.sendInvoice(invoice.id, {}, { idempotencyKey: `${charge.idempotency_key}-send` });
        }
      }
      const { error: updateError } = await admin.from("website_billing_charges").update({
        status: scheduled ? "scheduled" : "invoiced",
        stripe_invoice_id: invoice.id,
      }).eq("id", charge.id);
      if (updateError) throw new Error(updateError.message);
      return response({
        invoice_id: invoice.id,
        hosted_invoice_url: finalInvoice.hosted_invoice_url,
        status: scheduled ? "scheduled" : finalInvoice.status,
      }, 200, origin);
    }

    if (action === "void_charge_invoice") {
      const chargeId = clean(input.charge_id, 80);
      const { data: charge } = await admin.from("website_billing_charges").select("*").eq("id", chargeId).eq("project_id", context.project.id).single();
      if (!charge?.stripe_invoice_id) throw new Error("This charge does not have a Stripe invoice.");
      const invoice = await stripeClient().invoices.retrieve(charge.stripe_invoice_id);
      if (invoice.status === "draft") await stripeClient().invoices.del(invoice.id);
      else if (invoice.status === "open") await stripeClient().invoices.voidInvoice(invoice.id);
      else throw new Error("Only draft or open invoices can be voided.");
      await admin.from("website_billing_charges").update({ status: "void" }).eq("id", charge.id);
      return response({ ok: true }, 200, origin);
    }

    if (action === "resend_invoice") {
      const invoiceId = clean(input.invoice_id, 120);
      const { data: invoice } = await admin.from("website_invoices").select("*").eq("id", invoiceId).eq("project_id", context.project.id).single();
      if (!invoice?.stripe_invoice_id) throw new Error("Invoice not found.");
      const result = await stripeClient().invoices.sendInvoice(invoice.stripe_invoice_id);
      return response({ hosted_invoice_url: result.hosted_invoice_url }, 200, origin);
    }

    if (action === "schedule_cancellation") {
      const { data: subscription } = await admin.from("website_subscriptions").select("*").eq("project_id", context.project.id).eq("subscription_type", "service").single();
      if (!subscription?.stripe_subscription_id) throw new Error("Active Stripe subscription not found.");
      const result = await stripeClient().subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true,
        cancellation_details: { comment: clean(input.reason, 400) || "Cancellation scheduled in N3XRA Website Admin" },
      });
      return response({ cancel_at_period_end: result.cancel_at_period_end }, 200, origin);
    }

    if (action === "preview_communication" || action === "send_communication") {
      const template = clean(input.template, 80);
      if (!TEMPLATES.has(template)) throw new Error("Choose a supported billing message.");
      const recipient = clean(context.user?.email, 320).toLowerCase();
      if (!EMAIL.test(recipient)) throw new Error("The client account does not have a valid email.");
      const firstName = clean(context.user?.user_metadata?.full_name || context.user?.user_metadata?.name || recipient.split("@")[0], 100).split(/\s+/)[0];
      const invoiceId = clean(input.invoice_id, 80) || null;
      const chargeId = clean(input.charge_id, 80) || null;
      let invoice = null;
      if (invoiceId) {
        const result = await admin.from("website_invoices").select("*").eq("id", invoiceId).eq("project_id", context.project.id).maybeSingle();
        invoice = result.data;
      }
      const copy = communicationCopy(template, {
        firstName,
        projectName: context.project.name,
        amount: Number(invoice?.total_cents || input.amount_cents || 0),
        dueAt: invoice?.due_at || input.due_at || null,
        invoiceUrl: invoice?.hosted_invoice_url || null,
      });
      const messageHtml = communicationHtml(copy, firstName, invoice?.hosted_invoice_url);
      if (action === "preview_communication") return response({ recipient, subject: copy.subject, html: messageHtml }, 200, origin);
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) throw new Error("Billing email delivery is not configured.");
      const delivery = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("WEBSITE_BILLING_FROM_EMAIL") || "N3XRA <updates@n3xra.com>",
          to: [recipient],
          subject: copy.subject,
          html: messageHtml,
          text: `${copy.heading}\n\n${copy.body}\n\nOpen secure website billing: https://www.n3xra.com/client-portal/billing/`,
        }),
      });
      const delivered = await delivery.json().catch(() => ({}));
      const row = await admin.from("website_billing_communications").insert({
        project_id: context.project.id,
        client_user_id: context.project.client_user_id,
        invoice_id: invoiceId,
        charge_id: chargeId,
        template,
        recipient_email: recipient,
        subject: copy.subject,
        status: delivery.ok ? "sent" : "failed",
        provider_message_id: delivery.ok ? delivered.id || null : null,
        error_message: delivery.ok ? null : clean(delivered.message || delivered.error || "Delivery failed", 500),
        sent_by_user_id: authUser.id,
        sent_at: delivery.ok ? new Date().toISOString() : null,
      });
      if (row.error) throw new Error(row.error.message);
      if (!delivery.ok) throw new Error(delivered.message || delivered.error || "Billing email could not be sent.");
      return response({ sent: true, recipient }, 200, origin);
    }

    throw new Error("Unsupported website billing action.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website billing operation failed.";
    console.error("website-billing-operations failed", message);
    return response({ error: message }, 400, origin);
  }
});
