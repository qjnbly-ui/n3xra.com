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

  return {
    url: cleanUrl || url,
    videoId: String(item.id || ""),
    coverUrl: String(item.video?.cover || item.video?.originCover || item.video?.dynamicCover || ""),
    dynamicCoverUrl: String(item.video?.dynamicCover || ""),
    durationSeconds: Number(item.video?.duration || item.music?.duration || 0) || null,
    author: {
      uniqueId: String(item.author?.uniqueId || oembed?.author_name || ""),
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
