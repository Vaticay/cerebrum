/**
 * Answer depth (2026-10-14) — the Brief / Standard / Detailed
 * setting (settings answerLength: "short" | "medium" | "long")
 * must materially change the answer, and the depths must never
 * serve each other's work.
 *
 * The production evidence (Dusty's photo, 2026-10-13 evening):
 * Detailed was selected in his settings and the answer that came
 * back was a two sentence summary and a thin body over 21 gathered
 * papers — the extractive shape, at the same size every depth got.
 * The diagnosis this suite pins against:
 *
 *   1. The answer cache key was the question alone. Both cache
 *      reads serve a stored row on score alone, so a verified
 *      Standard answer was served verbatim against a Detailed
 *      request — one mechanism that produces exactly his photo.
 *   2. The extractive builder never received the setting at all:
 *      its lede, per paper findings, theme clusters and cited pool
 *      were capped the same at every depth, so the path his answer
 *      actually took (its closing line names the extractive
 *      assembly) could not have honored Detailed even if synthesis
 *      had been attempted first and failed.
 *   3. Nothing in the response or the record stated the depth
 *      used, so a served answer could not be checked against the
 *      setting that supposedly produced it.
 *
 * What is pinned here:
 *   A. The extractive builder assembles at the requested depth:
 *      the same gated shelf yields a visibly deeper answer at
 *      Detailed than at Standard than at Brief (more cited papers,
 *      more findings per paper, more lede claims), and an absent
 *      setting assembles exactly as Standard.
 *   B. Handler level, with stubbed providers shaped like the real
 *      fleet: the same question at Brief and at Detailed produces
 *      visibly different answers. The provider stub answers from
 *      what the handler actually sends — it returns the deep
 *      answer only when the request carries the Detailed depth
 *      block, the short one only at the Brief budget — so the test
 *      measures the handler's side of the contract: Detailed must
 *      send a materially larger token budget (6400 against Brief's
 *      1200) with the depth prompt, Brief its small one. The
 *      shipped answers must differ accordingly (Detailed at least
 *      twice Brief's length, more sections, more finding
 *      passages), and both the response and its record must state
 *      the depth used.
 *   C. The cache fixture: a Standard answer is produced and
 *      stored, its row is verified (score raised, as upvotes do),
 *      and a Detailed request for the same question must NOT be
 *      served it — it runs its own synthesis at its own depth —
 *      while a second Standard request IS served the stored
 *      Standard answer. Depths cache separately or not at all.
 *
 * Run with: node tests/answer-depth.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const { onRequest, createSubrequestLedger, buildExtractiveSynthesis } =
  await import(join(root, "functions/api/search.js"));

// ═══════════════════════════════════════════════════════════════
group("extractive builder — depth widens the assembly, same evidence");

// Twelve papers on one question, each carrying three finding
// dense sentences with its own numbers (the builder dedupes exact
// duplicate claims, so shared sentences would cap every depth at
// the same handful of lines). Twelve papers means the cited pool
// cap binds at every depth: 6 papers at Brief, 8 at Standard, 12
// at Detailed — the caps are what limits the answer, not the shelf.
const DEPTH_Q = "does sleep deprivation impair memory consolidation";
const SHELF = Array.from({ length: 12 }, (_, k) => {
  const i = k + 1;
  return {
    title: "Sleep deprivation and memory consolidation, cohort study " + i,
    abstract:
      `Sleep deprivation reduced memory consolidation by ${28 + i}% compared with rested controls. ` +
      `Participants who slept after learning retained ${76 + i}% of the word pairs after one week. ` +
      `Each additional hour of slow wave sleep was associated with a ${4 + i}% improvement in next day recall.`,
    year: 2024,
    journal: "Journal of Sleep Research",
  };
});

const buildAt = (answerLength) => buildExtractiveSynthesis(
  SHELF.map((p) => ({ ...p })), [],
  answerLength === undefined
    ? { query: DEPTH_Q }
    : { query: DEPTH_Q, answerLength }
);
const ledeCitations = (md) => {
  const head = md.split("## What the research shows")[0];
  return (head.match(/\[\d+\]/g) || []).length;
};
const researchBullets = (md) => {
  const section = md.split("## What the research shows")[1].split("\n## ")[0];
  return section.split("\n").filter((l) => l.startsWith("- ")).length;
};

await test("Detailed assembles more of the same shelf than Standard, Standard more than Brief", () => {
  const brief = buildAt("short");
  const standard = buildAt("medium");
  const detailed = buildAt("long");
  for (const [label, md] of [["brief", brief], ["standard", standard], ["detailed", detailed]]) {
    assert.ok(md, label + ": expected an extractive answer");
    assert.ok(md.startsWith("## Summary"), label + ": lede heading is not ## Summary");
    assert.ok(!md.includes("Executive Summary"), label + ": old heading still produced");
  }
  assert.ok(standard.length > brief.length,
    `Standard (${standard.length}) should exceed Brief (${brief.length})`);
  assert.ok(detailed.length > standard.length,
    `Detailed (${detailed.length}) should exceed Standard (${standard.length})`);
  assert.ok(detailed.length >= brief.length * 1.5,
    `Detailed (${detailed.length}) should be at least half again Brief (${brief.length})`);
  // The depth is structural, not padding: more lede claims up
  // front and more finding lines in the research section.
  assert.equal(ledeCitations(brief), 1, "Brief lede should carry one claim");
  assert.equal(ledeCitations(standard), 2, "Standard lede should carry two claims");
  assert.equal(ledeCitations(detailed), 3, "Detailed lede should carry three claims");
  assert.ok(researchBullets(detailed) > researchBullets(standard),
    `Detailed research bullets (${researchBullets(detailed)}) should exceed Standard (${researchBullets(standard)})`);
  assert.ok(researchBullets(standard) > researchBullets(brief),
    `Standard research bullets (${researchBullets(standard)}) should exceed Brief (${researchBullets(brief)})`);
});

await test("an absent depth setting assembles exactly as Standard", () => {
  const unset = buildAt(undefined);
  const standard = buildAt("medium");
  assert.equal(unset, standard, "no setting must keep the historical assembly");
});

// ═══════════════════════════════════════════════════════════════
group("handler level — Brief and Detailed send different budgets and ship different answers");

// The rich draw from tests/subrequest-budget.mjs, reused: two
// papers per Europe PMC call on the baby belly question, a full
// pipeline inside the subrequest cap. The chat stub answers
// synthesis calls from what the handler actually sent: the deep
// answer only when the Detailed depth block is in the prompt, the
// brief answer only when the Brief hint is, the standard answer
// otherwise. A stubbed model shaped like the real thing: it writes
// to the depth it was asked for.
const QUERY = "Do the germs in a baby belly change how well the baby grows";
const queryWords = QUERY.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
const richAbstract = (n) =>
  ("Study " + n + " on " + queryWords.join(" ") + ". " +
   "This paper examines " + queryWords.join(", ") + " in detail. " +
   "The findings show clear effects for " + queryWords.slice(0, 4).join(" and ") + " across the first year of life. ").repeat(2);

const BRIEF_ANSWER = [
  "## The short answer",
  "",
  "The microbes in a baby’s gut **shape growth** from the first weeks of life [1]. They help the baby draw energy from food and train the immune system, and when the community is disturbed early, weight gain can slow until it recovers [2].",
  "",
  "## What the research shows",
  "",
  "**Gut microbes** influence how nutrients are absorbed and how weight is gained over the first year [1][2].",
].join("\n");

// The Standard serve, sized the way Standard serves actually
// run (the fifth panel measured 2,590 chars live): the same
// section shape as Detailed, worked at standard depth. Until
// wave six this stub was three sentences (298 chars), which made
// every Standard to Detailed ratio in this suite meaningless —
// the panel's +32 percent failure (2,590 vs 3,415) could not
// even be expressed against it.
const MEDIUM_ANSWER = [
  "The microbes living in an infant gut **shape growth** from the first weeks of life [1]. The community helps the baby draw energy from food and trains the immune system, and when it is disturbed early, weight gain can slow until the community recovers [2]. The mix of germs present in the first weeks tracks how the baby grows across the rest of the first year [1].",
  "",
  "## What the research shows",
  "",
  "**The first colonists arrive at birth.** The gut is seeded during and just after birth, and the early community is dominated by organisms that thrive on milk [1]. These first colonists set the conditions every later microbe lives with, so the order of arrival shapes the community that follows and the growth that comes with it [2].",
  "",
  "**Microbes help the baby use food.** Gut microbes break down parts of the diet the baby cannot digest alone, releasing energy the gut lining can absorb [1]. Studies show that **gut microbes** influence how nutrients are absorbed and how weight is gained over time [2]. A community with the right fermenters extracts more from the same feed, and babies whose communities lack them gain weight more slowly on identical diets [1].",
  "",
  "**Disturbance has a cost.** Antibiotics and early illness thin the community and slow weight gain in the weeks that follow [1]. As the community rebuilds, growth usually resumes its earlier trajectory, which is why the timing of a disturbance matters as much as its size [2].",
  "",
  "## How solid is this?",
  "",
  "The evidence here is consistent across the gathered studies, and the mechanisms reinforce each other [1]. Most of it is observational, so the exact share of growth the microbes cause, rather than merely accompany, is still not settled [2].",
].join("\n");

const DEEP_ANSWER = [
  "## The short answer",
  "",
  "The microbes living in a baby’s gut **shape growth** from the first weeks of life [1]. The community helps the baby draw energy from food, trains the immune system, and steadies how weight is gained across the first year [2]. When the community is disturbed early, growth can slow until it recovers [1].",
  "",
  "## What the research shows",
  "",
  "**Colonization comes first.** The gut is seeded during and just after birth, and the early microbial community is dominated by organisms that thrive on milk [1]. These first colonists set the conditions every later microbe has to live with, so the order of arrival shapes the mature community that follows [2].",
  "",
  "**Microbes help the baby use food.** Gut microbes break down parts of the diet the baby cannot digest alone, releasing energy the gut lining can absorb [1]. A community with the right fermenters extracts more from the same feed, and babies whose communities lack them gain weight more slowly on identical diets [2].",
  "",
  "**The community trains the immune system.** Microbial signals teach the gut immune tissue to tolerate food and harmless organisms while still reacting to pathogens [2]. Babies whose early communities are disrupted show more gut inflammation, and an inflamed gut absorbs nutrients poorly, which shows up as slower growth [1].",
  "",
  "**Disturbance has a cost, and recovery is possible.** Antibiotics and early illness thin the community and slow weight gain in the weeks that follow [1]. As the community rebuilds, growth usually resumes its earlier trajectory, which is why the timing of a disturbance matters as much as its size [2].",
  "",
  "**Feeding mode leaves a fingerprint.** Babies fed differently carry measurably different communities from the first weeks, and those differences track with different growth patterns across the first year of life [1]. The community is one of the paths by which feeding reaches growth, alongside the nutrients themselves [2].",
  "",
  "**Delivery mode seeds the starting community.** Babies born by caesarean section start with a community that resembles skin and the birth environment more than the gut, and the difference from vaginally born babies is measurable for months [1]. The starting mix matters because later colonists can only establish where conditions suit them, so an early difference in seeding echoes through the succession that follows [2]. By the end of the first year the two groups look much more alike, but the months in between are exactly the months when growth is fastest and most easily knocked off course [1].",
  "",
  "**Diversity climbs month by month.** The early community is a handful of kinds; across the first year it steadily gains kinds as the diet widens and the gut matures [2]. The pace of that climb, not just the starting point, tracks with growth: babies whose communities diversify on schedule gain steadily, while a stalled climb often follows illness, antibiotics, or a restricted diet [1]. Researchers read the climb itself as a maturity marker, a clock for gut development that can run fast or slow for the same chronological age [2].",
  "",
  "**The starting community echoes into later months.** Which organisms arrive first changes which can establish later, a priority effect the studies see in how two babies on the same feed end up with different communities [1]. Early colonists alter the gut lining, the local acidity, and the immune tone, and those changes select for some later arrivals and against others [2]. This is why the same disturbance can cost one baby weeks of growth and barely register in another: the communities they started from were never the same [1].",
  "",
  "## What this means day to day",
  "",
  "For a parent or clinician reading these studies, the actionable reading is narrow: the first year community is built from feeding, delivery, and illness, and each of those is a lever with evidence behind it [1]. Nothing in this evidence supports sterilizing a baby's environment or chasing a particular product; the studies track whole communities and ordinary care, not interventions sold for the purpose [2]. Where the evidence does speak plainly is on timing: disturbances land hardest earliest, and recovery is the rule when the disturbance itself ends [1].",
  "",
  "## Where researchers disagree",
  "",
  "The sources agree that the community matters, but they differ on how much of growth it explains once diet, birth weight, and illness are accounted for [1][2]. They also differ on whether specific organisms drive the effect, or whether the community’s overall diversity is what counts [2].",
  "",
  "## How solid is this?",
  "",
  "The evidence here is consistent across the gathered studies, and the mechanisms are plausible and reinforce each other [1]. Most of it is observational, so the exact share of growth the microbes cause, rather than merely accompany, is still not settled [2]. The samples are also drawn from a small number of cohorts in similar settings, so how far the numbers travel to other populations is an open question the studies themselves flag [1].",
  "",
  "## What would change this",
  "",
  "A large trial that changed the early gut community directly and tracked growth for a full year would settle how much of the effect is causal [1]. Evidence that growth differences vanish once diet is fully controlled would weaken the claim considerably [2].",
].join("\n");

// The lazy Detailed draft (Job 2f): Detailed in shape — the
// same headings, bold lead passages, citations — but worked at
// barely past Standard depth, the fifth panel's measured
// failure exactly (3,415 chars live against Standard's 2,590).
// It clears the OLD acceptance floor (2,500) outright, so under
// the old contract this is what shipped. Under the wave six
// floor (4,200) every leg must reject it, and the run fails
// over to a leg that writes the real thing (DEEP_ANSWER).
const LAZY_DEEP_ANSWER = [
  "## The short answer",
  "",
  "The microbes living in a baby’s gut **shape growth** from the first weeks of life [1]. The community helps the baby draw energy from food and steadies how weight is gained across the first year [2]. When it is disturbed early, growth can slow until it recovers [1].",
  "",
  "## What the research shows",
  "",
  "**Colonization comes first.** The gut is seeded during and just after birth, and the early community is dominated by organisms that thrive on milk [1]. These first colonists set the conditions every later microbe has to live with [2].",
  "",
  "**Microbes help the baby use food.** Gut microbes break down parts of the diet the baby cannot digest alone, releasing energy the gut lining can absorb [1]. A community with the right fermenters extracts more from the same feed, and babies whose communities lack them gain weight more slowly [2].",
  "",
  "**The community trains the immune system.** Microbial signals teach the gut immune tissue to tolerate food and harmless organisms while still reacting to pathogens [2]. Babies whose early communities are disrupted show more gut inflammation, and an inflamed gut absorbs nutrients poorly [1].",
  "",
  "**Disturbance has a cost.** Antibiotics and early illness thin the community and slow weight gain in the weeks that follow [1]. As the community rebuilds, growth usually resumes its earlier trajectory [2].",
  "",
  "## Where researchers disagree",
  "",
  "The sources agree that the community matters, but they differ on how much of growth it explains once diet, birth weight, and illness are accounted for [1][2].",
  "",
  "## How solid is this?",
  "",
  "The evidence here is consistent across the gathered studies [1]. This draft stops early, before the evidence is worked through, so treat it as a sketch of the fuller answer rather than the answer itself [2].",
  "",
  "## What would change this",
  "",
  "A large trial that changed the early gut community directly and tracked growth for a full year would settle how much of the effect is causal [1].",
].join("\n");

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}

// The depth a prompt asks for, read from the prompt itself: the
// Detailed depth block exists only in the Detailed length hint,
// the Brief hint names its own shape, everything else is Standard.
function depthOfPrompt(joined) {
  if (joined.includes("DEPTH REQUIREMENT")) return "long";
  if (joined.includes("Two to three focused paragraphs")) return "short";
  return "medium";
}
function answerForDepth(depth) {
  return depth === "long" ? DEEP_ANSWER : depth === "short" ? BRIEF_ANSWER : MEDIUM_ANSWER;
}

function makeCounts(cap = 50) {
  return { fetch: 0, d1: 0, ai: 0, attempts: 0, refused: 0, cap };
}
function attempt(counts, kind) {
  counts[kind]++;
  counts.attempts++;
  if (counts.attempts > counts.cap) {
    counts.refused++;
    throw new Error("Too many subrequests by single Worker invocation");
  }
}
function countingDb(counts) {
  const st = () => {
    const s = {
      bind: () => s,
      first: async () => { attempt(counts, "d1"); return null; },
      all: async () => { attempt(counts, "d1"); return { results: [] }; },
      run: async () => { attempt(counts, "d1"); return { success: true, meta: { changes: 1 } }; },
    };
    return s;
  };
  return {
    prepare: () => st(),
    batch: async (arr) => { attempt(counts, "d1"); return (arr || []).map(() => ({ success: true })); },
    exec: async () => { attempt(counts, "d1"); return { results: [] }; },
  };
}
// A counting DB whose answer_cache actually stores: rows keyed by
// the derived cache key, written by the handler's own INSERT and
// read back by its SELECTs, everything else the generic stub.
function cacheAwareDb(counts, rows) {
  const generic = countingDb(counts);
  return {
    prepare: (sql) => {
      if (typeof sql !== "string" || !sql.includes("answer_cache")) return generic.prepare(sql);
      let binds = [];
      const s = {
        bind: (...args) => { binds = args; return s; },
        first: async () => {
          attempt(counts, "d1");
          if (!sql.includes("SELECT")) return null;
          const row = rows.get(binds[0]);
          if (row && row.created_at > binds[1]) return { ...row };
          return null;
        },
        all: async () => { attempt(counts, "d1"); return { results: [] }; },
        run: async () => {
          attempt(counts, "d1");
          if (sql.includes("INSERT")) {
            rows.set(binds[0], {
              query_key: binds[0], answer_id: binds[1], answer: binds[2],
              sources: binds[3], score: 0, created_at: binds[4],
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return s;
    },
    batch: generic.batch,
    exec: generic.exec,
  };
}
function depthAwareAi(counts, seen, synthState = null) {
  return {
    run: async (model, input) => {
      attempt(counts, "ai");
      if (model === "@cf/baai/bge-small-en-v1.5") {
        const texts = (input && input.text) || [];
        return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
      }
      const msgs = (input && input.messages) || [];
      const joined = msgs.map((m) => String(m.content || "")).join("\n");
      if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
      const depth = depthOfPrompt(joined);
      seen.aiDepths.add(depth);
      // The lazy scenario (Job 2f): the first lazyFirst Detailed
      // synthesis calls across BOTH stub transports answer with
      // the lazy draft, so wave 1 fails on the floor as a whole
      // and the failover, not a lucky leg, produces the deep win.
      if (depth === "long" && synthState && synthState.lazyFirst > 0) {
        synthState.calls++;
        if (synthState.calls <= synthState.lazyFirst) return { response: LAZY_DEEP_ANSWER };
      }
      return { response: answerForDepth(depth) };
    },
  };
}

// One full handler run at a chosen depth. The fetch stub records
// the token budget of every synthesis shaped call it serves, so
// the test can prove the handler SENT a bigger budget at
// Detailed, not just that a bigger answer came back. `lean` draws
// one paper per Europe PMC call instead of two. `limit` sizes the
// scenario's ledger (and the stub's cap with it): the cache
// fixture runs at 160 because at the production 50 this harness's
// fixed pre stages plus a full draw saturate the allowance and
// the answer cache write's own gate yields the write away (its
// designed behavior, pinned in tests/subrequest-budget.mjs), and
// a merely larger allowance is mostly eaten by the ladder firing
// more of its own rounds — the draw tops out around 110 attempts
// in this harness, so 160 leaves the tail genuinely intact. The
// mechanism under test there is the key, not the budget, the same
// reason that suite's NL ranking scenario runs at a larger limit.
async function runDepthScenario({ answerLength, db, lean = false, limit = 50, lazyFirst = 0 }) {
  const counts = makeCounts(limit);
  const seen = { budgets: [], aiDepths: new Set() };
  const synthState = { calls: 0, lazyFirst };
  let epmcCalls = 0;
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: {
      match: async () => undefined,
      put: async () => {},
      delete: async () => false,
    },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    attempt(counts, "fetch");
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com")) {
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { parsed = {}; }
      const joined = ((parsed.messages || []).map((m) => String(m.content || ""))).join("\n");
      const depth = depthOfPrompt(joined);
      if (parsed.max_tokens) seen.budgets.push({ depth, maxTokens: parsed.max_tokens });
      if (depth === "long" && synthState.lazyFirst > 0) {
        synthState.calls++;
        if (synthState.calls <= synthState.lazyFirst) return chatRes(LAZY_DEEP_ANSWER);
      }
      return chatRes(answerForDepth(depth));
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      const mk = (n) => ({
        title: "Gut germs and infant growth patterns study " + n,
        doi: "10.1000/depth" + n,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Infant Studies",
        abstractText: richAbstract(n),
      });
      return jsonRes({ resultList: { result: lean ? [mk(epmcCalls)] : [mk(epmcCalls * 2 - 1), mk(epmcCalls * 2)] } });
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
    const ledger = createSubrequestLedger(limit);
    const env = {
      // `db` is a rows Map for the cache fixture (the cache aware
      // stub counts through the same counters); otherwise the
      // generic counting stub, whose reads never hit.
      DB: db ? cacheAwareDb(counts, db) : countingDb(counts),
      AI: depthAwareAi(counts, seen, synthState),
      GROQ_KEY: "depth-test-groq-key-123456",
      GEMINI_KEY: "depth-test-gemini-key-123456",
      MISTRAL_KEY: "depth-test-mistral-key-123456",
      NVIDIA_KEY: "depth-test-nvidia-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, settings: { answerLength } }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, seen, synthState };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

// Sections are counted by their markers in the text, not by line
// position, so the same count works for both answer builders.
// (Until 2026-10-14 this comment claimed the pipeline's post
// processing collapsed the AI answer's paragraph breaks; that was
// stripLeakedMetaCommentary's flattening bug, since fixed — the
// cleanup now preserves paragraphs, pinned in answer-engine.mjs.
// The marker count predates the fix and never depended on the
// flattening, so it stands unchanged.)
const sectionCount = (md) => (String(md || "").match(/## /g) || []).length;
const boldLeadPassages = (md) => {
  const section = String(md || "").split("## What the research shows")[1] || "";
  return (section.match(/\*\*[^*]+\.\*\*/g) || []).length;
};

