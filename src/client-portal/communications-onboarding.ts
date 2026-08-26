import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { getStoredActiveOrganizationId, setStoredActiveOrganizationId } from "/shared/lib/orgs.js";
import { initializePortalBrandShell } from "./brand-shell.js";
import { portalLoginUrl } from "./tenant-context.js";

type OnboardingStatus = "draft" | "submitted" | "needs_changes" | "approved" | "provisioning" | "carrier_pending" | "active" | "rejected";

interface Workspace {
  id: string;
  organization_id: string;
  program_name: string;
  sender_name: string;
  website_url: string;
  privacy_policy_url: string;
  program_terms_url: string;
  support_email: string;
  support_phone: string | null;
  expected_message_frequency: string;
}

interface OnboardingRecord {
  id: string;
  status: OnboardingStatus;
  application: Record<string, unknown>;
  submitted_at: string | null;
  review_notes: string | null;
  updated_at: string;
}

const form = document.querySelector<HTMLFormElement>("#carrier-onboarding-form");
const saveButton = document.querySelector<HTMLButtonElement>("#save-onboarding");
const submitButton = document.querySelector<HTMLButtonElement>("#submit-onboarding");
const formStatus = document.querySelector<HTMLElement>("#onboarding-form-status");
const statusLabel = document.querySelector<HTMLElement>("#onboarding-status-label");
const updatedLabel = document.querySelector<HTMLElement>("#onboarding-updated");
const reviewNote = document.querySelector<HTMLElement>("#onboarding-review-note");
const programName = document.querySelector<HTMLElement>("#onboarding-program-name");
const keywordToggle = document.querySelector<HTMLInputElement>("#sms-keyword-enabled");
const keywordFields = document.querySelector<HTMLElement>("#keyword-fields");

let supabase: any;
let workspace: Workspace;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function setStatus(message: string, tone: "" | "success" | "error" = ""): void {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.dataset.tone = tone;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not saved yet" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function resolveOrganizationId(userId: string): Promise<string> {
  const stored = getStoredActiveOrganizationId();
  if (stored) {
    const [membershipResult, ownerResult] = await Promise.all([
      supabase.from("organization_memberships").select("organization_id,role").eq("organization_id", stored).eq("user_id", userId).eq("role", "account_admin").maybeSingle(),
      supabase.from("organizations").select("id").eq("id", stored).eq("owner_user_id", userId).maybeSingle(),
    ]);
    if (membershipResult.error) throw membershipResult.error;
    if (ownerResult.error) throw ownerResult.error;
    if (membershipResult.data?.organization_id || ownerResult.data?.id) return stored;
  }
  const [membershipResult, ownerResult] = await Promise.all([
    supabase.from("organization_memberships").select("organization_id,role").eq("user_id", userId).eq("role", "account_admin").limit(1).maybeSingle(),
    supabase.from("organizations").select("id").eq("owner_user_id", userId).limit(1).maybeSingle(),
  ]);
  if (membershipResult.error) throw membershipResult.error;
  if (ownerResult.error) throw ownerResult.error;
  const organizationId = text(membershipResult.data?.organization_id || ownerResult.data?.id);
  if (organizationId) setStoredActiveOrganizationId(organizationId);
  return organizationId;
}

function field(name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
  const control = form?.elements.namedItem(name);
  return control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement ? control : null;
}

function fieldValue(name: string): string {
  return text(field(name)?.value);
}

function checked(name: string): boolean {
  const control = field(name);
  return control instanceof HTMLInputElement && control.checked;
}

function setField(name: string, value: unknown): void {
  const control = field(name);
  if (!control) return;
  if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = Boolean(value);
  else control.value = text(value);
}

