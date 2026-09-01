import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { initializePortalBrandShell } from "./brand-shell.js";
import { isBrandedPortalHostname, portalLoginUrl } from "./tenant-context.js";
import { resolveSelectedCommunicationsOrganization } from "./communications-organization.js";

interface Workspace {
  id: string; organization_id: string; slug: string; program_name: string; sender_name: string;
  website_url: string;
  status: string; plan_key: string; included_sms_segments: number; included_email_deliveries: number;
  sms_overage_cents: number; mms_unit_cents: number; email_overage_per_1000_cents: number;
}
interface Subscriber { id: string; full_name: string | null; phone_e164: string | null; email: string | null; sms_status: string; email_status: string; joined_at: string; }
interface Topic { id: string; name: string; description: string | null; active: boolean; }
interface TopicChoice { subscriber_id: string; topic_id: string; }
interface MessageEvent { channel: string; direction: string; status: string; sms_segment_count: number; billable_units: number; body_preview: string | null; occurred_at: string; }
interface WorkspaceMetrics { total_subscribers: number; sms_subscribers: number; email_subscribers: number; active_topics: number; consent_events: number; message_events: number; sms_segments_current_month: number; email_deliveries_current_month: number; outbound_mms_current_month: number; }
interface SignupSource { source_type: string; public_token: string; metadata?: Record<string, unknown> | null; }
interface TopicMetric { topic_id: string; subscriber_count: number; }
interface ChannelState { channel: "sms" | "email"; status: string; }

const statusLayer = document.querySelector<HTMLElement>("#communications-status");

