import type { Capability, Intent, SessionIdentity, ToolResult } from "./contracts";

type JsonRecord = Record<string, unknown>;

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object")) : [];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function label(value: unknown): string {
  return String(value ?? "unknown").replaceAll("_", " ");
}

function date(value: unknown): string {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? "date unavailable" : parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });
}

function dollars(value: unknown): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
}

function freshness(result: ToolResult<unknown>): string {
  if (result.status === "cached" && result.recordedAt) return `Recorded ${date(result.recordedAt)}; live refresh is temporarily unavailable.`;
  if (result.status === "partial") return `Current as of ${date(result.fetchedAt)}; some sources were unavailable.`;
  return `Current as of ${date(result.fetchedAt)}.`;
}

function listLines(items: JsonRecord[], formatter: (item: JsonRecord) => string, empty: string): string {
  if (!items.length) return empty;
  return items.slice(0, 8).map((item, index) => `${index + 1}. ${formatter(item)}`).join("\n");
}

export function structuredSummary(capability: Capability, result: ToolResult<JsonRecord>): string {
  if (!result.data) return "";
  const data = result.data;
  switch (capability) {
    case "account": {
      const profile = record(data.profile);
      return `Verified account: ${label(profile.full_name || profile.email)}; status ${label(profile.account_status)}; plan ${label(profile.subscription_tier)}; organization ${label(profile.organization_name)}.`;
    }
    case "admin_overview":
      return `Accounts ${Number(data.accounts || 0)}; open support ${Number(data.openSupport || 0)}; career applications ${Number(data.careerApplications || 0)}; partner applications ${Number(data.partnerApplications || 0)}; creator applications ${Number(data.creatorApplications || 0)}; website requests ${Number(data.websiteRequests || 0)}; active website projects ${Number(data.activeWebsiteProjects || 0)}; unread notifications ${Number(data.unreadNotifications || 0)}.`;
    case "admin_accounts":
      return `Total accounts: ${Number(data.total || 0)}. Recent accounts:\n${listLines(rows(data.recent), (item) => `${label(item.full_name || item.email)} — ${label(item.account_status)}, ${label(item.subscription_tier)}`, "No accounts found.")}`;
    case "admin_applications":
      return `Career applications:\n${listLines(rows(data.careers), (item) => `${label(item.full_name)} — ${label(item.role_interest)}, ${label(item.status)} (${date(item.created_at)})`, "None received.")}\nPartner applications:\n${listLines(rows(data.partners), (item) => `${label(item.full_name)} — ${label(item.organization)}, ${label(item.status)} (${date(item.created_at)})`, "None received.")}\nCreator applications:\n${listLines(rows(data.creators), (item) => `${label(item.display_name || item.email)} — ${label(item.status)} (${date(item.created_at)})`, "None received.")}`;
    case "admin_support":
      return listLines(rows(data.open), (item) => `${label(item.subject)} — ${label(item.priority)} priority, ${label(item.status)}; from ${label(item.requester_name || item.requester_email)} (${date(item.created_at)})`, "There are no open support cases.");
    case "admin_notifications":
      return listLines(rows(data.unread), (item) => `${label(item.title)} — ${label(item.product)}, ${label(item.priority)} (${date(item.created_at)})`, "There are no unread admin notifications.");
    case "admin_websites":
      return `Recent requests:\n${listLines(rows(data.requests), (item) => `${label(item.business_name || item.contact_name)} — ${label(item.status)}, ${label(item.service_plan)} (${date(item.created_at)})`, "None.")}\nProjects:\n${listLines(rows(data.projects), (item) => `${label(item.name)} — ${label(item.status)}, ${label(item.current_stage)}, ${Number(item.progress_percent || 0)}%`, "None.")}\nProposals: ${rows(data.proposals).length}. Managed websites: ${rows(data.websites).length}.`;
    case "admin_billing":
      return `Subscriptions:\n${listLines(rows(data.subscriptions), (item) => `${label(item.service_plan)} — ${label(item.status)}, ${dollars(item.amount_cents)} ${label(item.billing_interval)}`, "None.")}\nWebsite invoices:\n${listLines(rows(data.websiteInvoices), (item) => `${label(item.status)} — ${dollars(item.total_cents)}, due ${date(item.due_at)}`, "None.")}\nFinancial operations invoices: ${rows(data.operationsInvoices).length}.`;
    case "admin_operations":
      return `Parties: ${rows(data.parties).length}; projects: ${rows(data.projects).length}; invoices: ${rows(data.invoices).length}; recent transactions:\n${listLines(rows(data.transactions), (item) => `${label(item.description || item.category)} — ${dollars(item.amount_cents)}, ${label(item.status)} (${date(item.transaction_date)})`, "None.")}`;
    default:
      return "";
  }
}

export function deterministicAnswer(intent: Intent, result: ToolResult<JsonRecord> | null, identity: SessionIdentity): string | null {
  if (!result || !result.data || !["current", "cached", "partial"].includes(result.status)) return null;
  if (intent.requiresAdmin && identity.audience !== "admin") return null;
  const summary = structuredSummary(intent.capability, result);
  return summary ? `${summary}\n\n${freshness(result)}` : null;
}

export function describeFreshness(result: ToolResult<unknown> | null): string | null {
  return result?.data ? freshness(result) : null;
}
