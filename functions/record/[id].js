/**
 * Public Search record page. GET /record/<id>
 *
 * Every answer Cerebrum produces carries a Search record (the
 * question, the exact queries that ran, the per database outcomes,
 * the funnel, the synthesis model, and the frozen source list), and
 * the search handler stores that record under a permanent id
 * (storeSearchRecord in functions/api/search.js). This route serves
 * the stored record back as a human readable page: the same readable
 * half the in app panel and the Markdown export print, rendered from
 * the stored JSON.
 *
 * Records are shareable by design, so there is no auth here: anyone
 * with the link can read the record. That matches the export's
 * existing posture (the record is built to be pasted into a methods
 * section) and the record's contents: it holds no answer text, no
 * abstracts, and nothing about who asked. The id is 128 bits of
 * randomness, so the address itself is the capability.
 *
 * The raw record is available at the same address with
 * ?format=json added, which the page footer says in plain words.
 * An id that was never stored (or a database that is not there)
 * returns an honest 404 page, never an invented record.
 *
 * The page's Rerun this search action links to the app with the
 * question in the ?q= deep link. Its small inline script first
 * fetches this record as JSON and stashes it in sessionStorage
 * under the app's baseline key, so the fresh answer's Search record
 * panel can compare the two runs (diffSearchRecords in
 * src/CerebrumApp.jsx). Without JavaScript the link still lands on
 * the app with the question prefilled; only the comparison is lost.
 */

import { normalizeRetractionDoi, resolveRetractionStatuses } from "../lib/retraction.js";

const BASELINE_KEY = "cb_record_baseline_v1";
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;

/* Plain names for the executed query set's kinds, the same map the
 * Markdown export prints, so the page and the export read alike. A
 * kind the map does not know prints as recorded, never renamed. */
const EXECUTED_QUERY_KIND_LABELS = {
  rung: "Search rung",
  concept: "Concept query",
  recall: "Topic memory recall",
  relaxed: "Relaxed boolean",
  aspect: "Aspect query",
};

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* Source titles get the same species formatting the app gives
 * them (2026-10-14, answer package defect 7). Upstream metadata
 * carries species names in <i> tags, and the app renders those as
 * italics (renderCleanTitle in src/textUtils.js). Escaping the
 * whole title printed the tags as literal text and the species in
 * roman. So: escape first, then restore exactly the <i> tag
 * spellings (no attributes, nothing else) as real elements. The
 * restore is deliberately narrower than the app's whitelist: this
 * page is public and unauthenticated, its stored text stays
 * escaped (the posture the security tests pin), and italics are
 * the one formatting the species rule requires here. */
function escTitle(v) {
  return esc(v).replace(/&lt;(\/?)i&gt;/gi, "<$1i>");
}

function pageShell(title, bodyHtml) {
  return "<!doctype html>\n"
    + '<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + "<title>" + esc(title) + "</title>\n"
    + "<style>"
    + "body{margin:0;background:radial-gradient(ellipse 80% 58% at 50% 40%, rgba(198,204,212,0.13), rgba(198,204,212,0) 66%),radial-gradient(ellipse 120% 90% at 50% 112%, rgba(64,68,74,0.16), rgba(64,68,74,0) 62%),#060606;color:#f3f3f1;font-family:Georgia,'Times New Roman',serif;}"
    + "main{max-width:760px;margin:0 auto;padding:40px 20px 64px;}"
    + "h1{font-size:28px;line-height:1.25;margin:0 0 6px;}"
    + "h2{font-size:16px;letter-spacing:.08em;text-transform:uppercase;color:#c89a3a;margin:30px 0 8px;}"
    + "p,li{font-size:16px;line-height:1.6;}"
    + "ul,ol{padding-left:22px;margin:6px 0;}"
    + ".meta{color:rgba(243,243,241,0.72);font-size:14px;overflow-wrap:anywhere;}"
    + ".note{border:1px solid rgba(243,243,241,0.14);border-left:4px solid #c89a3a;background:#101013;padding:10px 14px;}"
    + ".src{margin-bottom:8px;}"
    + ".srcflag{font-size:14px;line-height:1.55;margin:-4px 0 10px;color:rgba(243,243,241,0.85);}"
    + ".rf-retracted{color:#d99b86;}"
    + ".rf-concern{color:#d7c27b;}"
    + ".rf-corrected{color:rgba(243,243,241,0.72);}"
    + ".srcflag a{color:inherit;}"
    + ".tag{color:rgba(243,243,241,0.72);font-size:14px;}"
    + "a{color:#e0bd68;}"
    + ".rerun{display:inline-block;margin-top:10px;padding:10px 18px;border:1px solid #c89a3a;border-radius:6px;background:#c89a3a;color:#060606;text-decoration:none;font-size:16px;}"
    + ".foot{margin-top:44px;border-top:1px solid rgba(243,243,241,0.14);padding-top:14px;color:rgba(243,243,241,0.72);font-size:14px;line-height:1.6;}"
    + "</style>\n</head>\n<body>\n<main>\n"
    + bodyHtml
    + "\n</main>\n</body>\n</html>";
}

