/**
 * Retrieval breadth fix (2026-11-07). Proof tests for the two
 * halves of the fix built from the same day's diagnosis
 * (~/workspace/cerebrum-retrieval-breadth-nov07/report.md).
 *
 * The proven defect: the sequenced fanout settles its priority
 * head against the full absolute retrieval deadline before the
 * tail fires at all, so one hung head member spends the tail's
 * whole slice. On 2026-11-07 Europe PMC degraded upstream
 * (503s past ten seconds); the head settle returned at the
 * deadline in 25 of 27 records, and in all 37 records on disk
 * where Europe PMC was cut, zero of the ten tail sources
 * answered. Europe PMC's own fetcher made it worse: a fixed
 * 4,000 ms timeout with one retry (worst case about 8,300 ms)
 * plus up to two sequential fallback forms, against a slice of
 * about 5,300 ms at fire time.
 *
 * What is pinned here:
 *   1. fanoutHeadDeadlineMs: the head's sub deadline protects
 *      a tail window at the end of the slice, keeps a floor of
 *      its own on a mostly spent slice, never passes the full
 *      deadline, and is null when no deadline is named (the
 *      plain allSettled behavior is untouched).
 *   2. europePMCAttemptBudget: Crossref's arithmetic as the
 *      starting point, with one deliberate divergence: below
 *      the full budget the leg takes one attempt per form
 *      sized to fit, because it chains up to three forms where
 *      Crossref fires one call, so the forms behind a slow
 *      first form need the room more than its retry does. The
 *      full budget when the remainder holds it, expired on a
 *      spent deadline, null when no deadline is named.
 *   3. The mocked europePMC fetcher under a deadline: a first
 *      form slower than any attempt the slice can fund is cut
 *      by its own budget after exactly one attempt (no retry
 *      the settle cannot read), a spent deadline fires nothing
 *      at all, and a form that fits its budget answers
 *      normally.
 *   4. The handler, driven end to end with a hung head member:
 *      Europe PMC's fetch honors its abort signal and never
 *      answers, exactly the degraded origin's shape. The tail
 *      still answers and its results are read (the arXiv
 *      record carries ok with a real count), and Europe PMC
 *      records the deadline outcome, not a silent zero.
 *   5. A slow head member whose forms land inside the full
 *      slice is not lost: its slow first form is cut at the
 *      sub deadline settle under both the old code and the
 *      new, and its fallback forms answer inside the slice;
 *      the slot the sub deadline recorded as cut is replaced
 *      by the real outcome when the runner re reads the head
 *      promises against the full deadline, and the tail is
 *      recorded as answered beside it.
 *
 * Run with: node tests/retrieval-breadth-nov07.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));

const {
  onRequest, createSubrequestLedger,
  fanoutHeadDeadlineMs, europePMCAttemptBudget, europePMC,
} = search;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function group(name) { console.log(`\n${name}`); }

/* ── 1. The head sub deadline ─────────────────────────────── */
group("fanoutHeadDeadlineMs — the protected tail window");

await test("a full slice protects the tail window at its end", () => {
  const now = 1000000;
  assert.equal(fanoutHeadDeadlineMs(now + 6000, now), now + 4000,
    "a 6,000 ms slice must settle the head by 4,000 ms");
  assert.equal(fanoutHeadDeadlineMs(now + 10000, now), now + 8000);
});

await test("a mostly spent slice still floors the head window", () => {
  const now = 1000000;
  assert.equal(fanoutHeadDeadlineMs(now + 1500, now), now + 1500,
    "the floored rung hands the head its whole slice, as before");
  assert.equal(fanoutHeadDeadlineMs(now + 2500, now), now + 1500,
    "the head keeps its floor and the tail keeps what is left");
  assert.equal(fanoutHeadDeadlineMs(now + 3400, now), now + 1500);
  assert.equal(fanoutHeadDeadlineMs(now + 3600, now), now + 1600);
});

