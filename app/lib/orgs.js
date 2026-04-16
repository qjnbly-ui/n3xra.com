export const PLATFORM_ADMIN_EMAIL = "quentin@quentinnichols.com";
export const ACTIVE_ORG_STORAGE_KEY = "records-active-organization-id";

export function isPlatformAdminEmail(email) {
  return String(email || "").trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
}

export function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatRoleLabel(role) {
  return titleCase(role || "viewer");
}

export function canManageMembers(role, isPlatformAdmin = false) {
  return isPlatformAdmin || ["account_owner", "account_admin"].includes(role);
}

export function canManageLibrary(role, isPlatformAdmin = false) {
  return isPlatformAdmin || ["account_owner", "account_admin", "editor"].includes(role);
}

export function canManageBilling(role, isPlatformAdmin = false) {
  return isPlatformAdmin || role === "account_owner";
}

export function getStoredActiveOrganizationId() {
  return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || "";
}

export function setStoredActiveOrganizationId(organizationId) {
  if (!organizationId) {
    window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, organizationId);
}

export function resolveActiveOrganization(memberships, preferredOrganizationId = "") {
  const list = Array.isArray(memberships) ? memberships : [];
  if (!list.length) return null;

  const fromPreferred = list.find((item) => item.organization?.id === preferredOrganizationId);
  if (fromPreferred) return fromPreferred;

  const storedId = getStoredActiveOrganizationId();
  const fromStored = list.find((item) => item.organization?.id === storedId);
  if (fromStored) return fromStored;

  const owned = list.find((item) => item.role === "account_owner");
  return owned || list[0];
}

export function buildMembershipMap(memberships) {
  return (Array.isArray(memberships) ? memberships : []).map((membership) => ({
    ...membership,
    organization: Array.isArray(membership.organization) ? membership.organization[0] : membership.organization,
  }));
}
