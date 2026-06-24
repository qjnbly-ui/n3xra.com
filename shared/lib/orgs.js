export const PLATFORM_ADMIN_EMAILS = ["quentin@n3xra.com", "quentin@quentinnichols.com"];
export const PLATFORM_ADMIN_EMAIL = PLATFORM_ADMIN_EMAILS[0];
export const ACTIVE_ORG_STORAGE_KEY = "records-active-organization-id";
export const MEMBERSHIP_ROLE_ORDER = ["account_admin", "editor", "viewer"];

export function isPlatformAdminEmail(email) {
  return PLATFORM_ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
}

export function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function normalizeMembershipRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "account_owner") {
    return "account_admin";
  }
  return MEMBERSHIP_ROLE_ORDER.includes(normalized) ? normalized : "viewer";
}

export function formatRoleLabel(role) {
  if (String(role || "").trim().toLowerCase() === "billing_owner") {
    return "Owner";
  }
  return titleCase(normalizeMembershipRole(role));
}

export function isBillingOwner(membership, currentUserId, isPlatformAdmin = false) {
  return isPlatformAdmin || membership?.organization?.owner_user_id === currentUserId;
}

export function getMembershipRole(membership) {
  return normalizeMembershipRole(membership?.role);
}

export function getCapabilities(membership, currentUserId, isPlatformAdmin = false) {
  const role = getMembershipRole(membership);
  const billingOwner = isBillingOwner(membership, currentUserId, isPlatformAdmin);
  const subscriptionTier = String(membership?.organization?.subscription_tier || "").trim().toLowerCase();
  const canManageMembers = isPlatformAdmin || role === "account_admin";
  const canManageLibrarySettings = isPlatformAdmin || role === "account_admin";
  const canManageDocuments = isPlatformAdmin || role === "account_admin" || role === "editor";
  const canManageTemplates = isPlatformAdmin || role === "account_admin";
  const canUseRecordings = isPlatformAdmin || subscriptionTier === "organization";

  return {
    role,
    isPlatformAdmin,
    isBillingOwner: billingOwner,
    canViewLibrary: Boolean(membership),
    canManageMembers,
    canManageInvites: canManageMembers,
    canManageLibrarySettings,
    canManageDocuments,
    canUploadDocuments: canManageDocuments,
    canEditDocuments: canManageDocuments,
    canDeleteDocuments: canManageDocuments,
    canManageTemplates,
    canShareDocuments: Boolean(membership),
    canDownloadDocuments: Boolean(membership),
    canUseRecordings,
    canManageBilling: billingOwner,
    canTransferOwnership: billingOwner,
  };
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

export function resolveActiveOrganization(memberships, preferredOrganizationId = "", options = {}) {
  const list = Array.isArray(memberships) ? memberships : [];
  if (!list.length) return null;
  const preferStored = options.preferStored !== false;

  if (!preferStored) {
    const fromPreferred = list.find((item) => item.organization?.id === preferredOrganizationId);
    if (fromPreferred) return fromPreferred;
  }

  const storedId = getStoredActiveOrganizationId();
  const fromStored = list.find((item) => item.organization?.id === storedId);
  if (fromStored) return fromStored;

  const fromPreferred = list.find((item) => item.organization?.id === preferredOrganizationId);
  if (fromPreferred) return fromPreferred;

  return list[0];
}

export function buildMembershipMap(memberships) {
  return (Array.isArray(memberships) ? memberships : []).map((membership) => ({
    ...membership,
    organization: Array.isArray(membership.organization) ? membership.organization[0] : membership.organization,
  }));
}

export function dedupeMembershipsByOrganization(memberships) {
  const list = Array.isArray(memberships) ? memberships : [];
  const roleRank = {
    account_admin: 0,
    editor: 1,
    viewer: 2,
  };

  const byOrg = new Map();
  list.forEach((membership) => {
    const orgId = membership?.organization?.id;
    if (!orgId) return;

    const existing = byOrg.get(orgId);
    if (!existing) {
      byOrg.set(orgId, membership);
      return;
    }

    const existingRank = roleRank[normalizeMembershipRole(existing.role)] ?? 99;
    const nextRank = roleRank[normalizeMembershipRole(membership.role)] ?? 99;
    if (nextRank < existingRank) {
      byOrg.set(orgId, { ...membership, role: normalizeMembershipRole(membership.role) });
    }
  });

  return Array.from(byOrg.values()).map((membership) => ({
    ...membership,
    role: normalizeMembershipRole(membership.role),
  }));
}
