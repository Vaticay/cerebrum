/**
 * Worker resource budget tests (2026-10-24, citation wave, Lane 3).
 *
 * The live sleep probe ("what happens to your brain if you only
 * sleep six hours every night for two weeks straight") died with
 * a Cloudflare "Worker exceeded resource limits" 503 at 8,712 ms
 * while every sibling probe in its batch returned 200 in 9 to
 * 13.5 s. Profiling the same shape locally (stubbed fetchers,
 * mixed on and off topic pool, gathered 400; node --cpu-prof)
 * named the cause: the concept hit scan. termStemHitInText re
 * split and re stemmed EVERY token of a field for EVERY term it
 * was asked about, and the citation gate machinery asks once
 * per concept term plus once per member of the concept's gating
 * group (13 members for "sleep", 12 for "brain" on this
 * question), per field, per paper — and paperClearsCitationGate
 * ran that whole pass three times per paper over three nearly
 * identical concept sets, and countOnTopicPapers re ran the gate
 * over the whole accumulated pool after every retrieval round
 * (a dozen or more times per gather). Measured before the fix
 * on this machine class (warm, median of 5): one
 * countOnTopicPapers call over a 400 paper mixed pool cost
 * 272 ms (0.68 ms per paper), one gate pass over the same pool
 * 394 ms, and the scan family was ~75 percent of total request
 * CPU in the end to end profile (countOnTopicPapers inclusive
 * 2,320 ms of ~3,070 ms process CPU at gathered 400).
 *
 * The fix changes no verdict: a field is tokenized and stemmed
 * ONCE into a field stem index shared by every term and group
 * member judged against it, and the gate evaluates each concept
 * once per paper and sums the overlapping sets' aggregates from
 * those records. Measured after, same harness: count call 51 ms,
 * gate pass 32 ms, end to end request CPU 3,068 -> 1,319 ms.
 *
 * These tests pin (1) hit level equivalence against a verbatim
 * copy of the ORIGINAL scan, (2) the gate verdict digest the
 * pre fix code produced on a fixed generated pool, and (3) the
 * per request resource bound itself, as a generous ceiling the
 * pre fix code measurably fails and the fixed code passes with
 * headroom.
 *
 * Run with: node tests/worker-resource-budget.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  centralConceptHits,
  paperClearsCitationGate,
  citationGateStandard,
  countOnTopicPapers,
  gateConceptSetFor,
} = await import(join(root, "functions/api/search.js"));
const src = await readFile(join(root, "functions/api/search.js"), "utf8");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// ── The original scan, verbatim (pre Lane 3), as reference ──
// extractiveStem, stemFamilyOf, termStemHitInText and
// textTouchesConceptGroup copied from the pre fix search.js so
// the equivalence below judges the shipped code against the
// algorithm it replaced, not against itself.
function refExtractiveStem(word) {
  let w = String(word || "").toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  return w;
}
function refStemFamilyOf(w) {
  const fam = new Set([refExtractiveStem(w)]);
  if (w.endsWith("ves") && w.length > 4) {
    fam.add(w.slice(0, -3) + "f");
    fam.add(w.slice(0, -3) + "fe");
  }
  if (w.endsWith("f") && w.length > 3) fam.add(w.slice(0, -1) + "ves");
  if (w.endsWith("fe") && w.length > 3) fam.add(w.slice(0, -2) + "ves");
  return fam;
}
function refTermStemHitInText(lowText, term) {
  const t = String(term || "").toLowerCase().trim();
  if (!t || !lowText) return false;
  if (t.indexOf(" ") !== -1) return lowText.indexOf(t) >= 0;
  const stem = refExtractiveStem(t);
  const fam = refStemFamilyOf(t);
  for (const tok of lowText.split(/[^a-z0-9]+/)) {
    if (!tok) continue;
    if (tok === t) return true;
    if (stem.length >= 3) {
      const ts = refExtractiveStem(tok);
      if (ts === stem) return true;
      if (stem.length >= 4 && ts.startsWith(stem)) return true;
      if (ts.length >= 4 && stem.startsWith(ts) &&
          /^(ed|ing|es|s|d|en|er|est)$/.test(stem.slice(ts.length))) return true;
    }
    if (fam.size > 1 || tok.endsWith("ves") || tok.endsWith("f") || tok.endsWith("fe")) {
      const tokFam = refStemFamilyOf(tok);
      for (const f of fam) {
        if (f.length >= 3 && tokFam.has(f)) return true;
      }
    }
  }
  return false;
}
function refTextTouchesConceptGroup(lowText, group) {
  if (!group || !lowText) return false;
  for (const member of group) {
    const m = String(member || "").toLowerCase().trim();
    if (!m) continue;
    if (m.indexOf(" ") !== -1) {
      if (lowText.indexOf(m) >= 0) return true;
    } else if (refTermStemHitInText(lowText, m)) return true;
  }
  return false;
}
function refCentralConceptHits(paper, concepts) {
  const list = Array.isArray(concepts) ? concepts : [];
  const titleLow = String((paper && paper.title) || "").toLowerCase();
  const a = String((paper && paper.abstract) || "").trim();
  const absLow = String(/^no abstract available\.?$/i.test(a) ? "" : (a || (paper && paper.snippet) || "")).toLowerCase();
  let total = 0, inTitle = 0, inAbstract = 0;
  let subjectHit = false, subjectInTitle = false;
  for (const c of list) {
    if (!c) continue;
    const gateGroup = gateConceptSetFor(c.group);
    const th = refTermStemHitInText(titleLow, c.term) || refTextTouchesConceptGroup(titleLow, gateGroup);
    const ah = refTermStemHitInText(absLow, c.term) || refTextTouchesConceptGroup(absLow, gateGroup);
    if (th || ah) total++;
    if (th) inTitle++;
    if (ah) inAbstract++;
    if (c.subject) {
      if (th || ah) subjectHit = true;
      if (th) subjectInTitle = true;
    }
  }
  return { total, inTitle, inAbstract, subjectHit, subjectInTitle };
}

// ── Deterministic generated pools ────────────────────────────
const QUERY = "what happens to your brain if you only sleep six hours every night for two weeks straight";
const WORDS = ["sleep", "sleeps", "sleeping", "brain", "brains", "leaf", "leaves", "life", "lives", "knife", "knives", "sprain", "sprained", "zorb", "zorblaxin", "growth", "grows", "growing", "attention", "attentional", "memory", "memories", "night", "nights", "six", "weeks", "week", "deprivation", "deprived", "cognitive", "cognition", "cortical", "neuron", "neurons", "neural", "performance", "performances", "decline", "declined", "declining", "rest", "restriction", "restricted", "hours", "hour", "two", "fourteen", "days", "day", "study", "studies", "showed", "shows", "increased", "decreased", "higher", "lower", "improved", "worsened"];
function generatedPool(n) {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = [];
  for (let i = 0; i < n; i++) {
    const mk = (k) => Array.from({ length: k }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(" ");
    pool.push({ title: mk(6), abstract: mk(60), year: "2015", authors: "A B", journal: "J Sleep Res", doi: "10.1/x" + i, url: "https://doi.org/10.1/x" + i, citations: 5 });
  }
  return pool;
}
const SENT = [
  "Sleep restriction to six hours per night reduced sustained attention and working memory in healthy adults.",
  "After two weeks of short sleep, participants showed increased sleepiness and slower reaction times on vigilance tasks.",
  "Cognitive performance declined across the restriction period while subjective sleepiness plateaued early.",
  "Brain activity in prefrontal regions changed after chronic partial sleep deprivation in this controlled study.",
  "Memory consolidation was impaired when sleep duration was limited to six hours nightly for fourteen days.",
  "The restricted group accumulated a cognitive deficit comparable to one night of total sleep deprivation.",
  "Alertness and mood worsened progressively as sleep debt accumulated over the two week protocol.",
  "Participants sleeping six hours showed more attentional lapses than the eight hour control group.",
];
const OFF = [
  "The trial enrolled patients with advanced colorectal cancer receiving second line chemotherapy at twelve centers.",
  "Soil samples were collected from agricultural plots and analyzed for moisture retention and compaction under load.",
  "Participants completed a battery of questionnaires about dietary habits, income, and household composition.",
  "The polymer composite was tested under cyclic thermal stress until visible cracking appeared along the seam.",
  "Survey respondents reported their commuting patterns across three metropolitan regions during the winter months.",
  "Stock returns were modeled against commodity prices using a rolling window regression over twenty years.",
  "The manuscript tradition of the chronicle survives in four copies held by regional archives and one private collection.",
  "Welding parameters were varied systematically to measure bead geometry and penetration depth in steel plates.",
];
const ASPECTS = ["Attention", "Memory", "Vigilance", "Mood", "Alertness", "Reaction time", "Prefrontal activity", "Sleepiness", "Executive function", "Learning", "Creativity", "Decision making", "Emotion regulation", "Motor performance", "Reasoning", "Working memory", "Processing speed", "Impulse control", "Stress response", "Hormonal change"];
const OUTCOMES = ["decline", "change", "impairment", "adaptation", "recovery", "variability", "cost", "benefit", "pattern", "trajectory", "threshold", "profile", "marker", "signature", "dynamics"];
function mixedPool(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const off = i % 5 >= 2;
    const bank = off ? OFF : SENT;
    const parts = [];
    for (let s = 0; s < 10; s++) parts.push(bank[(i + s) % bank.length]);
    out.push({
      title: off
        ? `${["Colorectal", "Soil", "Polymer", "Commuting", "Commodity", "Chronicle", "Welding", "Dietary"][i % 8]} ${OUTCOMES[Math.floor(i / 20) % 15]} in a multicenter cohort study series ${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`
        : `${ASPECTS[i % 20]} ${OUTCOMES[Math.floor(i / 20) % 15]} after two weeks of six hour sleep in adults cohort ${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`,
      abstract: `Report ${i}. ` + parts.join(" ") + ` Outcome ${i} reached the prespecified threshold in subgroup ${i} with an effect of ${(0.2 + (i % 9) * 0.07).toFixed(2)}.`,
      year: String(2008 + (i % 17)), citations: 10 + (i * 37) % 900,
      authors: `Surname${i} A`, journal: "Journal of Sleep Research",
      doi: `10.5555/sleep.${i}`, url: `https://doi.org/10.5555/sleep.${i}`,
    });
  }
  return out;
}
function medianMs(fn, reps) {
  fn();
  const ts = [];
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((a, b) => a - b);
  return ts[Math.floor(ts.length / 2)];
}

// ── 1. Hit level equivalence with the original scan ─────────
ok("centralConceptHits matches the original scan on the generated pool", () => {
  const std = citationGateStandard(QUERY, null);
  for (const p of generatedPool(60)) {
    assert.deepEqual(centralConceptHits(p, std.centralConcepts), refCentralConceptHits(p, std.centralConcepts),
      "hit aggregates drifted from the original scan for: " + p.title);
  }
});

ok("the f/v family, inflection, and bare prefix cases keep the original verdicts", () => {
  const cases = [
    [{ term: "leaf", group: new Set(["leaf", "leaves"]) }, "the leaves fell in autumn and the leaf turned"],
    [{ term: "sprain", group: new Set(["sprain"]) }, "a sprained ankle was recorded"],
    [{ term: "sprained", group: new Set(["sprained"]) }, "the patient had a sprain last year"],
    [{ term: "zorb", group: new Set(["zorb"]) }, "zorblaxin was administered daily"],
    [{ term: "life", group: new Set(["life", "lives"]) }, "lives were changed by the intervention"],
    [{ term: "working memory", group: new Set(["working memory"]) }, "working memory declined sharply"],
    [{ term: "growth", group: new Set(["growth"]) }, "the children grows taller each year"],
    [{ term: "babies", group: new Set(["babies"]) }, "the baby slept through the night"],
  ];
  for (const [c, abs] of cases) {
    const p = { title: "t", abstract: abs };
    assert.deepEqual(centralConceptHits(p, [c]), refCentralConceptHits(p, [c]),
      "verdict drifted for term " + c.term + " over: " + abs);
  }
});

// ── 2. The gate verdict digest the pre fix code produced ────
ok("gate verdicts on the fixed pool match the pre fix digest (2026-10-24)", () => {
  // Digest computed from the pre Lane 3 code on this exact
  // generator: verdict string, hit checksum, on topic count.
  const std = citationGateStandard(QUERY, null);
  const pool = generatedPool(60);
  let verdicts = "", hitsSum = 0;
  for (const p of pool) {
    verdicts += paperClearsCitationGate(p, std) ? "1" : "0";
    const h = centralConceptHits(p, std.centralConcepts);
    hitsSum += h.total * 7 + h.inTitle * 3 + h.inAbstract;
  }
  assert.equal(verdicts, "111111111111111111111111111111111111111111111111111111110111", "gate verdicts changed");
  assert.equal(hitsSum, 1931, "hit checksum changed");
  assert.equal(countOnTopicPapers(pool, QUERY, null), 59, "on topic count changed");
});

// ── 3. The resource bound ────────────────────────────────────
ok("one whole pool on topic count over 400 mixed papers stays under the worker budget ceiling", () => {
  // Pre fix measured 272 ms median for this call; the ceiling
  // is set between the two measurements with headroom on both
  // sides (fixed code measured 51 ms, 2026-10-24).
  const pool = mixedPool(400);
  const ms = medianMs(() => countOnTopicPapers(pool, QUERY, null), 5);
  assert.ok(ms < 150, `countOnTopicPapers over 400 mixed papers took ${ms.toFixed(1)} ms (ceiling 150)`);
});

ok("a full gate pass over 400 mixed papers stays under the worker budget ceiling", () => {
  // Pre fix measured 394 ms median; fixed code measured 32 ms.
  const std = citationGateStandard(QUERY, null);
  const pool = mixedPool(400);
  const ms = medianMs(() => { let c = 0; for (const p of pool) if (paperClearsCitationGate(p, std)) c++; return c; }, 5);
  assert.ok(ms < 150, `gate pass over 400 mixed papers took ${ms.toFixed(1)} ms (ceiling 150)`);
});

ok("the handler wires the shared index and the per concept gate records", () => {
  assert.ok(src.includes("function fieldStemIndex(lowText)"), "the field stem index is gone");
  assert.ok(src.includes("function conceptHitsCacheFor(paper, state)"), "the gate's per concept record cache is gone");
  assert.ok(src.includes("aggregateConceptSetHits(centralSet, gateRecordFor)"), "the gate no longer sums the central set from shared records");
  assert.ok(src.includes("aggregateConceptSetHits(exceptionSet, gateRecordFor)"), "the gate no longer sums the exception set from shared records");
  assert.ok(src.includes("aggregateConceptSetHits(useSet, gateRecordFor)"), "the gate no longer sums the backed set from shared records");
  assert.ok(!src.includes("for (const tok of lowText.split(/[^a-z0-9]+/)) {\n    if (!tok) continue;\n    if (tok === t) return true;"),
    "the original per term token rescan is back in termStemHitInText");
});

console.log("\nworker-resource-budget: " + passed + " passed");
