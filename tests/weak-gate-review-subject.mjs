/**
 * Weak evidence gate, review subject pass (2026-10-23, burnout probe).
 *
 * The live probe of "How can I fight graduate school burnout?"
 * gathered 46 papers and classed 32 weak. The first excluded
 * titles were the pool's two highest value papers: a systematic
 * review and meta analysis of empowerment and burnout among
 * nurses, and a systematic review and meta analysis of burnout
 * and patient safety. The gate terms for the question are the
 * constraint words graduate, school, burnout, so the quality
 * floor required two core hits, and each review scored exactly
 * one: burnout, the question's central subject concept, engaged
 * in title and abstract. They missed only the population
 * concept, graduate school, whose two words the floor counted
 * separately. Every existing rescue stood down because the
 * shelf was already past its minimum.
 *
 * This suite pins the calibrated floor end to end against the
 * real onRequest with a counting stub env, in the relevance
 * gate suite's shape:
 *
 *   1. Systematic reviews whose title and abstract engage the
 *      central subject concept, one hit short of the floor,
 *      survive the floor: they are not classed weak.
 *   2. The balance holds in the same pool. A pilot study with
 *      no subject engagement, a cross sectional paper with the
 *      same one hit profile as the reviews, a non review student
 *      paper with the same profile, and a systematic review
 *      with no subject engagement at all are all still classed
 *      weak. The pass is for reviews that engage the subject,
 *      not for reviews as such, and not for one hit papers as
 *      such.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/weak-gate-review-subject.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { onRequest, createSubrequestLedger } = await import(join(root, "functions/api/search.js"));

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
function group(name) {
  console.log(`\n${name}`);
}

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
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
let scenPapers = [];
let scenAnswer = "";
async function runScenario(query) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
        return chatRes("I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(scenAnswer);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger(undefined);
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "rg-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
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

const epmc = (n, title, abstractText, citedByCount) => ({
  title,
  doi: "10.1000/wg" + n,
  pubYear: "2024",
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// The on topic graduate papers: they engage every gate term, so
// they pass the floor outright and fill the shelf past its
// minimum, which is what made every existing rescue stand down
// on the live probe.
const gradPaper = (n) => epmc(100 + n,
  "Graduate school burnout and coping among graduate students study " + n,
  "Graduate students in graduate school reported burnout and academic burnout across the term. This study of graduate school burnout measured stress, sleep and coping in graduate students, and graduate school burnout tracked workload and support.",
  50 + n);

const NURSES_REVIEW = "Structural and psychological empowerment and burnout among nurses: A systematic review and meta-analysis";
const SAFETY_REVIEW = "Influence of Burnout on Patient Safety: Systematic Review and Meta-Analysis";
const HOSPITAL_REVIEW = "Burnout interventions in hospitals: a systematic review of workplace programs";
const TELEHEALTH_REVIEW = "Telehealth for glucose control in diabetes: a systematic review and meta-analysis";
const HOPETIMIZE = "A pilot study of the Hopetimize program for pediatric oncology healthcare professionals";
const STUDENT_PAPER = "Adverse childhood experiences and academic burnout among Chinese traditional medicine students: the serial mediating role of resilience";
const DIETITIANS_PAPER = "Occupational burnout, self-compassion, and general health among dietitians in Turkiye: a cross-sectional study";

function burnoutPool() {
  return [
    gradPaper(1), gradPaper(2), gradPaper(3), gradPaper(4), gradPaper(5), gradPaper(6),
    epmc(1, NURSES_REVIEW,
      "This systematic review and meta-analysis examined structural and psychological empowerment and burnout among nurses across twenty studies. Greater empowerment was associated with lower burnout, lower emotional exhaustion and lower depersonalisation. Access to support, resources and autonomy may reduce burnout in nursing work, and burnout fell where empowerment was higher.", 900),
    epmc(2, SAFETY_REVIEW,
      "This systematic review and meta-analysis assessed the influence of burnout on patient safety across studies of physicians and nurses. Burnout was associated with more patient safety incidents, poorer safety ratings and lower patient satisfaction. Reducing burnout is a patient safety priority, and burnout interventions were discussed throughout.", 1200),
    epmc(3, HOSPITAL_REVIEW,
      "This systematic review covered burnout interventions in hospital workplaces. Programs that reduced workload and increased schedule control lowered burnout scores across the included trials, and burnout was tracked before and after each workplace program.", 200),
    epmc(4, TELEHEALTH_REVIEW,
      "This systematic review and meta-analysis pooled trials of telehealth visits for glucose control in diabetes care. Remote monitoring changed glucose readings modestly, and adherence to remote visits varied across the included trials of diabetes management.", 800),
    epmc(5, HOPETIMIZE,
      "This pilot study evaluated Hopetimize, a positive psychology program for pediatric oncology healthcare professionals. Participants rated the program feasible and acceptable. Wellbeing and stress were measured in a small sample of oncology staff before and after the sessions.", 10),
    epmc(6, STUDENT_PAPER,
      "This cross sectional study examined adverse childhood experiences and academic burnout among students of traditional Chinese medicine. Academic burnout was surveyed, resilience and coping were tested as serial mediators, and burnout scores were modelled against childhood experience reports.", 40),
    epmc(7, DIETITIANS_PAPER,
      "Occupational burnout, self compassion and general health were surveyed among dietitians in one country sample. Burnout scores were associated with general health and self compassion ratings, and burnout was higher where workloads were heavier.", 30),
  ];
}

// ═══════════════════════════════════════════════════════════════════
group("burnout shape: subject engaging reviews survive the floor, the rest do not");

await test("the systematic reviews engaging burnout are not classed weak; the off topic and non review papers still are", async () => {
  scenPapers = burnoutPool();
  scenAnswer =
    "Graduate students reported burnout across the term, and graduate school burnout tracked workload and support in these studies [1]. " +
    "Coping and sleep were also measured alongside burnout in graduate school samples [2].";
  const data = await runScenario("How can I fight graduate school burnout?");
  const funnel = data._funnel || {};
  assert.equal(funnel.gathered, 13, "the pool size changed: " + JSON.stringify(funnel));
  // Exactly four papers are classed weak: the telehealth review
  // (a systematic review with no subject engagement), the
  // Hopetimize pilot (no subject engagement), and the two non
  // review one hit papers (the student paper and the dietitians
  // paper). Before the calibration the count was seven in this
  // pool: the three subject engaging reviews were in it too.
  assert.equal(funnel.excludedWeak, 4,
    "the weak count must be exactly the four papers with no review subject pass: " + JSON.stringify(funnel));
  const excluded = funnel.excludedWeakTitles || [];
  const excludedHas = (prefix) => excluded.some((t) => t.startsWith(prefix));
  for (const title of [NURSES_REVIEW, SAFETY_REVIEW, HOSPITAL_REVIEW]) {
    assert.ok(!excludedHas(title.slice(0, 40)),
      "a subject engaging systematic review is still classed weak: " + title + " in " + JSON.stringify(excluded));
  }
  for (const title of [TELEHEALTH_REVIEW, HOPETIMIZE, STUDENT_PAPER, DIETITIANS_PAPER]) {
    assert.ok(excludedHas(title.slice(0, 40)),
      "a paper that must stay weak is missing from the excluded titles: " + title + " in " + JSON.stringify(excluded));
  }
  // The on topic graduate papers still ship, so the run is a
  // normal research answer over a healthy shelf, not a rescue
  // path: the reviews joined a shelf that was never thin.
  assert.equal(data.responseKind, "research", "the run must ship a research answer: " + data.responseKind);
  const presented = [...(data.sources || []), ...(data.furtherReading || [])].map((s) => s.title);
  assert.ok(presented.some((t) => t.startsWith("Graduate school burnout")),
    "the on topic papers are missing from the shipped list: " + JSON.stringify(presented));
  assert.ok(!presented.some((t) => t.startsWith("A pilot study of the Hopetimize")),
    "the Hopetimize pilot shipped in the presented list: " + JSON.stringify(presented));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
