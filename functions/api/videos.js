import { corsHeaders, readOriginAllowed } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { neverFail, raceFirst, fetchWithTimeout, safeErr, jsonOk, jsonError, clampText } from "../lib/resilience.js";

// Dedicated videos endpoint. Frontend fires this in parallel with /api/search
// so the answer isn't delayed by video fetching. Keyless, uses direct YouTube
// scrape (works from Cloudflare) + community proxy fallback.
//
// Hardening: this had no origin allowlist (wildcard "*" CORS) and no rate
// limiting, unlike search.js/vote.js/tts.js. Every request fans out to
// youtube.com plus up to 4 third-party piped/invidious proxies, so an
// unthrottled third-party site could use this as a free anonymized relay —
// burning Cerebrum's own Pages Functions quota and risking Cerebrum's
// outbound IP getting flagged by YouTube from volume it didn't generate.
// Brought up to the same bar as the other endpoints.


const RATE_LIMIT = 20;         // video-search requests
const RATE_WINDOW_MS = 60000;  // per minute


// Everyday words that ambiguate a query. "rupture" without context finds
// religious rapture content; "cell" finds jail cells; "python" finds snakes.
// We can't ban the words, but we CAN add scientific framing so YouTube's
// ranker leans toward academic content.
// Commit 65 — this used to read " lecture explained biology microbiology
// science". Those two discipline words were hardcoded into EVERY video
// search, which is why a question about a satellite launch came back with
// six introductory microbiology lectures: YouTube had nothing matching the
// real topic, so it matched the words we were adding ourselves. The anchor
// now only says "this should be an explanatory science video" and names no
// field at all — the field has to come from the user's actual question.
const SCIENCE_ANCHOR_HINT = " explained lecture";

// Stopwords and question-phrasing words that should never be part of a video
// search. Sending the raw natural-language question causes YouTube to match
// on incidental words rather than the topic.
const VIDEO_STOPWORDS = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","from",
  "by","as","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","can","could","should","may","might","must",
  "what","which","who","whom","when","where","why","how","this","that","these",
  "those","it","its","they","them","their","he","she","his","her","we","us",
  "our","you","your","i","me","my","mine","about","into","out","over","under",
  "again","further","then","once","here","there","all","any","both","each",
  "few","more","most","other","some","such","only","own","same","so","than",
  "too","very","just","forgot","also","phase","things","stuff","get",
]);

function shortenQueryForVideos(raw) {
  const words = (raw || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !VIDEO_STOPWORDS.has(w));
  // Keep it short: 4 anchors is what YouTube's ranker handles best. Longer
  // strings dilute intent and let single dramatic words (rupture, apocalypse)
  // dominate the ranking.
  return words.slice(0, 5).join(" ");
}

// Commit 65 — relevance gate.
//
// Even with a clean query, YouTube will happily return its best-selling
// generic lectures when it has no real match for a niche topic (a rocket
// launch, a specific instrument, an obscure protein). Those results are
// worse than none: they look like Cerebrum is confidently recommending
// unrelated material. So a returned video has to actually mention something
// from the question. If nothing does, the section renders empty — which is
// the honest outcome when there genuinely aren't videos on the subject.
//
// Matching is done on stems (first 5 characters) so "fluorescence" matches
// "fluorescent" and "vegetation" matches "vegetative", without pulling in a
// stemming library for four characters of overlap.
function videoAnchorStems(raw) {
  return shortenQueryForVideos(raw)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 5));
}
function videoIsRelevant(title, author, stems) {
  if (!stems.length) return true;
  const hay = ((title || "") + " " + (author || "")).toLowerCase();
  return stems.some((st) => hay.includes(st));
}