function escapeHtml(value: unknown): string {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function formatPhone(value: string): string {
  const match = value.match(/^\+1([0-9]{3})([0-9]{3})([0-9]{4})$/);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function safeHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function showFatal(message: string): void {
  if (statusLayer) statusLayer.textContent = message;
}

function renderTopics(topics: Topic[], metrics: TopicMetric[]): void {
  const list = document.querySelector<HTMLElement>("#communications-topics");
  if (!list) return;
  const counts = new Map<string, number>();
  metrics.forEach((metric) => counts.set(metric.topic_id, Number(metric.subscriber_count || 0)));
  list.innerHTML = topics.length ? topics.map((topic) => `<div class="communications-topic"><div><strong>${escapeHtml(topic.name)}</strong>${topic.description ? `<small>${escapeHtml(topic.description)}</small>` : ""}</div><span>${counts.get(topic.id) || 0}</span></div>`).join("") : `<p class="communications-empty">No subscriber topics are configured yet.</p>`;
}

function renderSubscribers(subscribers: Subscriber[], topics: Topic[], choices: TopicChoice[], total: number): void {
  const rows = document.querySelector<HTMLElement>("#subscriber-rows");
  const empty = document.querySelector<HTMLElement>("#subscribers-empty");
  if (!rows || !empty) return;
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const subscriberTopics = new Map<string, string[]>();
  choices.forEach((choice) => {
    const name = topicNames.get(choice.topic_id);
    if (!name) return;
    subscriberTopics.set(choice.subscriber_id, [...(subscriberTopics.get(choice.subscriber_id) || []), name]);
  });
  rows.innerHTML = subscribers.slice(0, 50).map((subscriber) => {
    const displayName = subscriber.full_name || subscriber.email || subscriber.phone_e164 || "Subscriber";
    const secondary = [subscriber.phone_e164 ? formatPhone(subscriber.phone_e164) : "", subscriber.email || ""].filter((item) => item && item !== displayName).join(" · ");
    const channels = [
      subscriber.sms_status === "subscribed" ? `<span class="communications-channel">Text</span>` : subscriber.sms_status === "unsubscribed" ? `<span class="communications-channel is-off">Text off</span>` : "",
      subscriber.email_status === "subscribed" ? `<span class="communications-channel">Email</span>` : subscriber.email_status === "unsubscribed" ? `<span class="communications-channel is-off">Email off</span>` : "",
    ].join("");
    return `<tr><td class="communications-subscriber-name"><strong>${escapeHtml(displayName)}</strong>${secondary ? `<small>${escapeHtml(secondary)}</small>` : ""}</td><td>${channels || "—"}</td><td>${escapeHtml((subscriberTopics.get(subscriber.id) || []).join(", ") || "All updates")}</td><td>${escapeHtml(formatDate(subscriber.joined_at))}</td></tr>`;
  }).join("");
  empty.hidden = subscribers.length > 0;
  setText("#subscriber-table-count", `${total} total`);
}

function renderActivity(events: MessageEvent[]): void {
  const list = document.querySelector<HTMLElement>("#message-activity");
  if (!list) return;
  list.innerHTML = events.length ? events.slice(0, 20).map((event) => `<div class="communications-activity-row"><strong>${escapeHtml(event.direction === "inbound" ? "Received" : "Sent")}</strong><span>${escapeHtml(event.body_preview || `${event.channel.toUpperCase()} message`)}</span><small>${escapeHtml(formatDate(event.occurred_at))} · ${escapeHtml(event.status)}</small></div>`).join("") : `<p class="communications-empty">No message activity has been recorded yet.</p>`;
}

function renderJoinTools(workspace: Workspace, number: any, keywords: any[], sources: SignupSource[]): void {
  const hostedSource = sources.find((source) => source.source_type === "hosted_signup");
  const nativeSource = sources.find((source) => source.source_type === "website_embed")
    || sources.find((source) => source.source_type === "qr_campaign");
  const nativeLandingUrl = safeHttpsUrl(nativeSource?.metadata?.landing_url);
  const fallbackWebsiteUrl = safeHttpsUrl(workspace.website_url);
  const hostedSignupUrl = hostedSource
    ? `${window.location.origin}/nexra-communications/subscribe/?workspace=${encodeURIComponent(workspace.slug)}&source=${encodeURIComponent(hostedSource.public_token)}`
    : "";
  const signupUrl = isBrandedPortalHostname()
    ? nativeLandingUrl || fallbackWebsiteUrl || hostedSignupUrl || "Signup source not configured"
    : hostedSignupUrl || nativeLandingUrl || fallbackWebsiteUrl || "Signup source not configured";
  const qrUrl = `/api/communications-qr?workspace=${encodeURIComponent(workspace.slug)}`;
  setText("#signup-url", signupUrl);
  const qr = document.querySelector<HTMLImageElement>("#signup-qr");
  const download = document.querySelector<HTMLAnchorElement>("#download-qr");
  if (qr) qr.src = qrUrl;
  if (download) download.href = `${qrUrl}&download=1`;
  setText("#keyword-list", keywords.length ? keywords.map((item) => item.keyword).join(", ") : "Not configured");
  setText("#keyword-instruction", keywords.length && number?.phone_e164 ? `Text to ${formatPhone(number.phone_e164)}` : "Available after texting activation");
  document.querySelector<HTMLButtonElement>("#copy-signup-url")?.addEventListener("click", async (event) => {
    if (!signupUrl.startsWith("https://")) return;
    await navigator.clipboard.writeText(signupUrl);
    (event.currentTarget as HTMLButtonElement).textContent = "Copied";
  });
}

function setupComposer(
  session: any,
  workspace: Workspace,
  organizationName: string,
  topics: Topic[],
  topicMetrics: TopicMetric[],
  metrics: WorkspaceMetrics,
  number: any,
  channelStates: ChannelState[],
  emailDomain: any,
  senderRole: string,
  isPlatformAdmin: boolean,
): void {
  setText("#communications-organization-name", organizationName || workspace.sender_name || workspace.program_name);
  const form = document.querySelector<HTMLFormElement>("#communications-compose-form");
  const audience = document.querySelector<HTMLSelectElement>("#communications-audience");
  const subjectField = document.querySelector<HTMLElement>("#communications-subject-field");
  const subject = document.querySelector<HTMLInputElement>("#communications-subject");
  const message = document.querySelector<HTMLTextAreaElement>("#communications-message");
  const status = document.querySelector<HTMLElement>("#communications-send-status");
  const readiness = document.querySelector<HTMLElement>("#communications-delivery-readiness");
  const button = document.querySelector<HTMLButtonElement>("#communications-send-button");
  const channelInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="channel"]')];
  if (!form || !audience || !subjectField || !subject || !message || !status || !readiness || !button) return;

  const topicCounts = new Map(topicMetrics.map((metric) => [metric.topic_id, Number(metric.subscriber_count || 0)]));
  audience.innerHTML = `<option value="">All subscribed people (${Number(metrics.total_subscribers || 0)})</option>${topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.name)} (${topicCounts.get(topic.id) || 0})</option>`).join("")}`;
  const smsState = channelStates.find((channel) => channel.channel === "sms");
  const emailState = channelStates.find((channel) => channel.channel === "email");
  const smsReady = smsState?.status === "active" && number?.status === "active" && Boolean(number?.texting_activated_at) && ["approved", "registered"].includes(number?.carrier_registration_status);
  const emailReady = emailState?.status === "active" && emailDomain?.status === "verified";
  channelInputs.forEach((input) => {
    input.disabled = input.value === "sms" ? !smsReady : !emailReady;
    input.closest("label")?.toggleAttribute("title", input.disabled);
  });
  readiness.textContent = smsReady && emailReady ? "Text and email ready" : smsReady ? "Text ready · Email setup pending" : emailReady ? "Email ready · Text setup pending" : "Delivery setup is still pending";
  readiness.classList.toggle("is-limited", !smsReady || !emailReady);

  if (!isPlatformAdmin && !["account_admin", "editor"].includes(senderRole)) {
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input,select,textarea,button").forEach((control) => { control.disabled = true; });
    status.textContent = "Ask an organization account administrator to give you editor access before sending updates.";
    return;
  }

  const updateFormState = (): void => {
    const selectedChannels = channelInputs.filter((input) => input.checked).map((input) => input.value);
    const includesEmail = selectedChannels.includes("email");
    subjectField.hidden = !includesEmail;
    subject.required = includesEmail;
    const selectedTopic = audience.selectedOptions[0]?.textContent || "this audience";
    status.className = "";
    status.textContent = selectedChannels.length
      ? `Ready to send by ${selectedChannels.map((channel) => channel === "sms" ? "text" : "email").join(" and ")} to eligible subscribers in ${selectedTopic}.`
      : "Choose a channel and audience to see who can receive this update.";
  };
  channelInputs.forEach((input) => input.addEventListener("change", updateFormState));
  audience.addEventListener("change", updateFormState);
  message.addEventListener("input", () => setText("#communications-character-count", String(message.value.length)));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const channels = channelInputs.filter((input) => input.checked && !input.disabled).map((input) => input.value);
    if (!channels.length) {
      status.className = "is-error";
      status.textContent = "Choose at least one delivery channel that is ready.";
      return;
    }
    if (!form.reportValidity()) return;
    const confirmed = window.confirm(`Send this update now to every eligible subscriber in ${audience.selectedOptions[0]?.textContent || "the selected audience"}?`);
    if (!confirmed) return;
    button.disabled = true;
    button.textContent = "Sending…";
    status.className = "";
    status.textContent = "Preparing the consent-eligible audience and sending your update…";
    try {
      const response = await fetch("/api/communications-send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspaceId: workspace.id,
          topicId: audience.value || null,
          channels,
          subject: subject.value.trim(),
          message: message.value.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "This update could not be sent.");
      status.className = result.failedCount ? "is-error" : "is-success";
      status.textContent = result.failedCount
        ? `${result.sentCount} deliveries were sent; ${result.failedCount} could not be delivered. Review setup and try those subscribers again later.`
        : `${result.sentCount} ${result.sentCount === 1 ? "delivery was" : "deliveries were"} sent successfully.`;
      form.reset();
      subjectField.hidden = true;
      setText("#communications-character-count", "0");
      window.setTimeout(() => window.location.reload(), 1800);
    } catch (error) {
      status.className = "is-error";
      status.textContent = error instanceof Error ? error.message : "This update could not be sent.";
    } finally {
      button.disabled = false;
      button.textContent = "Send update";
    }
  });
  updateFormState();
}

async function initialize(): Promise<void> {
  document.body.classList.add(isBrandedPortalHostname() ? "communications-tenant-surface" : "communications-n3xra-surface");
  await initializePortalBrandShell();
  if (!hasConfig()) throw new Error("Communications is temporarily unavailable.");
  const supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(portalLoginUrl());
    return;
  }
  const organizationId = await resolveSelectedCommunicationsOrganization(supabase, session.user.id);
  if (!organizationId) throw new Error("Communications is not active for the selected organization. Open Billing to activate it.");
  const requestedWorkspace = String(new URLSearchParams(window.location.search).get("workspace") || "").trim().toLowerCase();
  let workspaceQuery = supabase.from("communications_workspaces").select("id,organization_id,slug,program_name,sender_name,website_url,status,plan_key,included_sms_segments,included_email_deliveries,sms_overage_cents,mms_unit_cents,email_overage_per_1000_cents").eq("organization_id", organizationId).order("created_at", { ascending: true }).limit(1);
  if (requestedWorkspace) workspaceQuery = workspaceQuery.eq("slug", requestedWorkspace);
  const { data: workspaceRows, error: workspaceError } = await workspaceQuery;
  if (workspaceError) throw workspaceError;
  const workspace = ((workspaceRows || [])[0] || null) as Workspace | null;
  if (!workspace) throw new Error("Your Communications setup has not been created yet.");

  const subscriberPage = Math.max(0, Number.parseInt(new URLSearchParams(window.location.search).get("subscriber_page") || "0", 10) || 0);
  const pageSize = 50;
  const [numberResult, topicsResult, topicMetricsResult, keywordsResult, subscribersResult, metricsResult, messagesResult, sourcesResult, onboardingResult, organizationResult, channelsResult, emailDomainResult, senderAccessResult, platformAdminResult] = await Promise.all([
    supabase.from("communications_numbers").select("id,phone_e164,status,carrier_registration_status,texting_activated_at").eq("workspace_id", workspace.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("communications_topics").select("id,name,description,active").eq("workspace_id", workspace.id).eq("active", true).order("sort_order"),
    supabase.from("communications_topic_metrics").select("topic_id,subscriber_count").eq("workspace_id", workspace.id),
    supabase.from("communications_keywords").select("keyword,topic_id").eq("workspace_id", workspace.id).eq("active", true).order("keyword"),
    supabase.from("communications_subscribers").select("id,full_name,phone_e164,email,sms_status,email_status,joined_at").eq("workspace_id", workspace.id).order("joined_at", { ascending: false }).range(subscriberPage * pageSize, subscriberPage * pageSize + pageSize - 1),
    supabase.from("communications_workspace_metrics").select("total_subscribers,sms_subscribers,email_subscribers,active_topics,consent_events,message_events,sms_segments_current_month,email_deliveries_current_month,outbound_mms_current_month").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("communications_message_events").select("channel,direction,status,sms_segment_count,billable_units,body_preview,occurred_at").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(20),
    supabase.from("communications_signup_sources").select("source_type,public_token,metadata").eq("workspace_id", workspace.id).eq("status", "active").in("source_type", ["website_embed", "hosted_signup", "qr_campaign"]),
    supabase.from("communications_carrier_onboarding").select("status,review_notes,updated_at").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    supabase.from("communications_channels").select("channel,status").eq("workspace_id", workspace.id),
    supabase.from("communications_sending_domains").select("status").eq("workspace_id", workspace.id).eq("provider", "resend").eq("status", "verified").limit(1).maybeSingle(),
    supabase.from("organization_product_member_access").select("role,status").eq("organization_id", organizationId).eq("product_key", "communications").eq("user_id", session.user.id).eq("status", "active").maybeSingle(),
    supabase.rpc("is_platform_admin"),
  ]);
  for (const result of [numberResult, topicsResult, topicMetricsResult, keywordsResult, subscribersResult, metricsResult, messagesResult, sourcesResult, onboardingResult, organizationResult, channelsResult, emailDomainResult, senderAccessResult, platformAdminResult]) if (result.error) throw result.error;

  const number = numberResult.data;
  const topics = (topicsResult.data || []) as Topic[];
  const keywords = keywordsResult.data || [];
  const subscribers = (subscribersResult.data || []) as Subscriber[];
  const subscriberIds = subscribers.map((subscriber) => subscriber.id);
  const choicesResult = subscriberIds.length
    ? await supabase.from("communications_subscriber_topics").select("subscriber_id,topic_id").in("subscriber_id", subscriberIds)
    : { data: [], error: null };
  if (choicesResult.error) throw choicesResult.error;
  const choices = (choicesResult.data || []) as TopicChoice[];
  const messages = (messagesResult.data || []) as MessageEvent[];
  const metrics = (metricsResult.data || { total_subscribers: 0, sms_subscribers: 0, email_subscribers: 0, active_topics: 0, consent_events: 0, message_events: 0, sms_segments_current_month: 0, email_deliveries_current_month: 0, outbound_mms_current_month: 0 }) as WorkspaceMetrics;
  const smsSegments = Number(metrics.sms_segments_current_month || 0);
  const emailDeliveries = Number(metrics.email_deliveries_current_month || 0);
  const smsUsagePercent = workspace.included_sms_segments > 0 ? Math.round((smsSegments / workspace.included_sms_segments) * 100) : 0;
  const emailUsagePercent = workspace.included_email_deliveries > 0 ? Math.round((emailDeliveries / workspace.included_email_deliveries) * 100) : 0;
  const usagePercent = Math.max(smsUsagePercent, emailUsagePercent);
  const onboarding = onboardingResult.data;

  setText("#communications-title", workspace.program_name);
  setText("#communications-number", number?.phone_e164 ? formatPhone(number.phone_e164) : "Provisioning");
  setText("#communications-number-status", number ? `${number.carrier_registration_status.replaceAll("_", " ")} · ${number.status}` : workspace.status.replaceAll("_", " "));
  setText("#metric-subscribers", String(metrics.total_subscribers));
  setText("#metric-subscribers-detail", `${metrics.sms_subscribers} text · ${metrics.email_subscribers} email`);
  const planName = workspace.plan_key === "plus" ? "Plus" : workspace.plan_key === "basic" ? "Basic" : "Founding";
  setText("#metric-plan", planName);
  setText("#metric-plan-detail", `${workspace.included_sms_segments.toLocaleString()} SMS · ${workspace.included_email_deliveries.toLocaleString()} emails included`);
  setText("#metric-sms", `${smsSegments} / ${workspace.included_sms_segments}`);
  setText("#metric-sms-detail", `${Math.max(0, workspace.included_sms_segments - smsSegments)} included segments remaining`);
  setText("#metric-email", `${emailDeliveries.toLocaleString()} / ${workspace.included_email_deliveries.toLocaleString()}`);
  setText("#metric-email-detail", `${Math.max(0, workspace.included_email_deliveries - emailDeliveries).toLocaleString()} included deliveries remaining`);
  setText("#metric-mms", Number(metrics.outbound_mms_current_month || 0).toLocaleString());
  setText("#metric-topics", String(metrics.active_topics));
  setText("#metric-consent", String(metrics.consent_events));
  const onboardingCard = document.querySelector<HTMLElement>("#communications-onboarding-card");
  const textingReady = Boolean(number?.texting_activated_at && number?.status === "active" && ["approved", "registered"].includes(number?.carrier_registration_status));
  if (onboardingCard && !textingReady) {
    onboardingCard.hidden = false;
    if (onboarding?.status === "submitted") {
      setText("#communications-onboarding-title", "Carrier application under review");
      setText("#communications-onboarding-copy", "N3XRA has your business and campaign details. Nothing will be submitted to Twilio until the application is reviewed.");
      setText("#communications-onboarding-link", "Review submission");
    } else if (["approved", "provisioning", "carrier_pending"].includes(onboarding?.status)) {
      setText("#communications-onboarding-title", onboarding.status === "carrier_pending" ? "Carrier registration pending" : "Texting setup in progress");
      setText("#communications-onboarding-copy", "Your onboarding details are locked while N3XRA completes number and carrier setup.");
      setText("#communications-onboarding-link", "View status");
    } else if (onboarding?.status === "needs_changes") {
      setText("#communications-onboarding-title", "Texting onboarding needs changes");
      setText("#communications-onboarding-copy", onboarding.review_notes || "Review N3XRA’s note, update the requested details, and submit again.");
      setText("#communications-onboarding-link", "Update onboarding");
    }
  }
  const alert = document.querySelector<HTMLElement>("#communications-usage-alert");
  if (alert && usagePercent >= 75) {
    alert.hidden = false;
    if (smsUsagePercent >= emailUsagePercent) {
      alert.textContent = usagePercent >= 100 ? `You have used all ${workspace.included_sms_segments.toLocaleString()} included SMS segments. Additional usage is $${(workspace.sms_overage_cents / 100).toFixed(2)} per segment.` : `You have used ${usagePercent}% of this month’s included SMS segments.`;
    } else {
      alert.textContent = usagePercent >= 100 ? `You have used all ${workspace.included_email_deliveries.toLocaleString()} included email deliveries. Additional usage is $${(workspace.email_overage_per_1000_cents / 100).toFixed(2)} per 1,000 emails.` : `You have used ${usagePercent}% of this month’s included email deliveries.`;
    }
  }
  renderJoinTools(workspace, number, keywords, (sourcesResult.data || []) as SignupSource[]);
  renderTopics(topics, (topicMetricsResult.data || []) as TopicMetric[]);
  renderSubscribers(subscribers, topics, choices, Number(metrics.total_subscribers || 0));
  renderActivity(messages);
  setupComposer(
    session,
    workspace,
    String(organizationResult.data?.name || ""),
    topics,
    (topicMetricsResult.data || []) as TopicMetric[],
    metrics,
    number,
    (channelsResult.data || []) as ChannelState[],
    emailDomainResult.data,
    String(senderAccessResult.data?.role || ""),
    platformAdminResult.data === true,
  );
  document.body.classList.remove("communications-loading");

}

void initialize().catch((error: unknown) => {
  console.error("Communications workspace failed to load.", error);
  showFatal(error instanceof Error ? error.message : "Communications could not be opened.");
});
