function cleanTikTokUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/tiktok\.com$/i.test(parsed.hostname.replace(/^www\./i, ""))) return raw;
    parsed.search = "";
    return parsed.toString();
  } catch (_error) {
    return raw;
  }
}

function cleanTikTokHandle(handle) {
  return String(handle || "").trim().replace(/^@+/, "");
}

function buildCanonicalTikTokUrl(handle, videoId, fallback = "") {
  const cleanHandle = cleanTikTokHandle(handle);
  const id = String(videoId || "").trim();
  if (cleanHandle && id) return `https://www.tiktok.com/@${encodeURIComponent(cleanHandle)}/video/${encodeURIComponent(id)}`;
  return cleanTikTokUrl(fallback);
}

function extractUniversalData(html) {
  const match = String(html || "").match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_error) {
    return null;
  }
}

function getItemStruct(data) {
  return data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct || null;
}

function webvttToText(webvtt) {
  const seen = new Set();
  return String(webvtt || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "WEBVTT")
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^\d\d:\d\d:\d\d\.\d{3}\s+-->\s+\d\d:\d\d:\d\d\.\d{3}/.test(line))
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickSubtitle(video) {
  const subtitles = Array.isArray(video?.subtitleInfos) ? video.subtitleInfos : [];
  return (
    subtitles.find((item) => String(item?.LanguageCodeName || "").toLowerCase().startsWith("eng")) ||
    subtitles.find((item) => String(item?.Format || "").toLowerCase() === "webvtt") ||
    subtitles[0] ||
    null
  );
}

function pickVideoPlayUrl(video) {
  const bitrateInfo = Array.isArray(video?.bitrateInfo) ? video.bitrateInfo : [];
  const bitrateUrl =
    bitrateInfo
      .flatMap((item) => item?.PlayAddr?.UrlList || item?.playAddr?.urlList || [])
      .find(Boolean) || "";
  return String(
    video?.playAddr ||
      video?.downloadAddr ||
      video?.playApi ||
      video?.playUrl ||
      bitrateUrl ||
      ""
  );
}

function buildTikTokEmbedUrl(videoId) {
  const id = String(videoId || "").trim();
  if (!id) return "";
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=0&loop=1&autoplay=0&muted=1&music_info=0&description=0&rel=0`;
}

async function fetchTikTokPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`TikTok page fetch failed with ${response.status}.`);
  return response.text();
}

async function fetchTikTokOembed(url) {
  const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanTikTokUrl(url) || url)}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function fetchTikTokTranscript(url) {
  const cleanUrl = cleanTikTokUrl(url);
  const [html, oembed] = await Promise.all([
    fetchTikTokPage(url),
    fetchTikTokOembed(url).catch(() => null),
  ]);
  const data = extractUniversalData(html);
  const item = getItemStruct(data);
  if (!item) throw new Error("TikTok video metadata was not found.");

  const subtitle = pickSubtitle(item.video);
  let transcript = "";
  let transcriptFormat = "";
  if (subtitle?.Url) {
    const subtitleResponse = await fetch(subtitle.Url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (subtitleResponse.ok) {
      const webvtt = await subtitleResponse.text();
      transcript = webvttToText(webvtt);
      transcriptFormat = String(subtitle.Format || "webvtt").toLowerCase();
    }
  }

  const videoId = String(item.id || "");
  const authorHandle = cleanTikTokHandle(item.author?.uniqueId || oembed?.author_name || "");

  return {
    url: buildCanonicalTikTokUrl(authorHandle, videoId, cleanUrl || url),
    videoId,
    coverUrl: String(item.video?.cover || item.video?.originCover || item.video?.dynamicCover || oembed?.thumbnail_url || ""),
    dynamicCoverUrl: String(item.video?.dynamicCover || ""),
    playUrl: pickVideoPlayUrl(item.video),
    embedUrl: buildTikTokEmbedUrl(item.id),
    durationSeconds: Number(item.video?.duration || item.music?.duration || 0) || null,
    author: {
      uniqueId: authorHandle,
      nickname: String(item.author?.nickname || oembed?.author_name || ""),
      followerCount: Number(item.authorStats?.followerCount || 0) || null,
    },
    caption: String(item.desc || oembed?.title || ""),
    hashtags: Array.isArray(item.challenges) ? item.challenges.map((tag) => String(tag?.title || "")).filter(Boolean) : [],
    stats: {
      likes: Number(item.stats?.diggCount || 0) || null,
      shares: Number(item.stats?.shareCount || 0) || null,
      comments: Number(item.stats?.commentCount || 0) || null,
      plays: Number(item.stats?.playCount || 0) || null,
      saves: Number(item.stats?.collectCount || 0) || null,
    },
    stickers: Array.isArray(item.stickersOnItem)
      ? item.stickersOnItem.flatMap((sticker) => sticker?.stickerText || []).map((text) => String(text || "").trim()).filter(Boolean)
      : [],
    music: {
      title: String(item.music?.title || ""),
      authorName: String(item.music?.authorName || ""),
      original: Boolean(item.music?.original),
    },
    transcript,
    transcriptFormat,
    transcriptSource: transcript ? "tiktok_subtitle_info" : "",
  };
}

module.exports = {
  cleanTikTokUrl,
  fetchTikTokTranscript,
  webvttToText,
};
