const { getBearerToken, verifySupabaseUser } = require("./_music-supabase");

const VIRALS_SUPABASE_URL = String(process.env.VIRALS_SUPABASE_URL || "").replace(/\/+$/, "");
const VIRALS_SUPABASE_SERVICE_ROLE_KEY = String(process.env.VIRALS_SUPABASE_SERVICE_ROLE_KEY || "").trim();
const VIRALS_SYSTEM_USER_ID = String(process.env.VIRALS_SYSTEM_USER_ID || "00000000-0000-4000-8000-000000000001").trim();

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

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function normalizeUrl(value) {
  const raw = cleanString(value, 900);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.split("?")[0].replace(/\/+$/, "");
  }
}

function cleanUuid(value) {
  const raw = cleanString(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function tableUrl(table, query = "") {
  return `${VIRALS_SUPABASE_URL}/rest/v1/${table}${query}`;
}

function getAnonymousViralsUser() {
  return {
    id: VIRALS_SYSTEM_USER_ID,
    email: "anonymous@n3xra-virals.local",
    user_metadata: {
      name: "N3XRA Virals Anonymous",
    },
    isAnonymousViralsUser: true,
  };
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
    latest_metrics_captured_at: Object.keys(video?.stats || {}).length ? new Date().toISOString() : null,
    metrics_source: Object.keys(video?.stats || {}).length ? "tiktok_page_metadata_snapshot" : null,
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

function normalizeSavedVideo(row = {}) {
  if (!row?.id) return null;
  const raw = row.raw_metadata && typeof row.raw_metadata === "object" ? row.raw_metadata : {};
  const videoId = row.external_video_id || raw.videoId || "";
  return {
    id: row.id,
    url: row.source_url || raw.url || "",
    videoId,
    caption: row.description || row.title || raw.caption || "",
    coverUrl: row.thumbnail_url || raw.coverUrl || raw.dynamicCoverUrl || "",
    dynamicCoverUrl: raw.dynamicCoverUrl || row.thumbnail_url || "",
    playUrl: raw.playUrl || raw.videoUrl || raw.playAddr || "",
    embedUrl: raw.embedUrl || (videoId ? `https://www.tiktok.com/player/v1/${encodeURIComponent(videoId)}?controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=0&loop=1&autoplay=0&muted=1&music_info=0&description=0&rel=0` : ""),
    durationSeconds: row.duration_seconds || raw.durationSeconds || 0,
    stats: row.metrics || raw.stats || {},
    stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
    transcript: raw.transcript || "",
    transcriptSource: raw.transcriptSource || "",
    author: {
      uniqueId: row.creator_handle || raw.author?.uniqueId || "",
      nickname: row.creator_name || raw.author?.nickname || "",
      followerCount: raw.author?.followerCount || null,
    },
  };
}

function normalizeSavedAnalysis(row = {}, generatedScripts = [], generatedCaptions = [], videoRow = null) {
  const hookBreakdown = row.hook_breakdown || {};
  const structureBreakdown = row.structure_breakdown || {};
  const audience = row.audience_targeting || {};
  const video = normalizeSavedVideo(videoRow);
  return {
    id: row.id,
    createdAt: row.created_at,
    url: video?.url || "",
    video,
    product: audience.product || "Saved framework",
    niche: audience.niche || "TikTok Shop",
    goal: audience.goal || "TikTok Shop affiliate sale",
    hookType: hookBreakdown.hookType || row.hook || "Framework Hook",
    formula: hookBreakdown.formula || row.summary || "",
    body: structureBreakdown.body || "",
    triggers: Array.isArray(row.emotional_triggers) ? row.emotional_triggers : [],
    conversionPattern: row.why_it_works || "",
    keep: structureBreakdown.keep || "",
    change: structureBreakdown.change || row.improvement_notes || "",
    hooks: Array.isArray(hookBreakdown.hooks) ? hookBreakdown.hooks : [],
    scripts: generatedScripts.map((script) => ({
      title: script.title || script.script_type || "Generated Script",
      text: script.script_text || "",
    })),
    captions: generatedCaptions.map((caption) => caption.caption_text).filter(Boolean),
    shotList: [],
    transcriptBreakdown: {
      cleanedTranscript: "",
      hook: hookBreakdown.transcriptHook || "",
      bodyStructure: structureBreakdown.transcriptBodyStructure || "",
      cta: "",
      sellingBeats: [],
    },
    productIntelligence: {
      name: audience.product || "Saved product",
      category: audience.niche || "TikTok Shop",
      offer: audience.goal || "",
      confidence: "Saved",
      claims: Array.isArray(row.strengths) ? row.strengths : [],
      objections: Array.isArray(row.weaknesses) ? row.weaknesses : [],
      proofPoints: Array.isArray(row.engagement_drivers) ? row.engagement_drivers : [],
    },
  };
}

async function listSavedFrameworks(user, limit = 30) {
  if (!hasViralsSupabaseConfig() || !user?.id) return [];
  const rows = await fetchJson(tableUrl(
    "virals_ai_analyses",
    `?select=*&master_user_id=eq.${encodeFilter(user.id)}&status=eq.completed&order=created_at.desc&limit=${Math.min(Math.max(Number(limit) || 30, 1), 60)}`
  ), { headers: serviceHeaders() });

  const ids = rows.map((row) => row.id).filter(Boolean);
  const videoIds = rows.map((row) => row.video_id).filter(Boolean);
  if (!ids.length) return [];
  const idList = ids.join(",");
  const videoIdList = videoIds.join(",");
  const [scripts, captions, videos] = await Promise.all([
    fetchJson(tableUrl("virals_generated_scripts", `?select=analysis_id,title,script_type,script_text&analysis_id=in.(${idList})`), { headers: serviceHeaders() }).catch(() => []),
    fetchJson(tableUrl("virals_generated_captions", `?select=analysis_id,caption_text&analysis_id=in.(${idList})`), { headers: serviceHeaders() }).catch(() => []),
    videoIds.length
      ? fetchJson(tableUrl("virals_videos", `?select=*&id=in.(${videoIdList})`), { headers: serviceHeaders() }).catch(() => [])
      : [],
  ]);

  return rows.map((row) => normalizeSavedAnalysis(
    row,
    scripts.filter((script) => script.analysis_id === row.id),
    captions.filter((caption) => caption.analysis_id === row.id),
    videos.find((video) => video.id === row.video_id) || null
  ));
}

async function deleteSavedFramework(user, analysisId) {
  if (!hasViralsSupabaseConfig() || !user?.id || !analysisId) return null;
  await fetchJson(tableUrl(
    "virals_ai_analyses",
    `?id=eq.${encodeFilter(analysisId)}&master_user_id=eq.${encodeFilter(user.id)}`
  ), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  return { status: "deleted" };
}

function normalizeSavedScript(row = {}) {
  const context = row.context || {};
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title || "Saved Script",
    scriptText: row.script_text || "",
    notes: row.notes || "",
    sourceUrl: row.source_url || "",
    product: row.product || "",
    niche: row.niche || "",
    goal: row.goal || "",
    hookType: row.hook_type || "",
    hookFormula: context.hookFormula || "",
    bodyFramework: context.bodyFramework || "",
    conversionLogic: context.conversionLogic || "",
    keep: context.keep || "",
    change: context.change || "",
    captions: Array.isArray(context.captions) ? context.captions : [],
    shotList: Array.isArray(context.shotList) ? context.shotList : [],
    productIntelligence: context.productIntelligence || null,
  };
}

async function listSavedScripts(user, limit = 80) {
  if (!hasViralsSupabaseConfig() || !user?.id) return [];
  const rows = await fetchJson(tableUrl(
    "virals_saved_scripts",
    `?select=*&master_user_id=eq.${encodeFilter(user.id)}&order=created_at.desc&limit=${Math.min(Math.max(Number(limit) || 80, 1), 120)}`
  ), { headers: serviceHeaders() });
  return rows.map(normalizeSavedScript);
}

async function saveScriptToLibrary(user, payload = {}) {
  if (!hasViralsSupabaseConfig() || !user?.id) return null;
  const row = await insertRow("virals_saved_scripts", {
    master_user_id: user.id,
    source_analysis_id: cleanUuid(payload.sourceAnalysisId),
    title: cleanString(payload.title || "Saved Script", 180),
    script_text: cleanString(payload.scriptText, 12000),
    notes: cleanString(payload.notes, 4000) || null,
    source_url: cleanString(payload.sourceUrl, 1000) || null,
    product: cleanString(payload.product, 220) || null,
    niche: cleanString(payload.niche, 160) || null,
    goal: cleanString(payload.goal, 180) || null,
    hook_type: cleanString(payload.hookType, 180) || null,
    context: {
      hookFormula: cleanString(payload.hookFormula, 1600),
      bodyFramework: cleanString(payload.bodyFramework, 1600),
      conversionLogic: cleanString(payload.conversionLogic, 1600),
      keep: cleanString(payload.keep, 1400),
      change: cleanString(payload.change, 1400),
      captions: Array.isArray(payload.captions) ? payload.captions.slice(0, 10) : [],
      shotList: Array.isArray(payload.shotList) ? payload.shotList.slice(0, 12) : [],
      productIntelligence: payload.productIntelligence || null,
    },
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : [],
  });
  await saveUsageEvent(user, { event_type: "script_save", input_count: 1 }).catch(() => null);
  return normalizeSavedScript(row);
}

async function deleteSavedScript(user, scriptId) {
  if (!hasViralsSupabaseConfig() || !user?.id || !scriptId) return null;
  await fetchJson(tableUrl(
    "virals_saved_scripts",
    `?id=eq.${encodeFilter(scriptId)}&master_user_id=eq.${encodeFilter(user.id)}`
  ), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  return { status: "deleted" };
}

async function saveVideoSearchStats(videoRow, video, analysisRow, analysis = {}, input = {}) {
  const normalizedUrl = normalizeUrl(video?.url || input.url);
  if (!normalizedUrl) return null;

  const existing = firstRow(await fetchJson(tableUrl("virals_video_search_stats", `?normalized_url=eq.${encodeFilter(normalizedUrl)}&limit=1`), {
    headers: serviceHeaders(),
  }));
  const thumbnailUrl = cleanString(
    video?.coverUrl ||
      video?.dynamicCoverUrl ||
      videoRow?.thumbnail_url ||
      existing?.thumbnail_url,
    1000
  ) || null;
  const title = cleanString(
    video?.caption ||
      videoRow?.title ||
      existing?.title ||
      "Untitled TikTok",
    300
  );
  const creatorHandle = cleanString(
    video?.author?.uniqueId ||
      videoRow?.creator_handle ||
      existing?.creator_handle,
    160
  ) || null;

  const payload = {
    normalized_url: normalizedUrl,
    platform: "tiktok",
    external_video_id: cleanString(video?.videoId || videoRow?.external_video_id || existing?.external_video_id, 160) || null,
    title,
    creator_handle: creatorHandle,
    thumbnail_url: thumbnailUrl,
    search_count: Number(existing?.search_count || 0) + 1,
    analysis_count: Number(existing?.analysis_count || 0) + 1,
    last_seen_at: new Date().toISOString(),
    latest_video_id: videoRow?.id || null,
    latest_analysis_id: analysisRow?.id || null,
    latest_metrics: video?.stats || videoRow?.metrics || {},
    latest_framework: {
      hookType: analysis.hookType || null,
      formula: analysis.formula || null,
      body: analysis.body || null,
      product: analysis.productIntelligence?.name || analysis.product || null,
      niche: analysis.niche || null,
    },
  };

  if (existing?.id) {
    return firstRow(await fetchJson(tableUrl("virals_video_search_stats", `?id=eq.${encodeFilter(existing.id)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    }));
  }

  return insertRow("virals_video_search_stats", payload);
}

async function saveViralsVideoReference({ user, input, video, analysis }) {
  const owner = user?.id ? user : getAnonymousViralsUser();
  if (!hasViralsSupabaseConfig() || !owner?.id || !video) return null;

  await ensureViralsProfile(owner);
  await saveCreator(video).catch(() => null);
  const videoRow = await saveVideo(owner, video, input);
  await saveTranscript(videoRow, video).catch(() => null);
  await saveVideoSearchStats(videoRow, video, null, analysis, input).catch(() => null);
  return {
    status: "saved",
    owner: owner.isAnonymousViralsUser ? "anonymous" : "account",
    video_id: videoRow?.id || null,
  };
}

async function saveViralsAnalysis({ user, input, video, analysis, model, usage }) {
  const owner = user?.id ? user : getAnonymousViralsUser();
  if (!hasViralsSupabaseConfig() || !owner?.id || !analysis) return null;

  await ensureViralsProfile(owner);
  const sourceVideo = video || {
    url: input?.url || analysis.url || "",
    caption: input?.notes || "",
    stats: {},
    raw_metadata: { source: "user_input" },
  };

  await saveCreator(sourceVideo).catch(() => null);
  const videoRow = await saveVideo(owner, sourceVideo, input);
  await saveTranscript(videoRow, sourceVideo).catch(() => null);
  const productRow = await saveProduct(analysis.productIntelligence).catch(() => null);
  await linkVideoProduct(videoRow, productRow, analysis.productIntelligence).catch(() => null);
  const analysisRow = await saveAnalysis(owner, videoRow, analysis, model);
  await saveGeneratedOutputs(owner, analysisRow, analysis).catch(() => null);
  await saveVideoSearchStats(videoRow, sourceVideo, analysisRow, analysis, input).catch(() => null);
  await saveUsageEvent(owner, {
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
    status: "saved",
    owner: owner.isAnonymousViralsUser ? "anonymous" : "account",
    video_id: videoRow?.id || null,
    analysis_id: analysisRow?.id || null,
    product_id: productRow?.id || null,
  };
}

module.exports = {
  ViralsSupabaseError,
  deleteSavedFramework,
  deleteSavedScript,
  getBearerToken,
  getAnonymousViralsUser,
  hasViralsSupabaseConfig,
  listSavedFrameworks,
  listSavedScripts,
  saveScriptToLibrary,
  saveUsageEvent,
  saveViralsAnalysis,
  saveViralsVideoReference,
  verifySupabaseUser,
};
