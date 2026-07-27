export function toCents(value) {
  const normalized = String(value ?? "").replace(/[$,\s]/g, "");
  if (!normalized || !/^-?\d+(\.\d{0,2})?$/.test(normalized)) {
    throw new Error("Enter a valid monetary amount with no more than two decimal places.");
  }
  const sign = normalized.startsWith("-") ? -1 : 1;
  const [whole, fraction = ""] = normalized.replace("-", "").split(".");
  return sign * ((Number(whole) * 100) + Number(fraction.padEnd(2, "0")));
}

export function outstandingInvoiceCents(invoice, transactions) {
  if (["void", "uncollectible", "paid"].includes(invoice.status)) return 0;
  const paid = transactions
    .filter((item) => item.invoice_id === invoice.id && item.transaction_type === "revenue" && item.status === "completed")
    .reduce((total, item) => total + Number(item.amount_cents || 0), 0);
  return Math.max(0, Number(invoice.total_cents || 0) - paid);
}

export function summarizeOperations({
  transactions = [],
  invoices = [],
  parties = [],
  projects = [],
  financialAccounts = [],
  today = new Date(),
} = {}) {
  const month = today.toISOString().slice(0, 7);
  const active = transactions.filter((item) => item.status === "completed");
  const monthTransactions = active.filter((item) => String(item.transaction_date || "").slice(0, 7) === month);
  const revenueCents = monthTransactions
    .filter((item) => item.transaction_type === "revenue")
    .reduce((total, item) => total + Number(item.amount_cents || 0), 0);
  const expenseCents = monthTransactions
    .filter((item) => item.transaction_type === "expense")
    .reduce((total, item) => total + Number(item.amount_cents || 0), 0);
  const bankBalanceCents = financialAccounts
    .filter((item) => item.status === "active" && item.account_type !== "credit" && item.current_balance_cents !== null)
    .reduce((total, item) => total + Number(item.current_balance_cents || 0), 0);
  const outstandingCents = invoices.reduce(
    (total, invoice) => total + outstandingInvoiceCents(invoice, active),
    0,
  );

  return {
    bankBalanceCents,
    outstandingCents,
    revenueCents,
    expenseCents,
    netProfitCents: revenueCents - expenseCents,
    activeCustomers: parties.filter((item) => item.status === "active" && ["customer", "both"].includes(item.party_type)).length,
    activeProjects: projects.filter((item) => item.status === "active").length,
  };
}
