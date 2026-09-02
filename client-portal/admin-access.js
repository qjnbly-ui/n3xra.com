const CACHE_KEY = "n3xra-platform-admin-access";
const CACHE_TTL = 15 * 60 * 1000;
const CACHE_VERSION = 3;

function readCachedAccess(user) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
    if (cached.version === CACHE_VERSION && cached.userId === user?.id && cached.admin && Date.now() - cached.checkedAt < CACHE_TTL) {
      return cached.admin;
    }
  } catch {
    sessionStorage.removeItem(CACHE_KEY);
  }
  return null;
}

export function clearPlatformAdminAccessCache() {
  sessionStorage.removeItem(CACHE_KEY);
}

export async function getPlatformAdminAccess(supabase, user, { force = false } = {}) {
  if (!supabase || !user?.id) return null;
  if (!force) {
    const cached = readCachedAccess(user);
    if (cached) return cached;
  }

  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action: "get-platform-admin-access" },
  });
  const admin = !error && !data?.error ? data?.admin || null : null;
  if (admin) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      userId: user.id,
      allowed: true,
      admin,
      checkedAt: Date.now(),
    }));
  }
  return admin;
}

export async function verifyPlatformAdmin(supabase, user, options) {
  return Boolean(await getPlatformAdminAccess(supabase, user, options));
}