async function youtubeDirectSearch(query, limit = 6) {
  const anchored = shortenQueryForVideos(query);
  const stems = videoAnchorStems(query);
  const searchQuery = anchored ? anchored + SCIENCE_ANCHOR_HINT : query;
  const url =
    "https://www.youtube.com/results?" +
    new URLSearchParams({ search_query: searchQuery });
  try {
    // fetchWithTimeout: a YouTube edge that accepts the connection and never
    // answers must not hold a Worker open until the platform kills it.
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, 5000);
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

        // Reject obviously off-domain videos. "rupture" in a scientific query
        // must not surface content about the biblical rapture; "cell" must not
        // surface prison content, etc. Cheap keyword filter on title+channel.
        const combined = (title + " " + author).toLowerCase();
        const offTopicSignals = [
          /\brapture\b/, /\bend times\b/, /\bsecond coming\b/, /\btribulation\b/,
          /\bbible\b/, /\bscripture\b/, /\bthe lord\b/, /\bjesus christ\b/,
          /\bprophecy\b/, /\bprophetic\b/, /\bthess?\.?\s*4\b/,
          /\bspirit(ual)?\s+awakening\b/, /\bfrequency\s+shift\b/,
          /\btimeline\s+split(ting)?\b/, /\bstarseed\b/, /\bascension\b/,
          /\bconspiracy\b/, /\billuminati\b/, /\bflat earth\b/,
          /\bmanifest(ing|ation)\b/, /\baliens?\s+are\s+coming\b/,
        ];
        if (offTopicSignals.some((re) => re.test(combined))) continue;
        // Must actually be about what was asked — see videoIsRelevant.
        if (!videoIsRelevant(title, author, stems)) continue;

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
  const anchored = shortenQueryForVideos(query);
  const stems = videoAnchorStems(query);
  const qs = encodeURIComponent((anchored || query) + " lecture");
  const url = inst.type === "piped"
    ? inst.url + "/search?q=" + qs + "&filter=videos"
    : inst.url + "/api/v1/search?q=" + qs + "&type=video";
  try {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, 2000);
    if (!r.ok) throw new Error(inst.url + ": HTTP " + r.status);
    const data = await r.json();
    const items = Array.isArray(data) ? data : (data.items || []);
    const out = [];
    // Bug: `id`/`title`/`author` come from community-run, third-party-operated
    // Piped/Invidious instances Cerebrum doesn't control, and were forwarded
    // to the client with no validation. A real YouTube video ID is always
    // exactly 11 URL-safe characters — reject anything else so a compromised
    // or malicious proxy instance can't inject an arbitrary string into a
    // field the frontend renders.
    const YT_ID_RE = /^[\w-]{11}$/;
    for (const it of items) {
      let id = it.videoId || (it.url && it.url.replace(/^.*\/watch\?v=/, "").split("&")[0]);
      if (!id || !YT_ID_RE.test(id)) continue;
      const pTitle = it.title || "Video";
      const pAuthor = it.author || it.uploaderName || it.uploader || "Channel";
      if (!videoIsRelevant(pTitle, pAuthor, stems)) continue;
      out.push({
        title: pTitle,
        url: "https://www.youtube.com/watch?v=" + id,
        author: pAuthor,
        thumbnail: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
        id,
      });
      if (out.length >= 6) break;
    }
    if (!out.length) throw new Error(inst.url + ": no usable results");
    return out;
  } catch (e) { throw e; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST" && request.method !== "GET") {
    return jsonError(405, "method_not_allowed", "Method not allowed.", cors);
  }
  if (!readOriginAllowed(request, env)) {
    return jsonError(403, "origin_not_allowed", "Origin not allowed.", cors);
  }
  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!(await checkRateLimit(env, `videos:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", {
      ...cors, "Retry-After": "30",
    });
  }
  try {
    // Both shapes exist in the wild: the search page POSTs {query}, the
    // article modal fires a GET with ?q=. Accepting both is cheaper than
    // auditing every caller, and a refused method is a silent broken video
    // rail, not a security boundary.
    let query = "";
    if (request.method === "GET") {
      query = clampText(new URL(request.url).searchParams.get("q"), 300);
    } else {
      const body = await request.json().catch(() => ({}));
      query = clampText(body && body.query, 300);
    }
    if (!query) return jsonOk({ videos: [] }, cors);

    const doFetch = async () => {
      // First HEALTHY leg wins; a fast failure can never beat a slow
      // success. Every leg degrades to "out of the race" rather than
      // throwing, and the whole race has a hard deadline — the client
      // always gets an answer within ~4s, even if that answer is [].
      const legs = [
        neverFail(youtubeDirectSearch(query, 6), null, "youtube-direct"),
        (async () => {
          // shuffle
          const arr = PROXIES.slice();
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          const proxies = arr.slice(0, 4).map((p) =>
            neverFail(tryProxy(p, query), null, "proxy:" + p.url)
          );
          const result = await raceFirst(proxies, { timeoutMs: 2500, label: "proxies", fallback: null });
          return result && result.length ? result : null;
        })(),
      ];
      const videos = await raceFirst(legs, { timeoutMs: 4000, label: "videos", fallback: [] });
      return videos || [];
    };
    const videos = await doFetch();
    return jsonOk({ videos }, cors);
  } catch (e) {
    console.error("Cerebrum videos endpoint error:", safeErr(e));
    // Never a 500: no videos is an honest, renderable outcome; a failure
    // page is not.
    return jsonOk({ videos: [] }, cors);
  }
}
