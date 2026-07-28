import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { requireAdmin, originFor, response, stripeClient } from "../_shared/website-billing.ts";
import { operationsInvoiceStatus, stripeCustomerName, stripeInvoiceNumber, stripePaidDate, unixDateOnly } from "../_shared/operations-stripe.mjs";

function safeDate(value: unknown) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function invoicePreview(invoice: Stripe.Invoice) {
  return {
    id: invoice.id,
    number: stripeInvoiceNumber(invoice),
    customer: stripeCustomerName(invoice),
    status: invoice.status || "draft",
    issue_date: unixDateOnly(invoice.created),
    total_cents: Number(invoice.total || 0),
    paid_cents: Number(invoice.amount_paid || 0),
    already_imported: false,
  };
}

async function listInvoices(stripe: Stripe, startDate: string) {
  const invoices: Stripe.Invoice[] = [];
  for await (const invoice of stripe.invoices.list({
    limit: 100,
    created: { gte: Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000) },
  })) {
    if ((invoice.currency || "usd").toLowerCase() === "usd" && Number(invoice.total || 0) > 0) invoices.push(invoice);
  }
  return invoices;
}

async function partyForInvoice(admin: any, invoice: Stripe.Invoice, actorId: string) {
  const email = String(invoice.customer_email || "").trim().toLowerCase();
  const name = stripeCustomerName(invoice);
  let existingQuery = admin.from("operations_parties").select("id").limit(1);
  existingQuery = email ? existingQuery.ilike("email", email) : existingQuery.ilike("name", name);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing.id;
  const { data: created, error: createError } = await admin.from("operations_parties").insert({
    party_type: "customer",
    name,
    email: email || null,
    status: "active",
    notes: "Created automatically from a Stripe invoice sync.",
    created_by_user_id: actorId,
  }).select("id").single();
  if (createError) throw new Error(createError.message);
  return created.id;
}

async function importInvoice(admin: any, invoice: Stripe.Invoice, actorId: string) {
  const customerId = await partyForInvoice(admin, invoice, actorId);
  const invoicePayload = {
    invoice_number: stripeInvoiceNumber(invoice),
    customer_id: customerId,
    issue_date: unixDateOnly(invoice.created),
    due_date: invoice.due_date ? unixDateOnly(invoice.due_date) : null,
    total_cents: Number(invoice.total || 0),
    status: operationsInvoiceStatus(invoice.status),
    recurring: Boolean(invoice.subscription),
    external_url: invoice.hosted_invoice_url || invoice.invoice_pdf || null,
    notes: "Synchronized from Stripe.",
    created_by_user_id: actorId,
    source: "stripe",
    external_id: invoice.id,
  };
  const { data: storedInvoice, error: invoiceError } = await admin.from("operations_invoices")
    .upsert(invoicePayload, { onConflict: "source,external_id" }).select("id").single();
  if (invoiceError) throw new Error(invoiceError.message);

  if ((invoice.status === "paid" || Number(invoice.amount_paid || 0) > 0) && Number(invoice.amount_paid || 0) > 0) {
    const { error: transactionError } = await admin.from("operations_transactions").upsert({
      transaction_type: "revenue",
      transaction_date: stripePaidDate(invoice),
      amount_cents: Number(invoice.amount_paid || 0),
      status: "completed",
      party_id: customerId,
      invoice_id: storedInvoice.id,
      category: "stripe_revenue",
      payment_method: "stripe",
      recurring: Boolean(invoice.subscription),
      description: `Stripe payment for invoice ${stripeInvoiceNumber(invoice)}`,
      reference_number: invoice.id,
      notes: "Synchronized from Stripe.",
      created_by_user_id: actorId,
      source: "stripe",
      external_id: invoice.id,
    }, { onConflict: "source,external_id" });
    if (transactionError) throw new Error(transactionError.message);
  }
}

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405, origin);
  try {
    const { admin, authUser } = await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const startDate = safeDate(body.start_date) || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const stripe = stripeClient();
    const invoices = await listInvoices(stripe, startDate);
    const ids = invoices.map((invoice) => invoice.id);
    const { data: existing, error: existingError } = ids.length
      ? await admin.from("operations_invoices").select("external_id").eq("source", "stripe").in("external_id", ids)
      : { data: [], error: null };
    if (existingError) throw new Error(existingError.message);
    const known = new Set((existing || []).map((item: any) => String(item.external_id)));

    if (body.action === "preview") {
      return response({ start_date: startDate, invoices: invoices.map((invoice) => ({ ...invoicePreview(invoice), already_imported: known.has(invoice.id) })) }, 200, origin);
    }
    if (body.action !== "import") return response({ error: "Choose preview or import." }, 400, origin);
    const selectedIds = new Set(Array.isArray(body.invoice_ids) ? body.invoice_ids.map(String) : []);
    const selected = invoices.filter((invoice) => selectedIds.has(invoice.id) && !known.has(invoice.id));
    for (const invoice of selected) await importInvoice(admin, invoice, authUser.id);
    return response({ imported_count: selected.length, skipped_count: invoices.length - selected.length }, 200, origin);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to sync Stripe invoices." }, 400, origin);
  }
});
