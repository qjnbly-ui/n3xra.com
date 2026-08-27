import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { portalLoginUrl, resolvePortalTenant, scopeWebsitesToPortalTenant } from "./tenant-context.js";

interface Website { id: string; name: string; organization_id: string | null }
interface Member { id: string; user_id: string; role: string; full_name: string; email: string; is_owner: boolean; created_at: string }
interface Invite { id: string; code: string; recipient_email: string; recipient_name: string | null; role: string; created_at: string; expires_at: string; last_sent_at: string | null; revoked_at: string | null; is_disabled: boolean; redeemed_uses: number; max_uses: number }
interface TeamSnapshot { organization: { id: string; name: string; owner_user_id: string }; can_manage: boolean; current_user_id: string; members: Member[]; invites: Invite[] }

const screen = document.querySelector<HTMLElement>("#portal-status");
const team = document.querySelector<HTMLElement>("#client-team");
const message = document.querySelector<HTMLElement>("#team-message");
const memberList = document.querySelector<HTMLElement>("#team-member-list");
const inviteList = document.querySelector<HTMLElement>("#team-invite-list");
const inviteForm = document.querySelector<HTMLFormElement>("#team-invite-form");
const supabase = createBrowserSupabase();
let organizationId = "";
let snapshot: TeamSnapshot | null = null;

const escapeHtml = (value: unknown): string => String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const roleLabel = (role: string): string => role === "account_admin" ? "Administrator" : role === "editor" ? "Editor" : "View only";
const initials = (name: string, email: string): string => (name || email).split(/[\s@]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";
const formatDate = (value: string): string => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

function showMessage(copy = "", error = false): void {
  if (!message) return;
  message.textContent = copy;
  message.classList.toggle("is-error", error);
}

function storedWebsiteId(userId: string): string {
  try {
    const value = JSON.parse(localStorage.getItem("n3xra-client-workspace-context") || "{}");
    return !value.userId || value.userId === userId ? String(value.websiteId || "") : "";
  } catch { return ""; }
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

async function sendInviteEmail(invite: { id: string }): Promise<void> {
  const { data, error } = await supabase.functions.invoke("send-client-team-invite", { body: { inviteId: invite.id, portalOrigin: window.location.origin } });
  if (error || data?.error) throw new Error(String(data?.error || error?.message || "The invitation email could not be sent."));
}

function renderMembers(): void {
  if (!snapshot || !memberList) return;
  const summary = document.querySelector<HTMLElement>("#team-member-summary");
  if (summary) summary.textContent = `${snapshot.members.length} ${snapshot.members.length === 1 ? "person has" : "people have"} access to ${snapshot.organization.name}.`;
  memberList.innerHTML = snapshot.members.map((member) => {
    const protectedMember = member.is_owner || member.user_id === snapshot?.current_user_id;
    const access = member.is_owner ? "Account owner" : roleLabel(member.role);
    const controls = snapshot?.can_manage && !protectedMember
      ? `<div class="client-team-actions"><select aria-label="Access level for ${escapeHtml(member.full_name || member.email)}" data-member-role="${escapeHtml(member.id)}"><option value="viewer"${member.role === "viewer" ? " selected" : ""}>View only</option><option value="editor"${member.role === "editor" ? " selected" : ""}>Editor</option><option value="account_admin"${member.role === "account_admin" ? " selected" : ""}>Administrator</option></select><button class="client-team-action is-danger" type="button" data-remove-member="${escapeHtml(member.id)}">Remove</button></div>`
      : `<div class="client-team-actions"><span class="client-team-badge">${member.is_owner ? "Protected owner" : "Your access"}</span></div>`;
    return `<article class="client-team-row"><div class="client-team-person"><span class="client-team-avatar" aria-hidden="true">${escapeHtml(initials(member.full_name, member.email))}</span><div class="client-team-person-copy"><strong>${escapeHtml(member.full_name || member.email)}</strong><span>${escapeHtml(member.email)}</span></div></div><div class="client-team-access"><strong>${escapeHtml(access)}</strong><span class="client-team-meta">Added ${escapeHtml(formatDate(member.created_at))}</span></div>${controls}</article>`;
  }).join("");
}

function renderInvites(): void {
  if (!snapshot || !inviteList) return;
  const panel = document.querySelector<HTMLElement>("#team-invites-panel");
  if (!snapshot.can_manage) { if (panel) panel.hidden = true; return; }
  if (panel) panel.hidden = false;
  const pending = snapshot.invites.filter((invite) => !invite.is_disabled && !invite.revoked_at && invite.redeemed_uses < invite.max_uses && new Date(invite.expires_at).getTime() > Date.now());
  inviteList.innerHTML = pending.length ? pending.map((invite) => `<article class="client-team-row"><div class="client-team-person"><span class="client-team-avatar" aria-hidden="true">${escapeHtml(initials(invite.recipient_name || "", invite.recipient_email))}</span><div class="client-team-person-copy"><strong>${escapeHtml(invite.recipient_name || invite.recipient_email)}</strong><span>${escapeHtml(invite.recipient_email)}</span></div></div><div class="client-team-access"><strong>${escapeHtml(roleLabel(invite.role))}</strong><span class="client-team-meta">Expires ${escapeHtml(formatDate(invite.expires_at))}</span></div><div class="client-team-actions"><button class="client-team-action" type="button" data-resend-invite="${escapeHtml(invite.id)}">Resend</button><button class="client-team-action is-danger" type="button" data-revoke-invite="${escapeHtml(invite.id)}">Cancel</button></div></article>`).join("") : '<p class="client-team-empty">There are no pending invitations.</p>';
}

async function loadSnapshot(): Promise<void> {
  snapshot = await rpc<TeamSnapshot>("client_portal_team_snapshot", { input_organization_id: organizationId });
  const invitePanel = document.querySelector<HTMLElement>("#team-invite-panel");
  if (invitePanel) invitePanel.hidden = !snapshot.can_manage;
  renderMembers();
  renderInvites();
  showMessage();
}

async function init(): Promise<void> {
  if (!hasConfig() || !supabase) throw new Error("Portal configuration is unavailable.");
  const session = await getSessionOrNull(supabase);
  if (!session?.user) { window.location.replace(portalLoginUrl()); return; }
  const tenant = await resolvePortalTenant(supabase);
  const { data, error } = await supabase.from("client_websites").select("id,name,organization_id").order("name");
  if (error) throw error;
  const websites = scopeWebsitesToPortalTenant((data || []) as Website[], tenant);
  const requestedOrganizationId = new URLSearchParams(window.location.search).get("organization");
  const requestedWebsiteId = storedWebsiteId(session.user.id);
  const website = websites.find((item) => item.organization_id === requestedOrganizationId)
    || websites.find((item) => item.id === requestedWebsiteId)
    || websites[0];
  organizationId = String(website?.organization_id || "");
  if (!organizationId) throw new Error("Team access has not been connected to this organization yet.");
  await loadSnapshot();
  document.body.classList.remove("portal-loading");
  if (screen) screen.hidden = true;
  team?.setAttribute("aria-busy", "false");
}

inviteForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const button = inviteForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    const values = new FormData(inviteForm);
    if (button) { button.disabled = true; button.textContent = "Sending…"; }
    showMessage("Creating the secure invitation…");
    try {
      const invite = await rpc<{ id: string }>("client_portal_create_team_invite", { input_organization_id: organizationId, input_recipient_email: String(values.get("email") || ""), input_recipient_name: String(values.get("name") || ""), input_role: String(values.get("role") || "viewer") });
      await sendInviteEmail(invite);
      inviteForm.reset();
      await loadSnapshot();
      showMessage("Invitation sent.");
    } catch (error) { showMessage(error instanceof Error ? error.message : "The invitation could not be sent.", true); }
    finally { if (button) { button.disabled = false; button.textContent = "Send invitation"; } }
  })();
});

