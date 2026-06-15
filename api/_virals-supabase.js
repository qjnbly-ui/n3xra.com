const { getBearerToken, verifySupabaseUser } = require("./_music-supabase");

const VIRALS_SUPABASE_URL = String(process.env.VIRALS_SUPABASE_URL || "").replace(/\/+$/, "");
const VIRALS_SUPABASE_SERVICE_ROLE_KEY = String(process.env.VIRALS_SUPABASE_SERVICE_ROLE_KEY || "").trim();

class ViralsSupabaseError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = "ViralsSupabaseError";
    this.status = status;
    this.data = data;
  }
}

function hasViralsSupabaseConfig() {
  return Boolean(VIRALS_SUPABASE_URL && VIRALS_SUPABASE_SERVICE_ROLE_KEY);
}

function serviceHeaders(extra = {}) {
  return {
    apikey: VIRALS_SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${VIRALS_SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = String(data?.message || data?.error || data?.msg || `Virals Supabase request failed with status ${response.status}.`);
    throw new ViralsSupabaseError(message, response.status, data);
  }

  return data;
}

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function tableUrl(table, query = "") {
  return `${VIRALS_SUPABASE_URL}/rest/v1/${table}${query}`;
}

async function insertRow(table, payload) {
  const rows = await fetchJson(tableUrl(table), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return firstRow(rows);
}

async function ensureViralsProfile(user) {
  if (!user?.id) return null;
  const rows = await fetchJson(tableUrl("virals_profiles", "?on_conflict=user_id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      user_id: user.id,
      display_name: cleanString(user.user_metadata?.full_name || user.user_metadata?.name || user.email || "", 160) || null,
    }),
  });
  return firstRow(rows);
}

async function saveCreator(video) {
  const handle = cleanString(video?.author?.uniqueId, 160);
  if (!handle) return null;
  const rows = await fetchJson(tableUrl("virals_creators", "?on_conflict=platform,handle"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      platform: "tiktok",
      handle,
      display_name: cleanString(video?.author?.nickname, 220) || null,
      follower_count: Number(video?.author?.followerCount || 0) || null,
      profile_url: handle ? `https://www.tiktok.com/@${handle}` : null,
      raw_metadata: video?.author || {},
    }),
  });
  return firstRow(rows);
}

async function saveVideo(user, video, input = {}) {
  const payload = {
    master_user_id: user.id,
    source_url: cleanString(video?.url || input.url, 700),
    platform: "tiktok",
    external_video_id: cleanString(video?.videoId, 160) || null,
    title: cleanString(video?.caption || "Untitled TikTok", 300),
    description: cleanString(video?.caption, 1200) || null,
    creator_name: cleanString(video?.author?.nickname, 220) || null,
    creator_handle: cleanString(video?.author?.uniqueId, 160) || null,
    thumbnail_url: cleanString(video?.coverUrl || video?.dynamicCoverUrl, 1000) || null,
    duration_seconds: Number(video?.durationSeconds || 0) || null,
    metrics: video?.stats || {},
    raw_metadata: video || {},
  };
  return insertRow("virals_videos", payload);
}

async function saveTranscript(videoRow, video) {
  if (!videoRow?.id || !video?.transcript) return null;
  return insertRow("virals_transcripts", {
    video_id: videoRow.id,
    transcript_text: cleanString(video.transcript, 50000),
    transcript_segments: [],
    language: "en",
    source: cleanString(video.transcriptSource || video.transcriptFormat || "tiktok_subtitles", 120),
  });
}

async function saveProduct(product = {}) {
  const name = cleanString(product.name || "Detected product", 180);
  if (!name) return null;
  return insertRow("virals_products", {
    name,
    platform: "tiktok",
    shop_product_id: cleanString(product.shopProductId, 160) || null,
    product_url: cleanString(product.productUrl, 1000) || null,
    category: cleanString(product.category, 120) || null,
    niche: cleanString(product.category, 120) || null,
    offer: cleanString(product.offer, 320) || null,
    confidence: cleanString(product.confidence, 60) || null,
    data_source: cleanString(product.source, 120) || null,
    claims: Array.isArray(product.claims) ? product.claims : [],
    objections: Array.isArray(product.objections) ? product.objections : [],
    proof_points: Array.isArray(product.proofPoints) ? product.proofPoints : [],
    cta_path: cleanString(product.ctaPath, 1000) || null,
    api_readiness: cleanString(product.apiReadiness, 1000) || null,
    raw_metadata: product,
  });
}

async function linkVideoProduct(videoRow, productRow, product = {}) {
  if (!videoRow?.id || !productRow?.id) return null;
  return insertRow("virals_video_products", {
    video_id: videoRow.id,
    product_id: productRow.id,
    relationship_source: cleanString(product.source || "resolver", 120),
    confidence: cleanString(product.confidence, 60) || null,
  });
}

