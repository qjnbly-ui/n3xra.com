import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
import { initializePortalBrandShell } from "./brand-shell.js";
import { isBrandedPortalHostname, portalLoginUrl } from "./tenant-context.js";
const statusLayer = document.querySelector("#communications-status");
function escapeHtml(value) {
    return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
function formatPhone(value) {
    const match = value.match(/^\+1([0-9]{3})([0-9]{3})([0-9]{4})$/);
    return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
}
function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element)
        element.textContent = value;
}
function safeHttpsUrl(value) {
    if (typeof value !== "string" || !value.trim())
        return "";
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.toString() : "";
    }
    catch {
        return "";
    }
}
function showFatal(message) {
    if (statusLayer)
        statusLayer.textContent = message;
}
async function resolveOrganizationId(supabase, userId) {
    const stored = getStoredActiveOrganizationId();
    if (stored) {
        const [membershipResult, entitlementResult] = await Promise.all([
            supabase.from("organization_memberships")
                .select("organization_id")
                .eq("organization_id", stored)
                .eq("user_id", userId)
                .maybeSingle(),
            supabase.from("organization_product_entitlements")
                .select("organization_id")
                .eq("organization_id", stored)
                .eq("product_key", "communications")
                .eq("portal_enabled", true)
                .in("status", ["trialing", "active", "past_due"])
                .maybeSingle(),
        ]);
        if (membershipResult.error)
            throw membershipResult.error;
        if (entitlementResult.error)
            throw entitlementResult.error;
        if (membershipResult.data?.organization_id && entitlementResult.data?.organization_id)
            return stored;
    }
    const { data, error } = await supabase
        .from("organization_product_entitlements")
        .select("organization_id")
        .eq("product_key", "communications")
        .eq("portal_enabled", true)
        .in("status", ["trialing", "active", "past_due"])
        .limit(1)
        .maybeSingle();
    if (error)
        throw error;
    const organizationId = String(data?.organization_id || "");
    if (organizationId)
        setStoredActiveOrganizationId(organizationId);
    return organizationId;
}
function renderTopics(topics, metrics) {
    const list = document.querySelector("#communications-topics");
    if (!list)
        return;
    const counts = new Map();
    metrics.forEach((metric) => counts.set(metric.topic_id, Number(metric.subscriber_count || 0)));
    list.innerHTML = topics.length ? topics.map((topic) => `<div class="communications-topic"><div><strong>${escapeHtml(topic.name)}</strong>${topic.description ? `<small>${escapeHtml(topic.description)}</small>` : ""}</div><span>${counts.get(topic.id) || 0}</span></div>`).join("") : `<p class="communications-empty">No subscriber topics are configured yet.</p>`;
}
function renderSubscribers(subscribers, topics, choices, total) {
    const rows = document.querySelector("#subscriber-rows");
    const empty = document.querySelector("#subscribers-empty");
    if (!rows || !empty)
        return;
    const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
    const subscriberTopics = new Map();
    choices.forEach((choice) => {
        const name = topicNames.get(choice.topic_id);
        if (!name)
            return;
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
function renderActivity(events) {
    const list = document.querySelector("#message-activity");
    if (!list)
        return;
    list.innerHTML = events.length ? events.slice(0, 20).map((event) => `<div class="communications-activity-row"><strong>${escapeHtml(event.direction === "inbound" ? "Received" : "Sent")}</strong><span>${escapeHtml(event.body_preview || `${event.channel.toUpperCase()} message`)}</span><small>${escapeHtml(formatDate(event.occurred_at))} · ${escapeHtml(event.status)}</small></div>`).join("") : `<p class="communications-empty">No message activity has been recorded yet.</p>`;
}
function renderJoinTools(workspace, number, keywords, sources) {
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
    const qr = document.querySelector("#signup-qr");
    const download = document.querySelector("#download-qr");
    if (qr)
        qr.src = qrUrl;
    if (download)
        download.href = `${qrUrl}&download=1`;
    setText("#keyword-list", keywords.length ? keywords.map((item) => item.keyword).join(", ") : "Not configured");
    setText("#keyword-instruction", keywords.length && number?.phone_e164 ? `Text to ${formatPhone(number.phone_e164)}` : "Available after texting activation");
    document.querySelector("#copy-signup-url")?.addEventListener("click", async (event) => {
        if (!signupUrl.startsWith("https://"))
            return;
        await navigator.clipboard.writeText(signupUrl);
        event.currentTarget.textContent = "Copied";
    });
}
async function initialize() {
    document.body.classList.add(isBrandedPortalHostname() ? "communications-tenant-surface" : "communications-n3xra-surface");
    await initializePortalBrandShell();
    if (!hasConfig())
        throw new Error("Communications is temporarily unavailable.");
    const supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(portalLoginUrl());
        return;
    }
    const organizationId = await resolveOrganizationId(supabase, session.user.id);
    if (!organizationId)
        throw new Error("Your account does not have a Communications workspace.");
    const requestedWorkspace = String(new URLSearchParams(window.location.search).get("workspace") || "").trim().toLowerCase();
    let workspaceQuery = supabase.from("communications_workspaces").select("id,organization_id,slug,program_name,sender_name,website_url,status,included_sms_segments,sms_overage_cents,mms_unit_cents").eq("organization_id", organizationId).order("created_at", { ascending: true }).limit(1);
    if (requestedWorkspace)
        workspaceQuery = workspaceQuery.eq("slug", requestedWorkspace);
    const { data: workspaceRows, error: workspaceError } = await workspaceQuery;
    if (workspaceError)
        throw workspaceError;
    const workspace = ((workspaceRows || [])[0] || null);
    if (!workspace)
        throw new Error("Your Communications setup has not been created yet.");
    const subscriberPage = Math.max(0, Number.parseInt(new URLSearchParams(window.location.search).get("subscriber_page") || "0", 10) || 0);
    const pageSize = 50;
    const [numberResult, topicsResult, topicMetricsResult, keywordsResult, subscribersResult, metricsResult, messagesResult, sourcesResult, onboardingResult] = await Promise.all([
        supabase.from("communications_numbers").select("id,phone_e164,status,carrier_registration_status,texting_activated_at").eq("workspace_id", workspace.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("communications_topics").select("id,name,description,active").eq("workspace_id", workspace.id).eq("active", true).order("sort_order"),
        supabase.from("communications_topic_metrics").select("topic_id,subscriber_count").eq("workspace_id", workspace.id),
        supabase.from("communications_keywords").select("keyword,topic_id").eq("workspace_id", workspace.id).eq("active", true).order("keyword"),
        supabase.from("communications_subscribers").select("id,full_name,phone_e164,email,sms_status,email_status,joined_at").eq("workspace_id", workspace.id).order("joined_at", { ascending: false }).range(subscriberPage * pageSize, subscriberPage * pageSize + pageSize - 1),
        supabase.from("communications_workspace_metrics").select("total_subscribers,sms_subscribers,email_subscribers,active_topics,consent_events,message_events,sms_segments_current_month").eq("workspace_id", workspace.id).maybeSingle(),
        supabase.from("communications_message_events").select("channel,direction,status,sms_segment_count,billable_units,body_preview,occurred_at").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(20),
        supabase.from("communications_signup_sources").select("source_type,public_token,metadata").eq("workspace_id", workspace.id).eq("status", "active").in("source_type", ["website_embed", "hosted_signup", "qr_campaign"]),
        supabase.from("communications_carrier_onboarding").select("status,review_notes,updated_at").eq("workspace_id", workspace.id).maybeSingle(),
    ]);
    for (const result of [numberResult, topicsResult, topicMetricsResult, keywordsResult, subscribersResult, metricsResult, messagesResult, sourcesResult, onboardingResult])
        if (result.error)
            throw result.error;
    const number = numberResult.data;
    const topics = (topicsResult.data || []);
    const keywords = keywordsResult.data || [];
    const subscribers = (subscribersResult.data || []);
    const subscriberIds = subscribers.map((subscriber) => subscriber.id);
    const choicesResult = subscriberIds.length
        ? await supabase.from("communications_subscriber_topics").select("subscriber_id,topic_id").in("subscriber_id", subscriberIds)
        : { data: [], error: null };
    if (choicesResult.error)
        throw choicesResult.error;
    const choices = (choicesResult.data || []);
    const messages = (messagesResult.data || []);
    const metrics = (metricsResult.data || { total_subscribers: 0, sms_subscribers: 0, email_subscribers: 0, active_topics: 0, consent_events: 0, message_events: 0, sms_segments_current_month: 0 });
    const smsSegments = Number(metrics.sms_segments_current_month || 0);
    const usagePercent = workspace.included_sms_segments > 0 ? Math.round((smsSegments / workspace.included_sms_segments) * 100) : 0;
    const onboarding = onboardingResult.data;
    setText("#communications-title", workspace.program_name);
    setText("#communications-number", number?.phone_e164 ? formatPhone(number.phone_e164) : "Provisioning");
    setText("#communications-number-status", number ? `${number.carrier_registration_status.replaceAll("_", " ")} · ${number.status}` : workspace.status.replaceAll("_", " "));
    setText("#metric-subscribers", String(metrics.total_subscribers));
    setText("#metric-subscribers-detail", `${metrics.sms_subscribers} text · ${metrics.email_subscribers} email`);
    setText("#metric-sms", `${smsSegments} / ${workspace.included_sms_segments}`);
    setText("#metric-sms-detail", `${Math.max(0, workspace.included_sms_segments - smsSegments)} included segments remaining`);
    setText("#metric-topics", String(metrics.active_topics));
    setText("#metric-consent", String(metrics.consent_events));
    const onboardingCard = document.querySelector("#communications-onboarding-card");
    const textingReady = Boolean(number?.texting_activated_at && number?.status === "active" && ["approved", "registered"].includes(number?.carrier_registration_status));
    if (onboardingCard && !textingReady) {
        onboardingCard.hidden = false;
        if (onboarding?.status === "submitted") {
            setText("#communications-onboarding-title", "Carrier application under review");
            setText("#communications-onboarding-copy", "N3XRA has your business and campaign details. Nothing will be submitted to Twilio until the application is reviewed.");
            setText("#communications-onboarding-link", "Review submission");
        }
        else if (["approved", "provisioning", "carrier_pending"].includes(onboarding?.status)) {
            setText("#communications-onboarding-title", onboarding.status === "carrier_pending" ? "Carrier registration pending" : "Texting setup in progress");
            setText("#communications-onboarding-copy", "Your onboarding details are locked while N3XRA completes number and carrier setup.");
            setText("#communications-onboarding-link", "View status");
        }
        else if (onboarding?.status === "needs_changes") {
            setText("#communications-onboarding-title", "Texting onboarding needs changes");
            setText("#communications-onboarding-copy", onboarding.review_notes || "Review N3XRA’s note, update the requested details, and submit again.");
            setText("#communications-onboarding-link", "Update onboarding");
        }
    }
    const alert = document.querySelector("#communications-usage-alert");
    if (alert && usagePercent >= 75) {
        alert.hidden = false;
        alert.textContent = usagePercent >= 100 ? `You have used all ${workspace.included_sms_segments} included SMS segments. Additional usage is $${(workspace.sms_overage_cents / 100).toFixed(2)} per segment.` : `You have used ${usagePercent}% of this month’s included SMS segments.`;
    }
    renderJoinTools(workspace, number, keywords, (sourcesResult.data || []));
    renderTopics(topics, (topicMetricsResult.data || []));
    renderSubscribers(subscribers, topics, choices, Number(metrics.total_subscribers || 0));
    renderActivity(messages);
    document.body.classList.remove("communications-loading");
}
void initialize().catch((error) => {
    console.error("Communications workspace failed to load.", error);
    showFatal(error instanceof Error ? error.message : "Communications could not be opened.");
});