// Warm the isolate first (module level table ensures are a cold
// isolate cost the budget scenarios document): the depth runs
// below then measure depth, not cold start arithmetic.
await runDepthScenario({ answerLength: "medium" });

let briefRun;
let detailedRun;
let standardRun;
await test("Brief and Detailed ship visibly different answers to the same question", async () => {
  briefRun = await runDepthScenario({ answerLength: "short" });
  detailedRun = await runDepthScenario({ answerLength: "long" });
  standardRun = await runDepthScenario({ answerLength: "medium" });
  const brief = briefRun.data;
  const detailed = detailedRun.data;
  const standard = standardRun.data;
  assert.equal(standard.synthesisMode, "ai", "Standard run did not synthesize");
  assert.equal(brief.synthesisMode, "ai", "Brief run did not synthesize");
  assert.equal(detailed.synthesisMode, "ai", "Detailed run did not synthesize");
  // The handler SENT different budgets: Detailed legs carried the
  // 6400 token budget, Brief legs the 1200 one.
  assert.ok(briefRun.seen.budgets.some((b) => b.maxTokens === 1200),
    "no Brief synthesis call carried the 1200 budget: " + JSON.stringify(briefRun.seen.budgets));
  assert.ok(detailedRun.seen.budgets.some((b) => b.maxTokens === 6400),
    "no Detailed synthesis call carried the 6400 budget: " + JSON.stringify(detailedRun.seen.budgets));
  assert.ok(!detailedRun.seen.budgets.some((b) => b.depth === "long" && b.maxTokens <= 1800),
    "a Detailed leg was sent a Standard sized budget");
  // And the shipped answers differ the way the setting promises.
  assert.ok(detailed.answer.length >= brief.answer.length * 2,
    `Detailed answer (${detailed.answer.length} chars) is not at least twice Brief (${brief.answer.length})`);
  // The fifth panel's ratio, pinned (Job 2f): Detailed must run
  // at least roughly 1.8x the Standard serve on the same
  // question. Live it measured +32 percent (3,415 vs 2,590)
  // because the acceptance floor sat below a Standard serve's
  // own length; the stub lengths here are the panel's shapes
  // (Standard ~2.5k chars, Detailed ~5k) so the ratio is a real
  // measurement, not a formality.
  assert.ok(detailed.answer.length >= standard.answer.length * 1.8,
    `Detailed answer (${detailed.answer.length} chars) is not at least 1.8x Standard (${standard.answer.length})`);
  assert.ok(sectionCount(detailed.answer) > sectionCount(brief.answer),
    `Detailed sections (${sectionCount(detailed.answer)}) should exceed Brief (${sectionCount(brief.answer)})`);
  assert.ok(boldLeadPassages(detailed.answer) >= 4,
    "Detailed answer lacks the per finding passages");
  // Both responses and both records state the depth used.
  assert.equal(brief.answerLength, "short");
  assert.equal(detailed.answerLength, "long");
  assert.equal(brief._record && brief._record.answerLength, "short");
  assert.equal(detailed._record && detailed._record.answerLength, "long");
});