team?.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-member-role]");
  if (!select) return;
  void (async () => {
    select.disabled = true;
    showMessage("Updating access…");
    try { await rpc("client_portal_update_team_member", { input_membership_id: select.dataset.memberRole, input_role: select.value }); await loadSnapshot(); showMessage("Access updated."); }
    catch (error) { showMessage(error instanceof Error ? error.message : "Access could not be updated.", true); await loadSnapshot(); }
  })();
});

team?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const remove = target.closest<HTMLButtonElement>("[data-remove-member]");
  const resend = target.closest<HTMLButtonElement>("[data-resend-invite]");
  const revoke = target.closest<HTMLButtonElement>("[data-revoke-invite]");
  if (!remove && !resend && !revoke) return;
  void (async () => {
    const button = remove || resend || revoke;
    if (!button) return;
    if (remove && !window.confirm("Remove this person’s access to the client account?")) return;
    if (revoke && !window.confirm("Cancel this invitation?")) return;
    button.disabled = true;
    try {
      if (remove) await rpc("client_portal_remove_team_member", { input_membership_id: remove.dataset.removeMember });
      if (revoke) await rpc("client_portal_revoke_team_invite", { input_invite_id: revoke.dataset.revokeInvite });
      if (resend) { const invite = await rpc<{ id: string }>("client_portal_resend_team_invite", { input_invite_id: resend.dataset.resendInvite }); await sendInviteEmail(invite); }
      await loadSnapshot();
      showMessage(remove ? "Team member removed." : revoke ? "Invitation canceled." : "Invitation resent.");
    } catch (error) { showMessage(error instanceof Error ? error.message : "The change could not be completed.", true); button.disabled = false; }
  })();
});

void init().catch((error: unknown) => {
  document.body.classList.remove("portal-loading");
  const copy = error instanceof Error ? error.message : "Team access could not be opened.";
  showMessage(copy, true);
  team?.setAttribute("aria-busy", "false");
  if (screen) screen.hidden = true;
});