function applicationPayload(): Record<string, unknown> {
  const samples = [fieldValue("message_sample_1"), fieldValue("message_sample_2"), fieldValue("message_sample_3")].filter(Boolean);
  return {
    brand_type: fieldValue("brand_type"),
    legal_business_name: fieldValue("legal_business_name"),
    doing_business_as: fieldValue("doing_business_as"),
    business_type: fieldValue("business_type"),
    company_type: fieldValue("company_type"),
    business_industry: fieldValue("business_industry"),
    business_registration_identifier: fieldValue("business_registration_identifier"),
    business_registration_number: fieldValue("business_registration_number"),
    website_url: fieldValue("website_url"),
    social_media_profile_urls: fieldValue("social_media_profile_urls").split(/\r?\n/).map(text).filter(Boolean),
    business_regions_of_operation: ["USA_AND_CANADA"],
    business_identity: "direct_customer",
    address_street: fieldValue("address_street"),
    address_street_secondary: fieldValue("address_street_secondary"),
    address_city: fieldValue("address_city"),
    address_region: fieldValue("address_region").toUpperCase(),
    address_postal_code: fieldValue("address_postal_code"),
    address_country: fieldValue("address_country"),
    authorized_first_name: fieldValue("authorized_first_name"),
    authorized_last_name: fieldValue("authorized_last_name"),
    authorized_title: fieldValue("authorized_title"),
    authorized_position: fieldValue("authorized_position"),
    authorized_phone: fieldValue("authorized_phone"),
    authorized_email: fieldValue("authorized_email").toLowerCase(),
    brand_contact_email: fieldValue("brand_contact_email").toLowerCase(),
    campaign_use_case: fieldValue("campaign_use_case"),
    message_frequency: fieldValue("message_frequency"),
    estimated_subscribers: Number(fieldValue("estimated_subscribers") || 0),
    estimated_monthly_messages: Number(fieldValue("estimated_monthly_messages") || 0),
    campaign_description: fieldValue("campaign_description"),
    has_embedded_links: fieldValue("has_embedded_links") === "true",
    has_embedded_phone: fieldValue("has_embedded_phone") === "true",
    message_samples: samples,
    message_flow: fieldValue("message_flow"),
    opt_in_evidence_url: fieldValue("opt_in_evidence_url"),
    privacy_policy_url: fieldValue("privacy_policy_url"),
    terms_url: fieldValue("terms_url"),
    consent_optional_confirmed: checked("consent_optional_confirmed"),
    mobile_nonsharing_confirmed: checked("mobile_nonsharing_confirmed"),
    disclosure_confirmed: checked("disclosure_confirmed"),
    preferred_area_code: fieldValue("preferred_area_code"),
    sender_type: fieldValue("sender_type"),
    sms_keyword_enabled: checked("sms_keyword_enabled"),
    opt_in_keywords: fieldValue("opt_in_keywords").toUpperCase(),
    opt_in_message: fieldValue("opt_in_message"),
    twilio_opt_out: checked("twilio_opt_out"),
    authority_attested: checked("authority_attested"),
    accuracy_attested: checked("accuracy_attested"),
    carrier_fees_authorized: checked("carrier_fees_authorized"),
    signature_name: fieldValue("signature_name"),
    signature_title: fieldValue("signature_title"),
  };
}

function fillApplication(application: Record<string, unknown>): void {
  Object.entries(application).forEach(([name, value]) => {
    if (["message_samples", "social_media_profile_urls", "business_regions_of_operation"].includes(name)) return;
    setField(name, value);
  });
  const samples = Array.isArray(application.message_samples) ? application.message_samples : [];
  samples.slice(0, 3).forEach((sample, index) => setField(`message_sample_${index + 1}`, sample));
  const social = Array.isArray(application.social_media_profile_urls) ? application.social_media_profile_urls : [];
  setField("social_media_profile_urls", social.join("\n"));
  syncConditionalFields();
}

function prefillWorkspace(): void {
  setField("legal_business_name", workspace.sender_name);
  setField("website_url", workspace.website_url);
  setField("privacy_policy_url", workspace.privacy_policy_url);
  setField("terms_url", workspace.program_terms_url);
  setField("authorized_email", workspace.support_email);
  setField("brand_contact_email", workspace.support_email);
  setField("authorized_phone", workspace.support_phone || "");
  setField("message_frequency", workspace.expected_message_frequency);
}

function syncConditionalFields(): void {
  const standard = fieldValue("brand_type") === "standard";
  document.querySelectorAll<HTMLElement>("[data-standard-field]").forEach((element) => {
    element.hidden = !standard;
    element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach((control) => {
      control.required = standard;
    });
  });
  if (keywordFields) keywordFields.hidden = !Boolean(keywordToggle?.checked);
  keywordFields?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach((control) => {
    control.required = Boolean(keywordToggle?.checked);
  });
}

