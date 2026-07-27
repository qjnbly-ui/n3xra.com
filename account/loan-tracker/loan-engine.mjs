const DAY_MS = 86_400_000;

export function toCents(value) {
  const normalized = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d{0,2})?$/.test(normalized)) throw new Error("Enter a valid dollar amount.");
  const negative = normalized.startsWith("-");
  const [wholeRaw, fractionRaw = ""] = normalized.replace("-", "").split(".");
  const cents = (Number(wholeRaw) * 100) + Number(fractionRaw.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is outside the supported range.");
  return negative ? -cents : cents;
}

export function fromCents(cents) {
  return (Number(cents) / 100).toFixed(2);
}

export function interestForMonth(balanceCents, aprBasisPoints) {
  return Math.round((balanceCents * aprBasisPoints) / 120000);
}

export function parseLocalDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addMonthsClamped(value, amount) {
  const date = typeof value === "string" ? parseLocalDate(value) : new Date(value);
  const day = date.getUTCDate();
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first;
}

export function buildSchedule({ balanceCents, aprBasisPoints, paymentCents, firstPaymentDate, maxPayments = 1200 }) {
  if (balanceCents <= 0) return [];
  const firstInterest = interestForMonth(balanceCents, aprBasisPoints);
  if (paymentCents <= firstInterest) throw new Error("Payment must be greater than monthly interest.");
  const rows = [];
  let balance = balanceCents;
  for (let index = 0; balance > 0 && index < maxPayments; index += 1) {
    const interestCents = interestForMonth(balance, aprBasisPoints);
    const dueCents = balance + interestCents;
    const actualPaymentCents = Math.min(paymentCents, dueCents);
    const principalCents = actualPaymentCents - interestCents;
    const endingBalanceCents = Math.max(0, balance - principalCents);
    rows.push({
      paymentNumber: index + 1,
      paymentDate: isoDate(addMonthsClamped(firstPaymentDate, index)),
      beginningBalanceCents: balance,
      paymentCents: actualPaymentCents,
      interestCents,
      principalCents,
      endingBalanceCents,
    });
    balance = endingBalanceCents;
  }
  if (balance > 0) throw new Error("This loan does not pay off within 100 years.");
  return rows;
}

export function summarizeSchedule(rows) {
  const totalInterestCents = rows.reduce((total, row) => total + row.interestCents, 0);
  const totalPaidCents = rows.reduce((total, row) => total + row.paymentCents, 0);
  return {
    payments: rows.length,
    payoffDate: rows.at(-1)?.paymentDate || null,
    totalInterestCents,
    totalPaidCents,
    finalPaymentCents: rows.at(-1)?.paymentCents || 0,
  };
}

export function comparePlans(input, requiredPaymentCents) {
  const selected = summarizeSchedule(buildSchedule(input));
  const minimum = summarizeSchedule(buildSchedule({ ...input, paymentCents: requiredPaymentCents }));
  return {
    selected,
    minimum,
    interestSavedCents: Math.max(0, minimum.totalInterestCents - selected.totalInterestCents),
    monthsSaved: Math.max(0, minimum.payments - selected.payments),
  };
}

export function rebuildPayments(account, payments) {
  const aprBasisPoints = Math.round(Number(account.annual_interest_rate) * 100);
  let balance = toCents(account.original_balance);
  let number = 0;
  return [...payments]
    .sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)) || String(a.created_at).localeCompare(String(b.created_at)))
    .map((payment) => {
      if (payment.status === "voided" || payment.applied_to_loan === false) {
        return { ...payment, payment_number: null, beginning_balance: null, interest_amount: null, principal_amount: null, ending_balance: null };
      }
      number += 1;
      const beginningBalanceCents = balance;
      const amountCents = toCents(payment.amount);
      const interestCents = Math.min(balance, interestForMonth(balance, aprBasisPoints));
      const principalCents = Math.min(balance, Math.max(0, amountCents - interestCents));
      const estimatedEndingCents = balance - principalCents;
      const officialCents = payment.official_balance_after_payment === null || payment.official_balance_after_payment === ""
        ? null
        : toCents(payment.official_balance_after_payment);
      balance = officialCents ?? estimatedEndingCents;
      return {
        ...payment,
        payment_number: number,
        beginning_balance: fromCents(beginningBalanceCents),
        interest_amount: fromCents(interestCents),
        principal_amount: fromCents(principalCents),
        ending_balance: fromCents(balance),
      };
    });
}

export function nextMonthlyDate(firstPaymentDate, completedPayments) {
  return isoDate(addMonthsClamped(firstPaymentDate, completedPayments));
}

export function monthsToWords(months) {
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (!years) return `${remainder} month${remainder === 1 ? "" : "s"}`;
  if (!remainder) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"}, ${remainder} month${remainder === 1 ? "" : "s"}`;
}

export function daysBetween(a, b) {
  return Math.round((parseLocalDate(b) - parseLocalDate(a)) / DAY_MS);
}