await test("no deadline named keeps the plain settle, and the head deadline never passes the full one", () => {
  const now = 1000000;
  assert.equal(fanoutHeadDeadlineMs(null, now), null);
  assert.equal(fanoutHeadDeadlineMs(undefined, now), null);
  for (const slice of [0, 100, 1499, 1500, 2000, 3500, 6000, 20000]) {
    const h = fanoutHeadDeadlineMs(now + slice, now);
    assert.ok(h <= now + slice, "the head deadline passed the full deadline at slice " + slice);
    assert.ok(h >= now, "the head deadline fell behind now at slice " + slice);
  }
});

/* ── 2. Europe PMC attempt budgeting ──────────────────────── */
group("europePMCAttemptBudget — deadline sized attempts");

await test("the attempt budget fits the slice it is given", () => {
  const now = 1000000;
  assert.equal(europePMCAttemptBudget(null, now), null, "no deadline must keep the baseline budget");
  const full = europePMCAttemptBudget(now + 60000, now);
  assert.equal(full.timeoutMs, 4000, "a roomy slice must keep the fetcher's own budget");
  assert.equal(full.retries, 1);
  for (const remaining of [8600, 5300, 4000, 2500, 1300, 900, 400]) {
    const b = europePMCAttemptBudget(now + remaining, now);
    assert.ok(!b.expired, "a positive remainder reads as expired at " + remaining);
    const worst = b.timeoutMs * (b.retries + 1) + 300 * b.retries;
    assert.ok(worst <= remaining,
      `the budget overruns its slice: ${b.timeoutMs} x${b.retries + 1} = ${worst} > ${remaining}`);
    assert.ok(b.timeoutMs >= 100, "the attempt window collapsed at " + remaining);
  }
  // Below the full budget the leg takes one attempt per form:
  // the three forms are chained, so a slow first form's retry
  // would spend the room its own fallback forms need.
  for (const remaining of [5300, 4000, 2500, 1300, 900]) {
    const b = europePMCAttemptBudget(now + remaining, now);
    assert.equal(b.retries, 0,
      "a sub full slice funds a retry at " + remaining + ", starving the fallback forms");
  }
  const dead = europePMCAttemptBudget(now - 1, now);
  assert.equal(dead.expired, true, "a spent deadline must read as expired");
});

/* ── 3. The fetcher under a deadline (mocked fetch) ───────── */
group("europePMC — the fetcher honors its slice");

const jsonRes = (obj) => ({
  status: 200, ok: true,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});
const onRow = {
  title: "Sleep apnea treatment outcomes with CPAP therapy",
  abstractText: "Patients with sleep apnea received treatment. Sleep apnea treatment outcomes improved over one year.",
  doi: "10.1000/sleep.1", pubYear: "2023", authorString: "Roe K",
  journalTitle: "Sleep Medicine", citedByCount: 9, source: "MED", id: "2",
};
const Q = "sleep apnea treatment outcomes";

