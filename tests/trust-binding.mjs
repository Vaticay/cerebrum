/**
 * Prose bound to the trust fields (2026-10-14, fourth panel, JOB 3).
 *
 * The verdict correctness wave made the trust FIELDS honest; the
 * synthesis prose was never bound to them, and the fourth panel
 * verified all three shapes on live answers:
 *
 *   (a) a disagreement section inventing named studies (a Journal
 *       of Pediatric Health Care study, and a different invented
 *       one on the repeat) while disagreementVerdict.conflictCount
 *       was 0 and literature_conflicts was null;
 *   (b) a claim the fact check marked unsupported (a heart
 *       arrhythmia claim) staying in the answer after its citation
 *       was stripped: the flag informed the panel, the prose went
 *       on asserting the claim;
 *   (c) confidence Moderate shipped beside a claim check line
 *       reading "supports 0 of 1 checked claims", and beside body
 *       text saying the check found nothing to support.
 *
 * The bindings: at a zero conflict verdict the ship gate strips a
 * disagreement section that names studies (stripInventedDisagree-
 * mentSections); claims the fact check marks unsupported are
 * removed from the shipped text (removeUnsupportedClaimsFrom-
 * Answer: the handler passes the deep check's own verdicts as
 * hard targets — the mechanical flags keep their flag only
 * contract, since they fire on ordinary paraphrase and removing
 * on them gutted the answer depth fixtures' pinned prose; the
 * helper's soft strength is pinned here at unit level); and
 * buildConfidenceLine caps the level at the thin band when the
 * check supports none of its claims or never ran on an AI answer.
 *
 * Fixture wording follows the standing rule: questions in plain
 * everyday language, papers in the literature's own phrasing. The
 * end to end scenario drives the real onRequest with a Workers AI
 * stub whose synthesis carries the invented section and the
 * unsupported claim, and whose fact check tier returns the deep
 * verdicts.
 *
 * Run with: node tests/trust-binding.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  stripInventedDisagreementSections,
  removeUnsupportedClaimsFromAnswer,
  buildConfidenceLine,
  calibrateConfidenceScore,
  onRequest,
  createSubrequestLedger,
} = await import(join(root, "functions/api/search.js"));

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

// ═══════════════════════════════════════════════════════════════════
group("(a) invented disagreement sections — the strip");

const INVENTED_ANSWER =
  "## Summary\n\n" +
  "Creatine did not increase hair shedding in the trial that measured it [1]. " +
  "Dosing in the trials was five grams a day, and the follow up ran twelve weeks.\n\n" +
  "## Where the studies disagree\n\n" +
  "A 2023 study in the Journal of Pediatric Health Care reported that creatine thinned hair " +
  "in teenagers, while Osei et al. (2021) found thicker hair in their cohort of young athletes.\n\n" +
  "## Limits\n\n" +
  "The trials are short and their samples are small.";

await test("a disagreement section naming an invented journal study is stripped whole", () => {
  const out = stripInventedDisagreementSections(INVENTED_ANSWER);
  assert.ok(!out.includes("Journal of Pediatric Health Care"), "the invented journal survives");
  assert.ok(!out.includes("Osei"), "the invented researchers survive");
  assert.ok(!out.includes("Where the studies disagree"), "the section heading survives");
  assert.ok(out.includes("did not increase hair shedding"), "the real summary was harmed");
  assert.ok(out.includes("## Limits"), "the limits section was harmed");
});

await test("a disagreement heading over generic hedging names nothing and stays", () => {
  const hedged = INVENTED_ANSWER.replace(
    "A 2023 study in the Journal of Pediatric Health Care reported that creatine thinned hair in teenagers, while Osei et al. (2021) found thicker hair in their cohort of young athletes.",
    "The picture is not fully settled, and reasonable readers weigh the small trials differently."
  );
  assert.equal(stripInventedDisagreementSections(hedged), hedged,
    "caution without fabricated attribution is not the strip's target");
});

await test("study naming under a non disagreement heading is not the strip's business", () => {
  const other =
    "## Summary\n\n" +
    "One trial (2021) measured shedding directly [1]. The methods followed Osei et al. in dosing.\n\n" +
    "## Limits\n\nSamples are small.";
  assert.equal(stripInventedDisagreementSections(other), other);
});

await test("the floor: an answer that is only the invented section ships untouched", () => {
  const only =
    "## Where the studies disagree\n\n" +
    "A 2023 study in the Journal of Pediatric Health Care reported harm, while Osei et al. (2021) reported none.";
  assert.equal(stripInventedDisagreementSections(only), only,
    "the strip must never empty the answer");
});

// ═══════════════════════════════════════════════════════════════════
group("(b) unsupported claims — removal, not just de citing");

const CLAIM_ANSWER =
  "## Summary\n\n" +
  "Short sleep raises the chance of catching a cold in the weeks after exposure [1]. " +
  "It also slows heart recovery after exercise in healthy adults. " +
  "Short sleep lowers the antibody response after vaccination [2].";

await test("a hard target (the deep check's verdict) removes its sentence, markers and all", () => {
  const out = removeUnsupportedClaimsFromAnswer(CLAIM_ANSWER, [
    { claim: "Short sleep raises the chance of catching a cold in the weeks after exposure", hard: true },
  ]);
  assert.equal(out.removed, 1);
  assert.ok(!out.text.includes("catching a cold"), "the unsupported sentence survives");
  assert.ok(out.text.includes("antibody response after vaccination [2]"), "a supported sentence was harmed");
  assert.ok(out.text.includes("slows heart recovery"), "an unchecked sentence was harmed");
});

await test("a soft target removes its sentence only when no citation survives on it", () => {
  const markerless = removeUnsupportedClaimsFromAnswer(CLAIM_ANSWER, [
    { claim: "It also slows heart recovery after exercise in healthy adults.", hard: false },
  ]);
  assert.equal(markerless.removed, 1);
  assert.ok(!markerless.text.includes("heart recovery"));
  const cited = removeUnsupportedClaimsFromAnswer(CLAIM_ANSWER, [
    { claim: "Short sleep lowers the antibody response after vaccination", hard: false },
  ]);
  assert.equal(cited.removed, 0, "a sentence another citation still supports keeps its place");
  assert.ok(cited.text.includes("antibody response"));
});

await test("a hard target removes only the sentence citing the source the check judged", () => {
  // Same topic sentences repeat the claim's words; the second
  // sentence here shares most of the indicted claim's content
  // words but cites a different paper and asserts a different
  // finding (the reviews, not the trial). The check's source
  // index is what tells them apart.
  const topical =
    "Creatine did not increase hair shedding in the trial that measured it [1]. " +
    "Reviews of creatine in athletes likewise found no increase in hair shedding at standard doses [2].";
  const out = removeUnsupportedClaimsFromAnswer(topical, [
    { claim: "Creatine did not increase hair shedding in the trial that measured it", sourceIndex: 1, hard: true },
  ]);
  assert.equal(out.removed, 1);
  assert.ok(!out.text.includes("in the trial that measured it"), "the indicted sentence survives");
  assert.ok(out.text.includes("Reviews of creatine in athletes"),
    "the same topic sentence citing another source was removed by vocabulary alone");
});

await test("a section the removal empties loses its heading too", () => {
  const sectioned =
    "## Summary\n\n" +
    "Short sleep raises the chance of catching a cold [1].\n\n" +
    "## Heart effects\n\n" +
    "It also slows heart recovery after exercise in healthy adults.";
  const out = removeUnsupportedClaimsFromAnswer(sectioned, [
    { claim: "It also slows heart recovery after exercise in healthy adults.", hard: true },
  ]);
  assert.equal(out.removed, 1);
  assert.ok(!out.text.includes("## Heart effects"), "an emptied section heading was left standing");
  assert.ok(out.text.includes("## Summary"));
});

await test("the floor: removing everything returns the original answer", () => {
  const out = removeUnsupportedClaimsFromAnswer("One claim stands here alone.", [
    { claim: "One claim stands here alone.", hard: true },
  ]);
  assert.equal(out.removed, 0);
  assert.equal(out.text, "One claim stands here alone.");
});

await test("removal leaves grammatical text: no stranded gaps or doubled punctuation", () => {
  const out = removeUnsupportedClaimsFromAnswer(CLAIM_ANSWER, [
    { claim: "It also slows heart recovery after exercise in healthy adults.", hard: true },
  ]);
  assert.ok(!/ {2,}/.test(out.text), `doubled spaces left behind: ${out.text}`);
  assert.ok(!/\s[.,;:]/.test(out.text), `stranded punctuation left behind: ${out.text}`);
});

// ═══════════════════════════════════════════════════════════════════
group("(c) confidence — the level agrees with the claim check");

const STRONG_PAPERS = () => Array.from({ length: 6 }, (_, i) => ({
  title: "Creatine and hair study " + (i + 1),
  relevance: 85,
  year: 2024,
  type: "Journal Article",
  abstract: "A full abstract with enough wording to count as accessible support for the claims the answer makes about creatine and hair.",
}));

await test("a check that supports none of its claims caps the level at thin", () => {
  const conf = buildConfidenceLine(STRONG_PAPERS(), { status: "settled" }, {
    factCheckChecked: true,
    support: { supported: 0, checked: 1 },
  });
  assert.equal(conf.level, "thin");
  assert.ok(conf.score <= 45, `score escaped the thin band: ${conf.score}`);
  assert.match(conf.line, /supports 0 of 1 checked claim/);
  assert.match(conf.line, /claim check supports none of the claims it checked/);
  // The cap survives calibration, the last word before shipping.
  const shipped = calibrateConfidenceScore(conf, { strippedCitations: 0, totalCitations: 2, integrityFlags: 0 });
  assert.equal(shipped.level, "thin");
});

await test("a check that supports something leaves the level to the other signals", () => {
  const conf = buildConfidenceLine(STRONG_PAPERS(), { status: "settled" }, {
    factCheckChecked: true,
    support: { supported: 1, checked: 2 },
  });
  assert.equal(conf.level, "strong");
  assert.match(conf.line, /supports 1 of 2 checked claims/);
});

await test("an AI answer the check never ran on caps at thin", () => {
  const conf = buildConfidenceLine(STRONG_PAPERS(), { status: "settled" }, {
    factCheckChecked: false,
    aiAnswer: true,
  });
  assert.equal(conf.level, "thin");
  assert.match(conf.line, /claim check did not run on this answer/);
});

await test("the unchecked cap for non AI shapes keeps its established band", () => {
  // The cache serve and the extractive lines assert the same
  // unchecked state without being AI answers; their contract
  // (cap 59, the did not check reason) is pinned elsewhere and
  // does not move with the AI answer clamp.
  const conf = buildConfidenceLine(STRONG_PAPERS(), { status: "settled" }, {
    factCheckChecked: false,
  });
  assert.equal(conf.level, "moderate");
  assert.match(conf.line, /fact checking did not check any claims/);
});

// ═══════════════════════════════════════════════════════════════════
group("end to end — the prose ships bound to the fields");

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
function tbDb() {
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

const TB_PAPERS = [
  {
    title: "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
    doi: "10.1000/tb1",
    pubYear: "2024",
    citedByCount: 21,
    authorString: "Halden R, Moser T",
    journalTitle: "Journal of Sports Nutrition",
    abstractText: "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.",
  },
  {
    title: "Creatine supplementation in athletes: a systematic review of safety outcomes",
    doi: "10.1000/tb2",
    pubYear: "2023",
    citedByCount: 44,
    authorString: "Ibarra L, Chen W",
    journalTitle: "Sports Medicine Reviews",
    abstractText: "Across forty one trials of creatine supplementation in athletes, adverse events were uncommon and mild. Hair outcomes were reported in three trials, none of which found increased hair shedding or hair loss on creatine compared with placebo at standard doses.",
  },
  {
    title: "Hair loss in young adults: causes and presentation in primary care",
    doi: "10.1000/tb3",
    pubYear: "2022",
    citedByCount: 17,
    authorString: "Novak P",
    journalTitle: "Primary Care Dermatology",
    abstractText: "Hair shedding in young adults most often reflects telogen effluvium after illness or stress, thyroid disease, or iron deficiency. The review sets out the examination and blood tests that distinguish these causes of hair loss in clinic patients.",
  },
];

const TB_ANSWER =
  "## Summary\n\n" +
  "Creatine did not increase hair shedding in the trial that measured it [1]. " +
  "It also appears to protect heart muscle during intense exercise in healthy adults [2]. " +
  "Reviews of creatine in athletes likewise found no increase in hair shedding at standard doses [2].\n\n" +
  "## Where the studies disagree\n\n" +
  "A 2023 study in the Journal of Pediatric Health Care reported that creatine thinned hair in teenagers, " +
  "while Osei et al. (2021) found thicker hair in their cohort of young athletes.\n\n" +
  "## Limits\n\n" +
  "The trials are short, their samples are small, and few followed anyone past twelve weeks.";

const FC_SUPPORTED = {
  claims: [
    {
      claim: "Creatine did not increase hair shedding in the trial that measured it",
      source_index: 1,
      quote: "Hair shedding counts and scalp hair density did not increase on creatine",
      status: "supported",
      justification: "The trial's abstract states the shedding outcome directly and the claim repeats it without widening it. The quote covers the dose and the follow up the claim relies on. Nothing in the claim goes beyond what the source reports.",
    },
    {
      claim: "It also appears to protect heart muscle during intense exercise in healthy adults",
      source_index: 2,
      quote: "",
      status: "unsupported",
      justification: "No cited source mentions heart muscle, cardiac protection, or exercise recovery of the heart at all. The review covers safety outcomes in athletes and hair outcomes in three trials. The claim would need a cardiac outcome in some cited abstract to stand, and none is present.",
    },
  ],
};
const FC_NONE_SUPPORTED = {
  claims: [
    {
      claim: "Creatine did not increase hair shedding in the trial that measured it",
      source_index: 1,
      quote: "",
      status: "unsupported",
      justification: "In this stubbed verdict the checker reports that the abstract it was shown does not state the shedding outcome in the form the claim needs. The claim is therefore treated as unsupported for this scenario. The sentence must leave the shipped text.",
    },
    {
      claim: "It also appears to protect heart muscle during intense exercise in healthy adults",
      source_index: 2,
      quote: "",
      status: "unsupported",
      justification: "No cited source mentions heart muscle or cardiac protection in any form. The claim has no footing in the cited set and is marked unsupported. The sentence must leave the shipped text.",
    },
  ],
};

async function runTrustScenario(factCheckVerdict) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("ebi.ac.uk/europepmc")) {
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: TB_PAPERS } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  const ai = {
    run: async (model, input) => {
      if (model === "@cf/baai/bge-small-en-v1.5") {
        const texts = (input && input.text) || [];
        return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
      }
      const msgs = (input && input.messages) || [];
      const joined = msgs.map((mm) => String(mm.content || "")).join("\n");
      if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: JSON.stringify(factCheckVerdict) };
      return { response: TB_ANSWER };
    },
  };
  try {
    const ledger = createSubrequestLedger();
    const env = { DB: tbDb(), AI: ai };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // settings.factCheck rides the body exactly as the client
      // sends it; without it the deep check is off and this
      // scenario would exercise only the mechanical flags.
      body: JSON.stringify({
        query: "does creatine make your hair fall out",
        settings: { factCheck: true },
      }),
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

await test("invented disagreement section and the unsupported claim both leave the shipped answer", async () => {
  const data = await runTrustScenario(FC_SUPPORTED);
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer, got: " + data.synthesisMode);
  // The verdict fields are what the panel read: no conflicts.
  assert.equal(data.disagreementVerdict && data.disagreementVerdict.conflictCount, 0,
    "control: the verdict must find no conflicts in this scenario");
  assert.equal(data.literature_conflicts, null, "control: literature_conflicts must be null");
  // (a) the invented section is gone, its studies with it.
  assert.ok(!data.answer.includes("Journal of Pediatric Health Care"),
    "the invented journal study shipped: " + data.answer.slice(0, 600));
  assert.ok(!data.answer.includes("Osei"), "the invented researchers shipped");
  assert.ok(!data.answer.includes("Where the studies disagree"), "the invented section heading shipped");
  // (b) the unsupported claim is gone from the text, not just de cited.
  assert.ok(!data.answer.includes("protect heart muscle"),
    "the fact check unsupported claim shipped: " + data.answer.slice(0, 600));
  // The supported claims and the honest sections stand.
  assert.ok(data.answer.includes("did not increase hair shedding"), "the supported claim was harmed");
  assert.ok(data.answer.includes("## Limits"), "the limits section was harmed");
  // The removal stays visible in the panel, not silent.
  const panel = (data.factCheck && data.factCheck.claims) || [];
  assert.ok(panel.some((c) => c.status === "unsupported" && /heart muscle/.test(c.claim || "")),
    "the fact check panel lost the unsupported entry: " + JSON.stringify(data.factCheck));
});

await test("a check supporting none of its claims ships thin confidence that agrees with its line", async () => {
  const data = await runTrustScenario(FC_NONE_SUPPORTED);
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer");
  assert.ok(data.factCheck && data.factCheck.claims && data.factCheck.claims.length >= 2,
    "the check must have run: " + JSON.stringify(data.factCheck));
  assert.equal(data.confidence && data.confidence.level, "thin",
    "confidence escaped the thin band beside a zero support check: " + JSON.stringify(data.confidence));
  assert.match(String((data.confidence && data.confidence.line) || ""), /supports 0 of \d+ checked claims/,
    "the line must state the check's result: " + (data.confidence && data.confidence.line));
  // Both unsupported claims left the text as well.
  assert.ok(!data.answer.includes("protect heart muscle"), "the heart claim shipped");
  assert.ok(!data.answer.includes("did not increase hair shedding"), "the shedding claim shipped");
  assert.ok(data.answer.includes("## Limits"), "the limits section was harmed");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
