const VALID_SURFACES = new Set(["public", "account", "admin", "codebase", "records"]);

export function normalizeAiFollowUps(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const prompt = String(item || "").replace(/\s+/g, " ").trim().slice(0, 110);
    const key = prompt.toLowerCase();
    if (!prompt || seen.has(key)) return [];
    seen.add(key);
    return [prompt];
  }).slice(0, 3);
}

export async function requestAiFollowUps({ question, answer, surface = "public", token = "" } = {}) {
  const resolvedSurface = VALID_SURFACES.has(surface) ? surface : "public";
  const response = await fetch("/api/ai-follow-ups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({ question, answer, surface: resolvedSurface }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error || "Follow-up questions are unavailable."));
  return normalizeAiFollowUps(data?.followUps);
}