await test("a first form slower than the slice is cut by its own budget after one attempt", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts2 = {}) => {
    calls++;
    // The degraded origin's shape: the response would land at
    // 10 s, but the fetcher's own abort ends the attempt at its
    // budgeted timeout, exactly as a real slow 503 does.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonRes({ resultList: { result: [onRow] } })), 10000);
      const sig = opts2 && opts2.signal;
      if (sig) {
        if (sig.aborted) { clearTimeout(timer); reject(new Error("aborted")); return; }
        sig.addEventListener("abort", () => {
          clearTimeout(timer);
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        }, { once: true });
      }
    });
  };
  try {
    const deadline = Date.now() + 1500;
    const t0 = Date.now();
    const papers = await europePMC(Q, 8, null, { deadlineMs: deadline });
    const elapsed = Date.now() - t0;
    assert.equal(calls, 1,
      "the leg fired a retry or a fallback form the settle cannot read, calls=" + calls);
    assert.ok(Array.isArray(papers) && papers.length === 0,
      "a cut leg must read as a marked failure, not as rows");
    assert.ok(typeof papers.fetchError === "string" && papers.fetchError.length > 0,
      "the failure is not marked: " + JSON.stringify(papers.fetchError));
    assert.ok(elapsed < 2500,
      "the leg outran its slice instead of being cut by its budget: " + elapsed + " ms");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("a spent deadline fires nothing and records the deadline outcome", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonRes({ resultList: { result: [onRow] } }); };
  try {
    const papers = await europePMC(Q, 8, null, { deadlineMs: Date.now() - 5 });
    assert.equal(calls, 0, "the leg fired into a spent slice, calls=" + calls);
    assert.ok(Array.isArray(papers) && papers.length === 0);
    assert.ok(/retrieval deadline/.test(String(papers.fetchError || "")),
      "the outcome does not name the deadline: " + JSON.stringify(papers.fetchError));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("a form that fits its budget answers normally under a deadline", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return jsonRes({ resultList: { result: [onRow] } }); };
  try {
    const papers = await europePMC(Q, 8, null, { deadlineMs: Date.now() + 60000 });
    assert.equal(calls, 1);
    assert.equal(papers.length, 1);
    assert.ok(papers[0].title.includes("Sleep apnea"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ── 4 and 5. The handler with a hung head member ─────────── */
group("handler — a hung head member cannot spend the tail");

function rgDb() {
  const st = (sql) => {
    const s = {
      bind: () => s,
      first: async () => {
        if (/CASE WHEN search_slots\.expires_at/.test(sql || "")) return { n: 1 };
        return null;
      },
      all: async () => {
        if (/sqlite_master/.test(sql || "")) {
          return { results: [
            { name: "pro_usage", sql: "CREATE TABLE pro_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, ai_answers INTEGER NOT NULL DEFAULT 0, doc_reads INTEGER NOT NULL DEFAULT 0, flowcharts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))" },
            { name: "stripe_events", sql: "CREATE TABLE stripe_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)" },
            { name: "student_verifications", sql: "CREATE TABLE student_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)" },
          ] };
        }
        return { results: [] };
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return s;
  };
  return {
    prepare: (sql) => st(sql),
    batch: async (arr) => (arr || []).map(() => ({ success: true })),
    exec: async () => ({ results: [] }),
  };
}

function chatRes(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}
function jsonHttpRes(obj, status = 200) {
  return new Response(JSON.stringify(obj),
    { status, headers: { "Content-Type": "application/json" } });
}

const WLK_Q = "does a short walk after dinner help your sugar come down";
const ARXIV_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
  "  <entry>\n" +
  "    <id>http://arxiv.org/abs/2401.00001v1</id>\n" +
  "    <title>A short walk after dinner and blood sugar in adults</title>\n" +
  "    <summary>Adults took a short walk after dinner on one evening and sat after dinner on another. Blood sugar after the meal was lower on the walking evening, and a short walk after dinner helped sugar come down compared with sitting.</summary>\n" +
  "    <published>2024-01-15T00:00:00Z</published>\n" +
  "    <author><name>Doe J</name></author>\n" +
  "  </entry>\n" +
  "</feed>\n";
const PUBMED_XML = (pmid, title, abstract) =>
  "<PubmedArticleSet><PubmedArticle>" +
  "<PMID>" + pmid + "</PMID>" +
  "<ArticleTitle>" + title + "</ArticleTitle>" +
  "<AbstractText>" + abstract + "</AbstractText>" +
  "<Journal><Title>Journal of Recorded Studies</Title></Journal>" +
  "<PubDate><Year>2023</Year></PubDate>" +
  "</PubmedArticle></PubmedArticleSet>";
const WALK_ABSTRACT =
  "Adults took a short walk after dinner on one evening and sat after dinner on another. " +
  "Blood sugar after the meal was lower on the walking evening, and a short walk after " +
  "dinner helped sugar come down compared with sitting.";

// scenEpmc: "hung" (never answers, honors abort), "slow" (answers
// at SLOW_EPMC_MS honoring abort), "fast" (answers at once).
let scenEpmc = "hung";
// The slow member's first form lands just past the sub deadline
// sized first attempt (2,500 ms at a 5,300 ms remaining slice),
// so under BOTH the old code and the new one its first form is
// cut at the rung; what the re read recovers is its fallback
// forms, which fit inside the slice. The second form lands
// quickly and on topic.
const SLOW_EPMC_MS = 2600;
const scenAnswerText =
  "## Short answer\n\nA short walk after dinner lowered blood sugar after the meal [1]. " +
  "The studies followed adults who ate the same evening meal on two nights, walking for a " +
  "short while after one and sitting after the other, and the recorded blood sugar after " +
  "the meal ran lower on the walking nights across the group [1].";

let epmcCalls = 0;

async function runHungScenario() {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  epmcCalls = 0;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai") || u.includes("api.groq.com")) {
      if (body.includes("rigorous scientific fact-checker")) return chatRes("no verdict available");
      return chatRes(scenAnswerText);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      if (scenEpmc === "fast" || (scenEpmc === "slow" && epmcCalls > 1)) {
        return jsonHttpRes({ resultList: { result: [{
          title: "A short walk after dinner and blood sugar control",
          abstractText: WALK_ABSTRACT,
          doi: "10.1000/breadth-epmc-1", pubYear: "2022", citedByCount: 40,
          authorString: "Doe J, Roe K", journalTitle: "Journal of Recorded Studies",
          source: "MED", id: "901",
        }] } });
      }
      // Hung and slow share one first form shape: a response
      // that would land far outside the slice, ended early only
      // by the fetcher's own abort, exactly as the degraded
      // origin behaves. Slow's first form lands at
      // SLOW_EPMC_MS if nothing aborts it first; hung never
      // lands. The slow leg's later forms answer at once.
      return new Promise((resolve, reject) => {
        const timer = scenEpmc === "slow"
          ? setTimeout(() => resolve(jsonHttpRes({ resultList: { result: [{
              title: "A short walk after dinner and blood sugar control",
              abstractText: WALK_ABSTRACT,
              doi: "10.1000/breadth-epmc-1", pubYear: "2022", citedByCount: 40,
              authorString: "Doe J, Roe K", journalTitle: "Journal of Recorded Studies",
              source: "MED", id: "901",
            }] } })), SLOW_EPMC_MS)
          : null;
        const sig = opts2 && opts2.signal;
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        };
        if (sig) {
          if (sig.aborted) { onAbort(); return; }
          sig.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonHttpRes({ esearchresult: { idlist: ["111"] } });
      if (u.includes("efetch")) {
        return new Response(PUBMED_XML("111", "A short walk after dinner and blood sugar control", WALK_ABSTRACT),
          { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      return jsonHttpRes({});
    }
    if (u.includes("export.arxiv.org")) {
      return new Response(ARXIV_XML, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    }
    if (u.includes("api.openalex.org")) return jsonHttpRes({ results: [] });
    if (u.includes("api.crossref.org")) return jsonHttpRes({ message: { items: [] } });
    if (u.includes("api.semanticscholar.org")) return jsonHttpRes({ data: [] });
    return jsonHttpRes({});
  };
  try {
    const ledger = createSubrequestLedger(400);
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "breadth-nov07-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: WLK_Q, settings: { factCheck: true } }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return data;
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("hung Europe PMC: the tail still answers and its results are read", async () => {
  scenEpmc = "hung";
  const data = await runHungScenario();
  const dbs = (data._record && data._record.databases) || [];
  const arx = dbs.find((d) => d.source === "arxiv");
  assert.ok(arx && arx.ok && arx.count >= 1,
    "the tail never answered behind a hung head member: arxiv=" + JSON.stringify(arx) +
    " all=" + JSON.stringify(dbs.map((d) => [d.source, d.ok, d.count])));
  const epmc = dbs.find((d) => d.source === "europePMC");
  assert.ok(epmc && !epmc.ok,
    "the hung head member recorded as answered: " + JSON.stringify(epmc));
}, 90000);

await test("slow Europe PMC whose forms land inside the full slice is recovered by the head re read, tail intact", async () => {
  scenEpmc = "slow";
  const data = await runHungScenario();
  const dbs = (data._record && data._record.databases) || [];
  const epmc = dbs.find((d) => d.source === "europePMC");
  assert.ok(epmc && epmc.ok && epmc.count >= 1,
    "a head member that landed inside the full slice was lost: " + JSON.stringify(epmc) +
    " all=" + JSON.stringify(dbs.map((d) => [d.source, d.ok, d.count])));
  const arx = dbs.find((d) => d.source === "arxiv");
  assert.ok(arx && arx.ok && arx.count >= 1,
    "the tail lost its answer while the head recovered: arxiv=" + JSON.stringify(arx));
}, 90000);

console.log(`\nretrieval-breadth-nov07: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
