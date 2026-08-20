import Stripe from "https://esm.sh/stripe@18.3.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { STRIPE_API_VERSION, corsHeaders } from "./stripe-billing.ts";

export const WEBSITE_APP = "n3xra_websites";
export type SupabaseClient = ReturnType<typeof createClient>;

export function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Website billing is not configured.");
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient() });
}

export function clients(request: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !anon || !service) throw new Error("Supabase billing configuration is missing.");
  const authorization = request.headers.get("Authorization") || "";
  return {
    user: createClient(url, anon, { global: { headers: { Authorization: authorization } } }),
    admin: createClient(url, service, { auth: { persistSession: false } }),
  };
}

export async function requireUser(request: Request) {
  const pair = clients(request);
  const { data, error } = await pair.user.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required.");
  return { ...pair, authUser: data.user };
}

export async function requireAdmin(request: Request) {
  const context = await requireUser(request);
  const { data, error } = await context.user.rpc("is_platform_admin");
  if (error || data !== true) throw new Error("Platform administrator access required.");
  return context;
}

export function response(body: Record<string, unknown>, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

export function originFor(request: Request) {
  const configured = Deno.env.get("APP_ORIGIN") || "https://www.n3xra.com";
  const incoming = request.headers.get("Origin");
  if (!incoming) return configured;
  try {
    const url = new URL(incoming);
    if (url.hostname === "n3xra.com" || url.hostname.endsWith(".n3xra.com") || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return url.origin;
    }
  } catch {
    // Use the configured origin.
  }
  return configured;
}

export function websiteMetadata(values: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries({ app: WEBSITE_APP, ...values })
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([key, value]) => [key, String(value)])
  );
}

export function priceEnvironment(plan: string, interval: string, amountCents?: number) {
  const names: Record<string, string> = {
    "starter:monthly": "STRIPE_PRICE_WEBSITE_STARTER_MONTHLY",
    "starter:yearly": "STRIPE_PRICE_WEBSITE_STARTER_YEARLY",
    "starter_plus:monthly": "STRIPE_PRICE_WEBSITE_STARTER_PLUS_MONTHLY",
    "starter_plus:yearly": "STRIPE_PRICE_WEBSITE_STARTER_PLUS_YEARLY",
    "advanced:monthly": "STRIPE_PRICE_WEBSITE_ADVANCED_MONTHLY",
    "advanced:yearly": "STRIPE_PRICE_WEBSITE_ADVANCED_YEARLY",
  };
  if (plan === "starter_plus" && amountCents === 3500 && interval === "monthly") {
    return Deno.env.get("STRIPE_PRICE_WEBSITE_STARTER_PLUS_ROOTS_MONTHLY") || "";
  }
  if (plan === "starter_plus" && amountCents === 37800 && interval === "yearly") {
    return Deno.env.get("STRIPE_PRICE_WEBSITE_STARTER_PLUS_ROOTS_YEARLY") || "";
  }
  const name = names[`${plan}:${interval}`];
  return name ? Deno.env.get(name) || "" : "";
}

export function websiteServiceAmount(plan: string, interval: string, acceptedAmountCents: number) {
  if (!["monthly", "yearly"].includes(interval)) return 0;
  if (plan === "starter_plus" && [3500, 37800].includes(acceptedAmountCents)) {
    return interval === "yearly" ? 37800 : 3500;
  }
  const catalog: Record<string, Record<string, number>> = {
    starter: { monthly: 2500, yearly: 27000 },
    starter_plus: { monthly: 4000, yearly: 43200 },
    advanced: { monthly: 5000, yearly: 54000 },
  };
  const acceptedCatalogAmounts = Object.values(catalog[plan] || {});
  if (!acceptedCatalogAmounts.includes(acceptedAmountCents)) return 0;
  return catalog[plan]?.[interval] || 0;
}

export function snapshotItemPriceEnvironment(
  item: { category?: string; recurring_interval?: string; total_amount_cents?: number },
  servicePlan: string,
) {
  const category = String(item.category || "");
  const interval = String(item.recurring_interval || "");
  const amountCents = Number(item.total_amount_cents || 0);
  if (category === "domain" && interval === "yearly" && amountCents === 3000) {
    return Deno.env.get("STRIPE_PRICE_WEBSITE_DOMAIN_YEARLY") || "";
  }
  if (category === "maintenance" || category === "hosting") {
    return priceEnvironment(servicePlan, interval, amountCents);
  }
  return "";
}

export function knownWebsitePriceIds() {
  return [
    "STRIPE_PRICE_WEBSITE_STARTER_MONTHLY",
    "STRIPE_PRICE_WEBSITE_STARTER_YEARLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_MONTHLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_YEARLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_ROOTS_MONTHLY",
    "STRIPE_PRICE_WEBSITE_STARTER_PLUS_ROOTS_YEARLY",
    "STRIPE_PRICE_WEBSITE_ADVANCED_MONTHLY",
    "STRIPE_PRICE_WEBSITE_ADVANCED_YEARLY",
    "STRIPE_PRICE_WEBSITE_DOMAIN_YEARLY",
  ].map((name) => Deno.env.get(name)).filter(Boolean) as string[];
}

export function subscriptionPeriod(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return {
    start: subscription.current_period_start || item?.current_period_start || null,
    end: subscription.current_period_end || item?.current_period_end || subscription.cancel_at || null,
  };
}

export function mapSubscriptionStatus(status: Stripe.Subscription.Status) {
  if (status === "incomplete_expired") return "canceled";
  if (status === "active" || status === "trialing" || status === "past_due" || status === "unpaid" || status === "paused" || status === "canceled") return status;
  return "incomplete";
}

export async function notifyAdmin(admin: SupabaseClient, title: string, message: string, metadata: Record<string, unknown> = {}) {
  await admin.from("admin_notifications").insert({
    event_type: "website_billing",
    product: "websites",
    priority: "important",
    title,
    summary: message,
    message_text: message,
    metadata,
  }).then(() => undefined).catch(() => undefined);
}