await test("Detailed rejects the lazy draft and fails over to a deep one (Job 2f)", async () => {
  // The first six Detailed synthesis calls (all of wave 1 on
  // both transports, plus wave 2's first) answer with the lazy
  // draft: Detailed in shape, Standard in substance at ~3.4k
  // chars — over the old 2,500 floor, under the wave six 4,200
  // floor. Every one of those legs must fail on length, and the
  // shipped answer must be the deep draft a later leg wrote.
  const lazy = await runDepthScenario({ answerLength: "long", lazyFirst: 6 });
  assert.equal(lazy.data.synthesisMode, "ai", "the Detailed run did not synthesize after the failover");
  assert.ok(lazy.synthState.calls > 6,
    `only ${lazy.synthState.calls} Detailed synthesis calls were made; the lazy wave was never outlasted`);
  assert.ok(lazy.data.answer.includes("Colonization comes first"),
    "the shipped answer is not the deep draft");
  assert.ok(!lazy.data.answer.includes("stops early"),
    "the lazy draft shipped as the Detailed answer");
  assert.ok(lazy.data.answer.length >= standardRun.data.answer.length * 1.8,
    `post failover Detailed (${lazy.data.answer.length} chars) is not at least 1.8x Standard (${standardRun.data.answer.length})`);
});

