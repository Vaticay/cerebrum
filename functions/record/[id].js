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
    + "body{margin:0;background:#faf9f6;color:#1c1a17;font-family:Georgia,'Times New Roman',serif;}"
    + "main{max-width:760px;margin:0 auto;padding:40px 20px 64px;}"
    + "h1{font-size:28px;line-height:1.25;margin:0 0 6px;}"
    + "h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#6b665e;margin:30px 0 8px;font-family:ui-monospace,Menlo,Consolas,monospace;}"
    + "p,li{font-size:16px;line-height:1.6;}"
    + "ul,ol{padding-left:22px;margin:6px 0;}"
    + ".meta{color:#6b665e;font-size:14px;overflow-wrap:anywhere;}"
    + ".note{border:1px solid #ddd6c9;border-left:4px solid #20503c;background:#ffffff;padding:10px 14px;}"
    + ".src{margin-bottom:8px;}"
    + ".tag{color:#6b665e;font-size:14px;}"
    + "a{color:#20503c;}"
    + ".rerun{display:inline-block;margin-top:10px;padding:10px 18px;border:1px solid #20503c;border-radius:6px;color:#20503c;text-decoration:none;font-size:16px;}"
    + ".foot{margin-top:44px;border-top:1px solid #ddd6c9;padding-top:14px;color:#6b665e;font-size:14px;line-height:1.6;}"
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
 * verdict nobody stored. A healthy record gets no note. */
function recordHealthNote(record) {
  if (record.degraded === true) {
    const stages = Array.isArray(record.failedStages)
      ? record.failedStages.filter((s) => typeof s === "string" && s)
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

/* The budget line (2026-10-14): the record has carried the run's
 * subrequest ledger since the observability wave, and the page
 * rendered none of it. One compact paragraph: the total against
 * the limit, the largest stage spends by name as recorded, and the
 * refusal count only when grants were actually refused. Rendered
 * only when the record carries a ledger with real totals; older
 * records say the counts were not recorded, in the page's usual
 * way. */
function recordBudgetSection(record) {
  const L = record.ledger;
  if (!L || typeof L !== "object" || !Number.isFinite(L.used) || !Number.isFinite(L.limit)) {
    return "<h2>Budget</h2>\n<p>Budget counts were not recorded for this search.</p>";
  }
  const stages = Object.entries(L.byStage && typeof L.byStage === "object" ? L.byStage : {})
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  let line = "Subrequests: " + L.used + " used of a limit of " + L.limit + ".";
  if (stages.length) {
    line += " Largest spends: " + stages.map(([k, v]) => esc(k) + " " + v).join(", ") + ".";
  }
  if (Number.isFinite(L.refused) && L.refused > 0) {
    line += " " + L.refused + " grant" + (L.refused === 1 ? " was" : "s were") + " refused at the budget ceiling.";
  }
  return "<h2>Budget</h2>\n<p>" + line + "</p>";
}

function recordPage(record, url) {
  const parts = [];
  parts.push("<h1>Search record</h1>");
  parts.push('<p class="meta">Permanent link: <a href="' + esc(url) + '">' + esc(url) + "</a></p>");
  const healthNote = recordHealthNote(record);
  if (healthNote) parts.push('<p class="note">' + esc(healthNote) + "</p>");

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
      return "<li>" + esc(entry.source || "") + ": "
        + (entry.ok ? esc(entry.count) + " paper" + (entry.count === 1 ? "" : "s") + " returned" : "did not respond")
        + "</li>";
    });
    parts.push("<ol>" + items.join("") + "</ol>");
  } else {
    parts.push("<p>Per database outcomes were not recorded for this search.</p>");
  }

  parts.push("<h2>Funnel</h2>");
  if (record.funnel && typeof record.funnel === "object") {
    const f = record.funnel;
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "not recorded");
    parts.push("<ul>"
      + "<li>Gathered: " + num(f.gathered) + "</li>"
      + "<li>Deduped: " + num(f.deduped) + "</li>"
      + "<li>Excluded as weak matches: " + num(f.excludedWeak) + "</li>"
      + "<li>Excluded as non English: " + num(f.excludedNonEnglish) + "</li>"
      + "<li>Excluded as retracted: " + num(f.excludedRetracted) + "</li>"
      // The label names the final source list, so the number is that
      // list's length, counted from the list itself . f.cited is the
      // smaller set the answer actually cited, and printing it here
      // understated the list the label describes (2026-10-14).
      + "<li>In the final source list: " + num(Array.isArray(record.sources) ? record.sources.length : null) + "</li>"
      + "</ul>");
  } else {
    parts.push("<p>Funnel counts were not recorded for this search.</p>");
  }

  parts.push(recordBudgetSection(record));

  parts.push("<h2>Model</h2>");
  parts.push("<p>" + (record.synthesisModel
    ? esc(record.synthesisModel)
    : "No AI synthesis model ran for this answer.") + "</p>");

  parts.push("<h2>Sources</h2>");
  if (Array.isArray(record.sources) && record.sources.length) {
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
      return '<p class="src">' + line + "</p>";
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
  return new Response(recordPage(record, url.origin + url.pathname), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