async function saveAnalysis(user, videoRow, analysis = {}, model = "") {
  if (!videoRow?.id) return null;
  return insertRow("virals_ai_analyses", {
    video_id: videoRow.id,
    master_user_id: user.id,
    status: "completed",
    summary: cleanString(analysis.formula, 1200) || null,
    hook: cleanString(analysis.hookType, 300) || null,
    hook_breakdown: {
      hookType: analysis.hookType,
      formula: analysis.formula,
      hooks: analysis.hooks || [],
      transcriptHook: analysis.transcriptBreakdown?.hook || "",
    },
    structure_breakdown: {
      body: analysis.body,
      transcriptBodyStructure: analysis.transcriptBreakdown?.bodyStructure || "",
      keep: analysis.keep,
      change: analysis.change,
    },
    emotional_triggers: analysis.triggers || [],
    engagement_drivers: analysis.productIntelligence?.proofPoints || [],
    audience_targeting: {
      niche: analysis.niche,
      goal: analysis.goal,
      product: analysis.product,
    },
    strengths: analysis.productIntelligence?.claims || [],
    weaknesses: analysis.productIntelligence?.objections || [],
    why_it_works: cleanString(analysis.conversionPattern, 1200) || null,
    improvement_notes: cleanString(analysis.change, 1000) || null,
    model: cleanString(model, 120) || null,
  });
}

async function saveGeneratedOutputs(user, analysisRow, analysis = {}) {
  if (!analysisRow?.id) return;
  const hooks = Array.isArray(analysis.hooks) ? analysis.hooks : [];
  const scripts = Array.isArray(analysis.scripts) ? analysis.scripts : [];
  const captions = Array.isArray(analysis.captions) ? analysis.captions : [];

  await Promise.all([
    ...hooks.slice(0, 12).map((hook) =>
      insertRow("virals_generated_hooks", {
        analysis_id: analysisRow.id,
        hook_type: cleanString(analysis.hookType || "Generated", 120),
        hook_text: cleanString(hook, 1200),
      }).catch(() => null)
    ),
    ...scripts.slice(0, 5).map((script) =>
      insertRow("virals_generated_scripts", {
        analysis_id: analysisRow.id,
        master_user_id: user.id,
        script_type: cleanString(script.title || "Generated Script", 120),
        title: cleanString(script.title || "Generated Script", 160),
        script_text: cleanString(script.text, 5000),
        platform: "tiktok",
        status: "saved",
      }).catch(() => null)
    ),
    ...captions.slice(0, 6).map((caption) =>
      insertRow("virals_generated_captions", {
        analysis_id: analysisRow.id,
        caption_text: cleanString(caption, 1200),
        platform: "tiktok",
      }).catch(() => null)
    ),
  ]);
}

async function saveUsageEvent(user, event = {}) {
  if (!user?.id) return null;
  return insertRow("virals_usage_events", {
    user_id: user.id,
    event_type: event.event_type || "single_analysis",
    analysis_id: event.analysis_id || null,
    video_id: event.video_id || null,
    input_count: Number(event.input_count || 1) || 1,
    model: cleanString(event.model, 120) || null,
    prompt_tokens: Number(event.prompt_tokens || 0) || 0,
    completion_tokens: Number(event.completion_tokens || 0) || 0,
    total_tokens: Number(event.total_tokens || 0) || 0,
  });
}

async function saveViralsAnalysis({ user, input, video, analysis, model, usage }) {
  if (!hasViralsSupabaseConfig() || !user?.id || !video || !analysis) return null;

  await ensureViralsProfile(user);
  await saveCreator(video).catch(() => null);
  const videoRow = await saveVideo(user, video, input);
  await saveTranscript(videoRow, video).catch(() => null);
  const productRow = await saveProduct(analysis.productIntelligence).catch(() => null);
  await linkVideoProduct(videoRow, productRow, analysis.productIntelligence).catch(() => null);
  const analysisRow = await saveAnalysis(user, videoRow, analysis, model);
  await saveGeneratedOutputs(user, analysisRow, analysis).catch(() => null);
  await saveUsageEvent(user, {
    event_type: "single_analysis",
    analysis_id: analysisRow?.id || null,
    video_id: videoRow?.id || null,
    input_count: 1,
    model,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens,
  }).catch(() => null);

  return {
    video_id: videoRow?.id || null,
    analysis_id: analysisRow?.id || null,
    product_id: productRow?.id || null,
  };
}

module.exports = {
  ViralsSupabaseError,
  getBearerToken,
  hasViralsSupabaseConfig,
  saveUsageEvent,
  saveViralsAnalysis,
  verifySupabaseUser,
};