function renderRecord(record: OnboardingRecord | null): void {
  const status = record?.status || "draft";
  if (statusLabel) statusLabel.textContent = label(status);
  if (updatedLabel) updatedLabel.textContent = record ? `Updated ${formatDate(record.updated_at)}` : "Not saved yet";
  if (record?.application) fillApplication(record.application);
  const locked = ["submitted", "approved", "provisioning", "carrier_pending", "active", "rejected"].includes(status);
  form?.classList.toggle("is-locked", locked);
  form?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea").forEach((control) => {
    control.disabled = locked;
  });
  if (reviewNote) {
    reviewNote.hidden = !record?.review_notes;
    reviewNote.textContent = record?.review_notes || "";
  }
  if (status === "needs_changes") setStatus("N3XRA requested changes. Update the highlighted details and submit again.");
  else if (status === "submitted") setStatus(`Submitted ${formatDate(record?.submitted_at)}. N3XRA will review this before carrier registration.`, "success");
  else if (locked) setStatus(`This application is ${label(status).toLowerCase()}. N3XRA will contact you if anything else is needed.`, "success");
}

async function saveApplication(submit: boolean): Promise<void> {
  if (!form || !workspace) return;
  if (submit && !form.reportValidity()) {
    setStatus("Complete the highlighted required fields before submitting.", "error");
    return;
  }
  saveButton && (saveButton.disabled = true);
  submitButton && (submitButton.disabled = true);
  setStatus(submit ? "Submitting securely for review…" : "Saving your progress…");
  try {
    const { data, error } = await supabase.rpc("save_communications_carrier_onboarding", {
      input_workspace_id: workspace.id,
      input_application: applicationPayload(),
      input_submit: submit,
    });
    if (error) throw error;
    renderRecord(data as OnboardingRecord);
    setStatus(submit ? "Submitted securely. N3XRA will review the application before anything is sent to Twilio." : "Progress saved securely.", "success");
    if (submit) window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The onboarding details could not be saved.", "error");
  } finally {
    saveButton && (saveButton.disabled = false);
    submitButton && (submitButton.disabled = false);
  }
}

async function initialize(): Promise<void> {
  await initializePortalBrandShell();
  if (!hasConfig()) throw new Error("Secure onboarding is temporarily unavailable.");
  supabase = createBrowserSupabase();
  const session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace(portalLoginUrl());
    return;
  }
  const organizationId = await resolveOrganizationId(session.user.id);
  if (!organizationId) throw new Error("Account administrator access is required to complete texting onboarding.");
  const [workspaceResult, entitlementResult] = await Promise.all([
    supabase.from("communications_workspaces")
      .select("id,organization_id,program_name,sender_name,website_url,privacy_policy_url,program_terms_url,support_email,support_phone,expected_message_frequency")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("organization_product_entitlements")
      .select("status,portal_enabled")
      .eq("organization_id", organizationId)
      .eq("product_key", "communications")
      .maybeSingle(),
  ]);
  if (workspaceResult.error) throw workspaceResult.error;
  if (entitlementResult.error) throw entitlementResult.error;
  if (!workspaceResult.data) throw new Error("Your Communications workspace has not been created yet.");
  if (!entitlementResult.data?.portal_enabled || !["trialing", "active", "past_due"].includes(entitlementResult.data.status)) {
    throw new Error("Complete Communications billing before texting onboarding.");
  }
  workspace = workspaceResult.data as Workspace;
  if (programName) programName.textContent = `${workspace.program_name} texting setup`;
  prefillWorkspace();
  const { data, error } = await supabase.from("communications_carrier_onboarding")
    .select("id,status,application,submitted_at,review_notes,updated_at")
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (error) throw error;
  renderRecord((data || null) as OnboardingRecord | null);
  field("brand_type")?.addEventListener("change", syncConditionalFields);
  keywordToggle?.addEventListener("change", syncConditionalFields);
  saveButton?.addEventListener("click", () => void saveApplication(false));
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveApplication(true);
  });
  syncConditionalFields();
  document.body.classList.remove("carrier-onboarding-loading");
}

void initialize().catch((error: unknown) => {
  const layer = document.querySelector<HTMLElement>("#carrier-loading-status");
  if (layer) layer.textContent = error instanceof Error ? error.message : "Texting onboarding could not be opened.";
});
