const {
  getBearerToken,
  getMusicGenerationByTask,
  hasSupabaseAdminConfig,
  updateMusicGeneration,
  verifySupabaseUser,
} = require("./_music-supabase");

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function getErrorStatus(error) {
  return Number(error?.status || 500);
}

async function fetchSonautoStatus(apiKey, taskId) {
  const response = await fetch(`https://api.sonauto.ai/v1/generations/${encodeURIComponent(taskId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function handleAuthenticatedStatus(req, res, apiKey, taskId, token) {
  if (!hasSupabaseAdminConfig()) {
    return sendJson(res, 500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  try {
    const user = await verifySupabaseUser(token);
    const generation = await getMusicGenerationByTask(user.id, taskId);
    if (!generation) {
      return sendJson(res, 404, { error: "Song task not found for this account." });
    }

    const { response, data } = await fetchSonautoStatus(apiKey, taskId);
    if (response.ok) {
      const updates = {
        status: data.status || generation.status || "WORKING",
        sonauto_response: data,
      };

      if (data.status === "SUCCESS") {
        const audioUrl = Array.isArray(data.song_paths) ? data.song_paths[0] : "";
        if (audioUrl) updates.audio_url = audioUrl;
        updates.completed_at = new Date().toISOString();
      }

      if (data.status === "FAILURE") {
        updates.error_message = data?.error_message || data?.error || "Generation failed.";
        updates.completed_at = new Date().toISOString();
      }

      await updateMusicGeneration(generation.id, updates);
    }

    return sendJson(res, response.status, {
      ...data,
      generation_id: generation.id,
    });
  } catch (error) {
    return sendJson(res, getErrorStatus(error), {
      error: error instanceof Error ? error.message : "Unable to load song status.",
    });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const apiKey = process.env.SONAUTO_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { error: "Missing SONAUTO_API_KEY." });
  }

  const taskId = typeof req.query.task_id === "string" ? req.query.task_id.trim() : "";
  if (!taskId) {
    return sendJson(res, 400, { error: "Missing task_id." });
  }

  const token = getBearerToken(req);
  if (!token) return sendJson(res, 401, { error: "Administrator sign-in is required." });
  return handleAuthenticatedStatus(req, res, apiKey, taskId, token);
};
