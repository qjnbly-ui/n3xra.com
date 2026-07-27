export function operationsInvoiceStatus(stripeStatus) {
  const statuses = {
    draft: "draft",
    open: "sent",
    paid: "paid",
    void: "void",
    uncollectible: "uncollectible",
  };
  return statuses[stripeStatus] || "sent";
}

export function unixDateOnly(value, fallback = new Date()) {
  const date = value ? new Date(Number(value) * 1000) : fallback;
  return date.toISOString().slice(0, 10);
}

export function stripeInvoiceNumber(invoice) {
  return String(invoice.number || invoice.id || "").trim();
}

export function stripeCustomerName(invoice) {
  const name = String(invoice.customer_name || "").trim();
  const email = String(invoice.customer_email || "").trim();
  if (name) return name;
  if (email) return email;
  const id = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  return id ? `Stripe customer ${String(id).slice(-8)}` : "Stripe customer";
}

export function stripePaidDate(invoice, fallback = new Date()) {
  return unixDateOnly(invoice.status_transitions?.paid_at, fallback);
}
