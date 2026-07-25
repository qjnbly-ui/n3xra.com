import {
  createBrowserSupabase,
  getSessionOrNull,
  hasConfig,
} from "/shared/lib/supabase-client.js";

const panel = document.getElementById("ownership-panel");
const loading = document.getElementById("ownership-loading");
const form = document.getElementById("ownership-form");
const fullNameInput = document.getElementById("ownership-full-name");
const emailInput = document.getElementById("ownership-email");
const connectionInput = document.getElementById("ownership-connection");
const emailUpdatesInput = document.getElementById("ownership-email-updates");
const toggleStatusButton = document.getElementById("ownership-toggle-status");
const message = document.getElementById("ownership-message");
const stateTitle = document.getElementById("ownership-state-title");
const stateCopy = document.getElementById("ownership-state-copy");
const statusValue = document.getElementById("ownership-status-value");
const submittedValue = document.getElementById("ownership-submitted-value");
const emailUpdatesValue = document.getElementById("ownership-email-updates-value");
const signOutButton = document.getElementById("ownership-sign-out");

let supabase = null;
let session = null;
let profile = null;

function setMessage(text = "", isError = false) {
  message.textContent = text;
  message.className = `admin-status${isError ? " error" : text ? " success" : ""}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function render() {
  const active = profile.status === "interested";
  stateTitle.textContent = active ? "Interest recorded" : "Interest withdrawn";
  stateCopy.textContent = active
    ? "We’ll keep you informed as N3XRA’s company and ownership plans develop."
    : "You are no longer on the ownership-update list. You can rejoin at any time.";
  statusValue.textContent = active ? "Interested" : "Withdrawn";
  submittedValue.textContent = formatDate(profile.submitted_at);
  emailUpdatesValue.textContent = profile.email_updates ? "Enabled" : "Disabled";
  fullNameInput.value = profile.full_name || "";
  emailInput.value = profile.email || session.user.email || "";
  connectionInput.value = profile.connection_type || "";
  emailUpdatesInput.checked = Boolean(profile.email_updates);
  toggleStatusButton.textContent = active ? "Withdraw interest" : "Rejoin updates";
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("investment_interest_profiles")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    window.location.replace("/invest/#ownership-updates");
    return;
  }
  profile = data;
  render();
  panel.hidden = false;
  loading.hidden = true;
}

async function saveProfile(event) {
  event.preventDefault();
  setMessage("Saving…");
  const { data, error } = await supabase
    .from("investment_interest_profiles")
    .update({
      full_name: fullNameInput.value.trim(),
      email: String(session.user.email || "").trim().toLowerCase(),
      connection_type: connectionInput.value || null,
      email_updates: emailUpdatesInput.checked,
    })
    .eq("user_id", session.user.id)
    .select()
    .single();
  if (error) {
    setMessage(error.message, true);
    return;
  }
  profile = data;
  render();
  setMessage("Your information is updated.");
}

async function toggleStatus() {
  const rejoining = profile.status === "withdrawn";
  toggleStatusButton.disabled = true;
  setMessage(rejoining ? "Rejoining…" : "Withdrawing…");
  const { data, error } = await supabase
    .from("investment_interest_profiles")
    .update({
      status: rejoining ? "interested" : "withdrawn",
      withdrawn_at: rejoining ? null : new Date().toISOString(),
      email_updates: rejoining ? emailUpdatesInput.checked : false,
    })
    .eq("user_id", session.user.id)
    .select()
    .single();
  toggleStatusButton.disabled = false;
  if (error) {
    setMessage(error.message, true);
    return;
  }
  profile = data;
  render();
  setMessage(rejoining ? "You’re back on the ownership-update list." : "Your interest has been withdrawn.");
}

async function init() {
  if (!hasConfig()) throw new Error("Ownership Updates is temporarily unavailable.");
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace("/account/?next=%2Faccount%2Finvestment%2F");
    return;
  }
  form.addEventListener("submit", saveProfile);
  toggleStatusButton.addEventListener("click", toggleStatus);
  signOutButton.addEventListener("click", async () => {
    await supabase.auth.signOut({ scope: "local" });
    window.location.replace("/account/");
  });
  await loadProfile();
}

init().catch((error) => {
  loading.textContent = error?.message || "Ownership Updates could not be opened.";
});
