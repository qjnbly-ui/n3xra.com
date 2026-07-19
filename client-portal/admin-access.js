const CACHE_KEY = "n3xra-platform-admin-access";
const CACHE_TTL = 15 * 60 * 1000;

export async function verifyPlatformAdmin(supabase, user) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
    if (cached.userId === user.id && cached.allowed && Date.now() - cached.checkedAt < CACHE_TTL) {
      return true;
    }
  } catch {
    sessionStorage.removeItem(CACHE_KEY);
  }

  const { data, error } = await supabase.functions.invoke("platform-admin", {
    body: { action: "get-platform-admin-access" },
  });
  const allowed = !error && !data?.error && Boolean(data?.admin);
  if (allowed) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      userId: user.id,
      allowed: true,
      checkedAt: Date.now(),
    }));
  }
  return allowed;
}