// ═══════════════════════════════════════════════════════════════
group("the cache — depths never serve each other's answers");

await test("a verified Standard answer is never served against a Detailed request", async () => {
  const rows = new Map();
  // Run 1 at Standard: a live synthesis, stored under its key.
  const first = await runDepthScenario({ answerLength: "medium", db: rows, lean: true, limit: 160 });
  assert.equal(first.data.synthesisMode, "ai", "Standard run did not synthesize");
  assert.equal(first.data._cached, undefined, "first run should not be a cache serve");
  assert.equal(rows.size, 1, "the Standard run stored no answer cache row");
  const storedRow = [...rows.values()][0];
  assert.ok(storedRow.answer.includes("influence how nutrients are absorbed"),
    "the stored row is not the Standard answer");
  // Upvotes verify it: only a score of 2 or more is ever served.
  storedRow.score = 2;
  // Run 2 at Detailed: the stored Standard row must NOT serve.
  const detailed = await runDepthScenario({ answerLength: "long", db: rows, lean: true, limit: 160 });
  assert.equal(detailed.data._cached, undefined,
    "the Detailed request was served the cached Standard answer");
  assert.equal(detailed.data.synthesisMode, "ai", "Detailed run did not synthesize its own answer");
  assert.ok(detailed.data.answer.includes("Colonization comes first"),
    "the Detailed request did not get the deep answer");
  assert.equal(detailed.data.answerLength, "long");
  assert.equal(detailed.data._record && detailed.data._record.answerLength, "long");
  // Its own row was stored alongside, under a different key.
  assert.equal(rows.size, 2, "the Detailed run did not store its own row");
  // Run 3 at Standard again: its own depth's row serves.
  const again = await runDepthScenario({ answerLength: "medium", db: rows, lean: true, limit: 160 });
  assert.equal(again.data._cached, true, "the Standard re-request was not served from its own cache row");
  assert.ok(again.data.answer.includes("influence how nutrients are absorbed"),
    "the served answer is not the stored Standard answer");
  assert.ok(!again.data.answer.includes("Colonization comes first"),
    "the Standard serve leaked the Detailed answer");
  assert.equal(again.data.answerLength, "medium");
  assert.equal(again.data._record && again.data._record.answerLength, "medium");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