function notFoundPage() {
  const body = "<h1>Record not found</h1>\n"
    + "<p>No search record lives at this address. The link may be mistyped, or the record was never stored.</p>\n"
    + '<p><a href="/">Go to Cerebrum search</a></p>';
  return new Response(pageShell("Record not found · Cerebrum", body), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/* ── Plain language screens for the record's diagnostic fields ──
 * (2026-11-06, cold demo fix). The record stores the run's raw
 * diagnostics: fact check trace entries whose detail is the
 * provider's own error text (a live record printed one vendor's
 * daily quota message, its paid plan upsell, and two HTTP 429
 * lines), a subrequest ledger with grant refusals, and internal
 * stage names. This page is public and shareable, so its readable
 * prose may never print those strings. Everything below maps the
 * stored fields to plain honest sentences: what ran, what did
 * not, and what that left unchecked. An outcome the map does not
 * know falls back to a generic honest line, never the stored
 * string, and the stored detail is never read at all, because the
 * detail is where provider error text lives. Honesty is kept:
 * a search that was partial still says so. The verbatim record
 * stays available as data at ?format=json, labelled as JSON; it
 * is the prose that is screened. The in app record panel and the
 * Markdown export mirror these helpers in src/CerebrumApp.jsx. */
const RECORD_STAGE_PLAIN = {
  retrieval: "searching the databases",
  synthesis: "writing the answer",
  validation: "checking the evidence",
  "fact-check": "checking the claims",
  disagreement: "comparing the sources",
  cache: "looking up a saved answer",
  request: "handling the request",
  rerank: "ranking the results",
};

function recordStagePlain(name) {
  return Object.prototype.hasOwnProperty.call(RECORD_STAGE_PLAIN, name)
    ? RECORD_STAGE_PLAIN[name] : null;
}

/* The Model section's plain sentence (2026-11-07, record wording
 * cleanup). The stored synthesisModel is the winning leg's raw
 * label: a provider prefix plus the vendor's model slug
 * ("gemini:gemini-3.5-flash-lite"), a bare OpenRouter name
 * ("google/gemma-4-26b-a4b-it:free"), or a bare Workers AI name
 * ("@cf/meta/llama-3.3-70b-instruct-fp8-fast"). Those strings are
 * machinery text on a public page, the one diagnostic field the
 * cold demo maps never claimed, so they never print in prose. What
 * the label does prove is the model line that wrote the answer,
 * read with the same vocabulary the search handler itself uses
 * for checker exclusion (factCheckModelFamily in
 * functions/api/search.js): strip a known provider prefix, then
 * match the family token. A family hit renders "Written by a
 * Gemini model." and claims nothing more specific. A label no
 * family matches renders the generic honest sentence: the field
 * is only set when an AI model wrote the answer, so that sentence
 * is always true and invents no name. A null field keeps the
 * existing no synthesis sentence at the render site. The raw
 * label stays in the record as data (?format=json); only the
 * prose is screened, the standing rule for this page. The in app
 * record panel and the Markdown export mirror this helper in
 * src/CerebrumApp.jsx. */
const RECORD_MODEL_FAMILY_PLAIN = [
  ["gemma", "Gemma"],
  ["gemini", "Gemini"],
  ["llama", "Llama"],
  ["gpt-oss", "GPT OSS"],
  ["nemotron", "Nemotron"],
  ["mistral", "Mistral"],
];
const RECORD_MODEL_PROVIDER_PREFIXES = ["groq", "gemini", "mistral", "nvidia", "cerebras", "github", "pollinations", "groq2", "gemini2", "sambanova"];

function recordModelPlain(label) {
  if (typeof label !== "string" || !label.trim()) return null;
  let m = label.trim().toLowerCase();
  const sep = m.indexOf(":");
  if (sep > 0 && RECORD_MODEL_PROVIDER_PREFIXES.includes(m.slice(0, sep))) {
    m = m.slice(sep + 1);
  }
  for (const [token, name] of RECORD_MODEL_FAMILY_PLAIN) {
    if (m.includes(token)) return "Written by a " + name + " model.";
  }
  return "Written by an AI model.";
}

/* One stored trace outcome's category, from the outcome token
 * alone. Unknown outcomes land in "failed", whose wording is the
 * generic honest line. */
function factCheckOutcomeCategory(entry) {
  const outcome = entry && typeof entry.outcome === "string" ? entry.outcome : "";
  const tier = entry && typeof entry.tier === "string" ? entry.tier : "";
  if (outcome === "ok") return tier === "terms" ? "terms-ran" : "ran";
  if (outcome === "nothing-to-verify") return "nothing-to-verify";
  if (tier === "stage") {
    if (outcome === "off") return "off";
    if (outcome === "no-time") return "stage-no-time";
    if (outcome === "budget") return "stage-budget";
    return "stage-other";
  }
  switch (outcome) {
    case "excluded": return "excluded";
    case "no-key": case "no-binding": return "unavailable";
    case "unparseable": return "unreadable";
    case "timeout": case "no-time": return "timeout";
    case "budget": return "budget";
    case "http-429": return "limit";
    default:
      if (/^http-\d+$/.test(outcome)) return "unreachable";
      return "failed";
  }
}

/* The trace as plain sentences, one per category that occurred,
 * counted where several checkers met the same end. */
function factCheckPlainLines(trace) {
  if (!Array.isArray(trace)) return [];
  const entries = trace.filter((t) => t && typeof t === "object" && (t.tier || t.outcome));
  if (!entries.length) return [];
  const counts = {};
  for (const e of entries) {
    const c = factCheckOutcomeCategory(e);
    counts[c] = (counts[c] || 0) + 1;
  }
  const counted = (n, oneText, manyText) => (n === 1 ? oneText : manyText.replace(/\{n\}/g, String(n)));
  const lines = [];
  if (counts["ran"]) lines.push("A claim check ran on this answer.");
  if (counts["terms-ran"]) lines.push("A light check of the scientific terms in the answer ran.");
  if (counts["nothing-to-verify"]) lines.push("The light check ran and found no checkable terms in the answer.");
  if (counts["off"]) lines.push("The claim check was off for this search.");
  if (counts["stage-no-time"]) lines.push("The claim check did not run. The search ran out of time first.");
  if (counts["stage-budget"]) lines.push("The claim check did not run. The search had reached its working limit.");
  if (counts["stage-other"]) lines.push("The claim check did not run for this search.");
  if (counts["excluded"]) lines.push(counted(counts["excluded"],
    "One checker was skipped because it wrote the answer, and a writer cannot check its own work.",
    "{n} checkers were skipped because they wrote the answer, and a writer cannot check its own work."));
  if (counts["unavailable"]) lines.push(counted(counts["unavailable"],
    "One checker was not available for this search.",
    "{n} checkers were not available for this search."));
  if (counts["unreadable"]) lines.push(counted(counts["unreadable"],
    "One checker replied in a form that could not be read, so it was not counted.",
    "{n} checkers replied in a form that could not be read, so they were not counted."));
  if (counts["timeout"]) lines.push(counted(counts["timeout"],
    "One checker did not answer in time, so it was not counted.",
    "{n} checkers did not answer in time, so they were not counted."));
  if (counts["budget"]) lines.push(counted(counts["budget"],
    "One checker could not run, because the search had reached its working limit.",
    "{n} checkers could not run, because the search had reached its working limit."));
  if (counts["limit"]) lines.push(counted(counts["limit"],
    "One checker was at its usage limit, so it could not run.",
    "{n} checkers were at their usage limits, so they could not run."));
  if (counts["unreachable"]) lines.push(counted(counts["unreachable"],
    "One checker could not be reached, so it was not counted.",
    "{n} checkers could not be reached, so they were not counted."));
  if (counts["failed"]) lines.push(counted(counts["failed"],
    "One checker did not complete, so it was not counted.",
    "{n} checkers did not complete, so they were not counted."));
  return lines;
}

/* The health note that sits at the top of the page (2026-10-14,
 * MCP and record wave). A record whose run degraded must say so
 * where a reader lands, not read as a clean run: the fourth panel
 * followed a permanently stored degraded record that carried no
 * health signal and no banner. Records stored since the health
 * verdict was added to buildSearchRecord carry `degraded` (and
 * `failedStages`) and get the plain statement. Older records carry
 * neither field; the only health fact they hold is whether an AI
 * synthesis model ran, so the note states exactly that and says the
 * record predates health recording, rather than guessing at a
 * verdict nobody stored. A healthy record gets no note.
 * The failed stage names print through RECORD_STAGE_PLAIN
 * (2026-11-06): the stored names are internal identifiers, and a
 * name the map does not know is dropped rather than printed raw. */
function recordHealthNote(record) {
  if (record.degraded === true) {
    const stages = Array.isArray(record.failedStages)
      ? record.failedStages
        .filter((s) => typeof s === "string" && s)
        .map(recordStagePlain)
        .filter(Boolean)
      : [];
    return "This search ran degraded: part of the pipeline did not complete"
      + (stages.length ? " (failed stages: " + stages.join(", ") + ")" : "")
      + ". The record below is still the complete record of the run.";
  }
  if (typeof record.degraded !== "boolean" && !record.synthesisModel) {
    const hasSources = Array.isArray(record.sources) && record.sources.length > 0;
    return "No AI synthesis model ran for this answer"
      + (hasSources ? ": it was assembled from source excerpts" : "")
      + ". This record predates run health recording, so no fuller health verdict was stored for it.";
  }
  return "";
}

/* Why writing failed, in plain words (2026-11-08, burnout replay
 * diagnosis). Records stored since the synthesis verdict was added
 * to buildSearchRecord carry `synthesisSkipReason`, the stage's own
 * internal taxonomy string, and `synthesisFailedLegs`, counts of the
 * failed writing attempts by kind. The stored reason never prints
 * raw: each known value maps to one plain sentence about what
 * happened, an unknown value gets the generic honest sentence, and
 * a record without the field gets no note at all, so older records
 * render exactly as they did before the field existed. The failed
 * legs summary prints as counts and kinds only. No model label and
 * no raw error text is stored in the summary, so none can print. */
function recordSynthesisFailureNote(record) {
  const reason = typeof record.synthesisSkipReason === "string"
    ? record.synthesisSkipReason.trim() : "";
  if (!reason) return "";
  let line;
  if (reason === "all legs failed") {
    line = "Writing the answer was tried, but every writing service failed or did not answer in time, so the answer was assembled from source excerpts.";
  } else if (reason === "budget" || reason === "subrequest budget exhausted") {
    line = "Writing the answer did not finish, because the search had reached its working limit, so the answer was assembled from source excerpts.";
  } else if (reason === "gate") {
    line = "Writing the answer was not tried, because this account was not cleared for a written answer on this search, so the answer was assembled from source excerpts.";
  } else if (reason === "answer had no citations") {
    line = "A written draft was set aside because it did not cite its sources, so the answer was assembled from source excerpts.";
  } else if (reason === "no citable evidence") {
    line = "No paper cleared the bar to be cited, so there was no evidence a written answer could rest on.";
  } else if (reason === "drafts rejected downstream") {
    line = "A written draft was produced, but a later check set it aside, so the answer was assembled from source excerpts.";
  } else if (reason === "no legs recorded") {
    line = "No writing service was recorded as having run for this search, so the answer was assembled from source excerpts.";
  } else if (reason === "definition") {
    line = "The writing services did not run for this search, because the question was handled as a definition lookup.";
  } else if (reason.startsWith("the cited set did not engage")) {
    line = "The answer was rebuilt, because the papers it first cited did not engage the subject of the question.";
  } else {
    line = "Writing the answer did not complete for this search, so the answer was assembled from source excerpts.";
  }
  const legs = record.synthesisFailedLegs;
  if (legs && typeof legs === "object" && Number.isFinite(legs.total) && legs.total > 0) {
    const kinds = [];
    const counted = (n, oneText, manyText) => (n === 1 ? oneText : manyText.replace(/\{n\}/g, String(n)));
    if (legs.rateLimited > 0) kinds.push(counted(legs.rateLimited, "1 was at its usage limit", "{n} were at their usage limits"));
    if (legs.timedOut > 0) kinds.push(counted(legs.timedOut, "1 did not answer in time", "{n} did not answer in time"));
    if (legs.serverError > 0) kinds.push(counted(legs.serverError, "1 answered with a server error", "{n} answered with a server error"));
    if (legs.budgetStopped > 0) kinds.push(counted(legs.budgetStopped, "1 stopped at the working limit", "{n} stopped at the working limit"));
    if (legs.other > 0) kinds.push(counted(legs.other, "1 failed for another reason", "{n} failed for other reasons"));
    if (kinds.length) {
      line += " Of the writing services that were tried, "
        + (legs.total === 1 ? "1 failed" : legs.total + " failed")
        + ": " + kinds.join(", ") + ".";
    }
  }
  return line;
}

/* The claim check's tier trace (2026-10-14, wave sixteen,
 * eighth panel, Trust): the record's JSON carried factCheckTrace
 * since wave thirteen, but this page — the reader facing health
 * view of the run — never rendered it, so a search whose check
 * never landed looked identical here to one whose check landed
 * clean. Since 2026-11-06 (cold demo fix) the section prints the
 * trace through factCheckPlainLines above: the stored tier names
 * are vendor names and the stored detail is the provider's own
 * error text, so neither may print. What prints is what happened,
 * in plain words; a record written before the trace existed (or
 * one the stage produced no trace for) says so in the page's
 * standard not recorded sentence. */
function recordFactCheckSection(record) {
  const lines = factCheckPlainLines(record.factCheckTrace);
  if (lines.length === 0) {
    return "<h2>Fact check</h2>\n<p>Fact check attempts were not recorded for this search.</p>";
  }
  const items = lines.map((line) => "<li>" + esc(line) + "</li>");
  return "<h2>Fact check</h2>\n<ul>" + items.join("") + "</ul>";
}

/* The budget section in plain words (2026-11-06, cold demo fix,
 * replacing the 2026-10-14 ledger rendering). The stored ledger
 * counts subrequests and refused grants: working machinery, not
 * facts a reader can use, and a live record printed them raw
 * ("Subrequests: 50 used of a limit of 50", "4 grants were
 * refused at the budget ceiling"). What a reader can use is
 * whether the search finished its planned work. The refusal
 * count is the one honest signal: above zero, some planned
 * lookups never ran and the answer rests on what was gathered;
 * at zero, the search stayed within its working limit. Numbers
 * from the ledger never print. Rendered only when the record
 * carries a ledger with real totals; older records say the
 * counts were not recorded, in the page's usual way. */
function recordBudgetSection(record) {
  const L = record.ledger;
  if (!L || typeof L !== "object" || !Number.isFinite(L.used) || !Number.isFinite(L.limit)) {
    return "<h2>Budget</h2>\n<p>Budget counts were not recorded for this search.</p>";
  }
  const line = Number.isFinite(L.refused) && L.refused > 0
    ? "This search reached its working limit, so some of its planned lookups never ran. The answer rests on the sources that were gathered."
    : "This search stayed within its working limit.";
  return "<h2>Budget</h2>\n<p>" + line + "</p>";
}

/* Retraction flags on the record (2026-11-06, Scite audit wave 1).
 * The verdict rule lives in functions/lib/retraction.js and is the
 * same one the app renders: "retracted" only on two independent
 * channels, one channel alone is "reported" and worded that way.
 * The page resolves the record's DOIs live at serve time (records
 * are read rarely, and this route is far off the search path), with
 * an isolate memo at a 24 hour TTL, and falls back to the verdict
 * the search froze into the record when the live channels cannot
 * answer. A failure anywhere here degrades to no flag, never to a
 * broken record page. */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const recordRetractionMemo = new Map();

function joinRetractionNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list.join("");
  if (list.length === 2) return list.join(" and ");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

async function fetchJsonTimeout(url, ms = 8000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function retractionVerdictsFor(record) {
  const byDoi = {};
  const sources = Array.isArray(record.sources) ? record.sources : [];
  const dois = [];
  for (const s of sources) {
    const d = normalizeRetractionDoi((s && (s.doi || s.url)) || "");
    if (d && !dois.includes(d)) dois.push(d);
  }
  const now = Date.now();
  const cold = [];
  for (const d of dois) {
    const hit = recordRetractionMemo.get(d);
    if (hit && hit.expiresAt > now) byDoi[d] = hit.data;
    else cold.push(d);
  }
  if (cold.length) {
    try {
      const resolved = await resolveRetractionStatuses(cold.slice(0, 40), fetchJsonTimeout);
      for (const d of cold) {
        if (resolved[d]) {
          byDoi[d] = resolved[d];
          recordRetractionMemo.set(d, { data: resolved[d], expiresAt: now + 24 * 60 * 60 * 1000 });
        }
      }
    } catch { /* flags are an enrichment; the page renders without them */ }
  }
  return byDoi;
}

function verdictForSource(entry, byDoi) {
  const d = normalizeRetractionDoi((entry && (entry.doi || entry.url)) || "");
  const live = d ? byDoi[d] : null;
  if (live && live.status && live.status !== "unknown") return live;
  const det = entry && entry.retractionDetail;
  if (det && det.status && det.status !== "unknown" && det.status !== "none") return det;
  if (entry && entry.retracted) return { status: "reported", namedBy: ["Crossref"], notices: [] };
  if (entry && entry.concern) return { status: "concern", namedBy: ["Crossref"], notices: [] };
  return live || null;
}

function noticeText(verdict) {
  const kinds = verdict.status === "retracted" || verdict.status === "reported"
    ? ["retraction", "withdrawal"]
    : verdict.status === "concern" ? ["concern"] : ["correction"];
  const notices = Array.isArray(verdict.notices) ? verdict.notices : [];
  const n = notices.find((x) => kinds.includes(x.kind)) || notices[0];
  if (!n) return "";
  const label = { retraction: "Retraction notice", withdrawal: "Withdrawal notice", concern: "Concern notice", correction: "Correction notice" }[n.kind] || "Notice";
  let when = "";
  const m = typeof n.date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(n.date) : null;
  if (m) when = ", " + Number(m[3]) + " " + MONTH_NAMES[Number(m[2]) - 1] + " " + m[1];
  const text = label + when;
  if (n.noticeDoi) return ' <a href="https://doi.org/' + esc(n.noticeDoi) + '">' + esc(text) + "</a>.";
  return " " + esc(text) + ".";
}

function srcFlagHtml(entry, byDoi) {
  const v = verdictForSource(entry, byDoi);
  if (!v) return "";
  const names = joinRetractionNames(v.namedBy || []);
  if (v.status === "retracted") {
    return '<p class="srcflag"><span class="rf-retracted"><b>Retracted.</b></span>'
      + (names ? " Named by " + esc(names) + "." : "") + noticeText(v) + "</p>";
  }
  if (v.status === "reported") {
    return '<p class="srcflag"><span class="rf-retracted"><b>Reported as retracted.</b></span>'
      + (names ? " Named by " + esc(names) + " so far." : "") + " No second source has confirmed it yet." + noticeText(v) + "</p>";
  }
  if (v.status === "concern") {
    return '<p class="srcflag"><span class="rf-concern"><b>Expression of concern.</b></span>'
      + (names ? " Named by " + esc(names) + "." : "") + noticeText(v) + "</p>";
  }
  if (v.status === "corrected") {
    return '<p class="srcflag"><span class="rf-corrected"><b>Corrected.</b></span>'
      + (names ? " A correction notice is on record with " + esc(names) + "." : " A correction notice is on record.") + noticeText(v) + "</p>";
  }
  return "";
}

function recordPage(record, url, retractionByDoi = {}) {
  const parts = [];
  parts.push("<h1>Search record</h1>");
  parts.push('<p class="meta">Permanent link: <a href="' + esc(url) + '">' + esc(url) + "</a></p>");
  const healthNote = recordHealthNote(record);
  if (healthNote) parts.push('<p class="note">' + esc(healthNote) + "</p>");
  const synthesisFailureNote = recordSynthesisFailureNote(record);
  if (synthesisFailureNote) parts.push('<p class="note">' + esc(synthesisFailureNote) + "</p>");

  parts.push("<h2>Question</h2>");
  parts.push("<p>" + esc(record.question || "") + "</p>");

  parts.push("<h2>When</h2>");
  let when = String(record.askedAt || "");
  const parsed = Date.parse(when);
  if (!Number.isNaN(parsed)) when = new Date(parsed).toUTCString();
  parts.push("<p>" + esc(when) + "</p>");

  parts.push("<h2>How it searched</h2>");
  const how = [];
  if (record.structuredQuery) how.push("<li>Structured query: " + esc(record.structuredQuery) + "</li>");
  if (Array.isArray(record.conceptQueries) && record.conceptQueries.length) {
    how.push("<li>Concept expanded queries: " + esc(record.conceptQueries.join("; ")) + "</li>");
  }
  if (Array.isArray(record.llmExpansion) && record.llmExpansion.length) {
    for (const g of record.llmExpansion) {
      if (!g || typeof g !== "object") continue;
      how.push("<li>Model proposed synonyms for " + esc(g.term || "") + ": "
        + esc(Array.isArray(g.alternates) ? g.alternates.join(", ") : "") + "</li>");
    }
  }
  parts.push(how.length ? "<ul>" + how.join("") + "</ul>" : "<p>The question was searched as written.</p>");

  parts.push("<h2>Executed queries</h2>");
  if (Array.isArray(record.executedQueries) && record.executedQueries.length) {
    const items = [];
    for (const q of record.executedQueries) {
      if (!q || !q.query) continue;
      items.push("<li>" + esc(EXECUTED_QUERY_KIND_LABELS[q.kind] || q.kind || "Query") + ": " + esc(q.query) + "</li>");
    }
    parts.push(items.length ? "<ul>" + items.join("") + "</ul>"
      : "<p>The individual queries that ran were not recorded for this search.</p>");
  } else {
    parts.push("<p>The individual queries that ran were not recorded for this search.</p>");
  }

  parts.push("<h2>Databases</h2>");
  if (Array.isArray(record.databases) && record.databases.length) {
    const items = record.databases.map((d, i) => {
      const entry = d && typeof d === "object" ? d : {};
      // Wave 1B (lane 2 D3): the three honest failure states. A
      // source carrying notSearched was never searched, and one
      // whose recorded error is the retrieval budget was stopped
      // by that budget; neither is a source that did not respond.
      // 2026-11-07 (record wording cleanup): the budget stop's
      // wording is plain now, in the budget section's own
      // vocabulary; "retrieval budget" was internal machinery.
      const state = entry.ok
        ? esc(entry.count) + " paper" + (entry.count === 1 ? "" : "s") + " returned"
        : (entry.budgetStopped === true || (typeof entry.error === "string" && /subrequest|budget/i.test(entry.error))) ? "stopped when the search reached its working limit"
        : Number(entry.attempts) > 0 ? "did not respond"
        : Number(entry.notSearched) > 0 ? "not searched"
        : "did not respond";
      return "<li>" + esc(entry.source || "") + ": " + state + "</li>";
    });
    parts.push("<ol>" + items.join("") + "</ol>");
  } else {
    parts.push("<p>Per database outcomes were not recorded for this search.</p>");
  }

  parts.push("<h2>Funnel</h2>");
  if (record.funnel && typeof record.funnel === "object") {
    const f = record.funnel;
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "not recorded");
    // Wave 1B (lane 2 D2): the shelf and cited lines join the
    // list so this page prints the same eight figures as the in
    // page panel and the Markdown export. The shelf reads the
    // stored canonical counts when present, else the funnel's
    // own arithmetic.
    const shelf = record.counts && typeof record.counts === "object" && typeof record.counts.shelf === "number"
      ? record.counts.shelf
      : (typeof f.deduped === "number" && typeof f.excludedWeak === "number" ? f.deduped - f.excludedWeak : null);
    parts.push("<ul>"
      + "<li>Gathered: " + num(f.gathered) + "</li>"
      + "<li>Deduped: " + num(f.deduped) + "</li>"
      + "<li>Excluded as weak matches: " + num(f.excludedWeak) + "</li>"
      + "<li>Excluded as non English: " + num(f.excludedNonEnglish) + "</li>"
      + "<li>Excluded as retracted: " + num(f.excludedRetracted) + "</li>"
      + "<li>Kept by the relevance floor (the shelf): " + num(shelf) + "</li>"
      // The label names the final source list, so the number is that
      // list's length, counted from the list itself . f.cited is the
      // smaller set the answer actually cited, and printing it here
      // understated the list the label describes (2026-10-14).
      + "<li>In the final source list: " + num(Array.isArray(record.sources) ? record.sources.length : null) + "</li>"
      + "<li>Cited in the answer: " + num(f.cited) + "</li>"
      + "</ul>");
  } else {
    parts.push("<p>Funnel counts were not recorded for this search.</p>");
  }

  parts.push(recordBudgetSection(record));

  parts.push(recordFactCheckSection(record));

  parts.push("<h2>Model</h2>");
  parts.push("<p>" + (record.synthesisModel
    ? esc(recordModelPlain(record.synthesisModel))
    : "No AI synthesis model ran for this answer.") + "</p>");

  parts.push("<h2>Sources</h2>");
  if (Array.isArray(record.sources) && record.sources.length) {
    // Retraction notes first, at the head of the list, when a paper
    // the answer actually cited carries one: the record must not
    // present a retracted paper as ordinary support.
    const citedVerdicts = record.sources
      .filter((s) => s && s.cited)
      .map((s) => verdictForSource(s, retractionByDoi))
      .filter(Boolean);
    const citedRetracted = citedVerdicts.filter((v) => v.status === "retracted").length;
    const citedReported = citedVerdicts.filter((v) => v.status === "reported").length;
    if (citedRetracted === 1) {
      parts.push('<p class="note">One of the papers cited in this answer has been retracted. It is marked in the list below.</p>');
    } else if (citedRetracted > 1) {
      parts.push('<p class="note">' + citedRetracted + " of the papers cited in this answer have been retracted. They are marked in the list below.</p>");
    }
    if (citedReported === 1) {
      parts.push('<p class="note">One paper cited in this answer has been reported as retracted by a single source. It is marked in the list below.</p>');
    } else if (citedReported > 1) {
      parts.push('<p class="note">' + citedReported + " papers cited in this answer have been reported as retracted by a single source each. They are marked in the list below.</p>");
    }
    const items = record.sources.map((s) => {
      const entry = s && typeof s === "object" ? s : {};
      let line = esc(entry.n != null ? entry.n : "") + ". " + escTitle(entry.title || "Untitled");
      if (entry.year) line += " (" + esc(entry.year) + ")";
      if (entry.authors) line += " · " + esc(entry.authors);
      if (entry.journal) line += " · " + esc(entry.journal);
      const link = entry.doi ? "https://doi.org/" + entry.doi
        : (typeof entry.url === "string" && entry.url ? entry.url : "");
      if (link) line += ' · <a href="' + esc(link) + '">' + esc(link) + "</a>";
      line += ' <span class="tag">' + (entry.cited ? "cited in the answer" : "further reading") + "</span>";
      return '<p class="src">' + line + "</p>" + srcFlagHtml(entry, retractionByDoi);
    });
    parts.push(items.join("\n"));
  } else {
    parts.push("<p>No sources were recorded for this search.</p>");
  }

  const question = typeof record.question === "string" ? record.question : "";
  if (question) {
    parts.push("<h2>Run it again</h2>");
    parts.push("<p>Rerun this search in Cerebrum, and the record of the new run can be compared with this one.</p>");
    parts.push('<p><a class="rerun" id="cb-rerun" href="/?q=' + esc(encodeURIComponent(question)) + '">Rerun this search</a></p>');
    parts.push("<script>(function () {"
      + 'var link = document.getElementById("cb-rerun");'
      + "if (!link) return;"
      + 'link.addEventListener("click", function (ev) {'
      + "ev.preventDefault();"
      + 'var href = link.getAttribute("href") || "/";'
      + "var go = function () { window.location.href = href; };"
      + "try {"
      + 'fetch(window.location.pathname + "?format=json")'
      + ".then(function (r) { return r.ok ? r.json() : null; })"
      + ".then(function (rec) {"
      + 'if (rec) { try { window.sessionStorage.setItem("' + BASELINE_KEY + '", JSON.stringify(rec)); } catch (e) {} }'
      + "go();"
      + "})"
      + ".catch(go);"
      + "} catch (e) { go(); }"
      + "});"
      + "})();</script>");
  }

  parts.push('<div class="foot">'
    + "<p>Anyone with this link can read this record. It holds the question, the queries that ran, and the source list. It holds no answer text and nothing about who asked.</p>"
    + "<p>This record as JSON: add ?format=json to this address.</p>"
    + "</div>");

  return pageShell("Search record · Cerebrum", parts.join("\n"));
}

export async function onRequestGet(context) {
  const { request, env, params } = context || {};
  const id = params && typeof params.id === "string" ? params.id : "";
  if (!ID_SHAPE.test(id)) return notFoundPage();
  if (!env || !env.DB) return notFoundPage();

  let row = null;
  try {
    row = await env.DB.prepare(
      "SELECT record FROM search_records WHERE id = ?"
    ).bind(id).first();
  } catch {
    // The table may not exist yet on a fresh deploy. That is a
    // missing record, not a server error worth a 500.
    return notFoundPage();
  }
  if (!row || typeof row.record !== "string" || !row.record) return notFoundPage();

  let record = null;
  try { record = JSON.parse(row.record); } catch { return notFoundPage(); }
  if (!record || typeof record !== "object") return notFoundPage();

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    return new Response(row.record, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }
  const retractionByDoi = await retractionVerdictsFor(record);
  return new Response(recordPage(record, url.origin + url.pathname, retractionByDoi), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
