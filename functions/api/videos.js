// Dedicated videos endpoint. Frontend fires this in parallel with /api/search
// so the answer isn't delayed by video fetching. Keyless, uses direct YouTube
// scrape (works from Cloudflare) + community proxy fallback.

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

async function youtubeDirectSearch(query, limit = 6) {
  const url =
    "https://www.youtube.com/results?" +
    new URLSearchParams({ search_query: query + " lecture explained" });
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, {
      signal: c.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
    if (!m) return [];
    let data;
    try { data = JSON.parse(m[1]); } catch { return []; }

    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];
    const out = [];
    const seen = new Set();
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId || seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        const title =
          v.title?.runs?.map((r) => r.text).join("") ||
          v.title?.simpleText || "Video";
        const author =
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text || "Channel";
        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail =
          thumbs[thumbs.length - 1]?.url ||
          "https://i.ytimg.com/vi/" + v.videoId + "/hqdefault.jpg";
        out.push({
          title,
          url: "https://www.youtube.com/watch?v=" + v.videoId,
          author,
          thumbnail,
          id: v.videoId,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch { return []; }
}

const PROXIES = [
  { type: "piped", url: "https://pipedapi.kavin.rocks" },
  { type: "piped", url: "https://pipedapi.adminforge.de" },
  { type: "piped", url: "https://pipedapi.reallyaweso.me" },
  { type: "piped", url: "https://pipedapi.leptons.xyz" },
  { type: "invidious", url: "https://invidious.nerdvpn.de" },
  { type: "invidious", url: "https://iv.ggtyler.dev" },
  { type: "invidious", url: "https://invidious.privacyredirect.com" },
];

async function tryProxy(inst, query) {
  const qs = encodeURIComponent(query + " lecture");
  const url = inst.type === "piped"
    ? inst.url + "/search?q=" + qs + "&filter=videos"
    : inst.url + "/api/v1/search?q=" + qs + "&type=video";
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 2000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!r.ok) throw 0;
    const data = await r.json();
    const items = Array.isArray(data) ? data : (data.items || []);
    const out = [];
    for (const it of items) {
      let id = it.videoId || (it.url && it.url.replace(/^.*\/watch\?v=/, "").split("&")[0]);
      if (!id) continue;
      out.push({
        title: it.title || "Video",
        url: "https://www.youtube.com/watch?v=" + id,
        author: it.author || it.uploaderName || it.uploader || "Channel",
        thumbnail: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
        id,
      });
      if (out.length >= 6) break;
    }
    if (!out.length) throw 0;
    return out;
  } catch (e) { clearTimeout(t); throw e; }
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const query = (body.query || "").trim();
    if (!query) return new Response(JSON.stringify({ videos: [] }), { status: 200, headers: cors });

    const timedRace = new Promise((resolve) => setTimeout(() => resolve([]), 4000));
    const doFetch = async () => {
      const direct = await youtubeDirectSearch(query, 6).catch(() => []);
      if (direct.length) return direct;
      // shuffle
      const arr = PROXIES.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      try {
        const result = await Promise.any(arr.slice(0, 4).map((p) => tryProxy(p, query)));
        if (result && result.length) return result;
      } catch {}
      return [];
    };
    const videos = await Promise.race([doFetch(), timedRace]);
    return new Response(JSON.stringify({ videos }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ videos: [], error: String(e) }), { status: 200, headers: cors });
  }
}
