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
  bindProseConfidenceToLevel,
  bindBakedConfidenceLine,
  confidenceAssertionRank,
  verifyExtractiveAlignment,
  buildExtractiveSynthesis,
  factCheckSupport,
  factCheckKind,
  factCheckProvenance,
  dedupeFactCheckClaims,
  claimsNearDuplicates,
  extractLiteratureConflicts,
  detectSourceConflicts,
  reconcileDisagreementVerdict,
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
  // A verification's own word is untouched by the provenance
  // vocabulary (wave eight round two): this run's check is the
  // deep claim check, and its verified claim still carries
  // "supported" — only the extractive trace's marks changed.
  assert.ok(panel.some((c) => c.status === "supported" && /hair shedding/.test(c.claim || "")),
    "an AI serve's verified claim lost its supported status: " + JSON.stringify(data.factCheck));
  assert.equal(data.factCheck.mode, "claims",
    "control: this scenario's check is the deep verification, got: " + data.factCheck.mode);
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

// ═══════════════════════════════════════════════════════════════════
group("(d) prose confidence bound to the shipped level (Job 3a)");

const THIN_LINE = "Low confidence: this answer rests on only 1 cited source. Treat this answer as provisional.";
const MODERATE_LINE = "Moderate confidence: this answer rests on 4 cited sources. No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim.";

const ABSOLUTE_ANSWER =
  "## Summary\n\n" +
  "Creatine did not increase hair shedding in the trial that measured it [1].\n\n" +
  "## How solid is this?\n\n" +
  "Confidence is absolute. The trials settle the question completely, and no reasonable doubt remains about the direction of the effect [1].";

await test("absolute prose beside level thin is replaced by the computed line", () => {
  const out = bindProseConfidenceToLevel(ABSOLUTE_ANSWER, "thin", THIN_LINE);
  assert.ok(!out.includes("Confidence is absolute"), "the absolute assertion shipped beside thin");
  assert.ok(out.includes(THIN_LINE), "the computed line did not replace the section's assertion");
  assert.ok(out.includes("## How solid is this?"), "the section heading was lost");
  assert.ok(out.includes("did not increase hair shedding"), "the answer body was harmed");
});

await test("exceptionally high prose beside level thin is replaced by the computed line", () => {
  const answer =
    "## Summary\n\n" +
    "Creatine did not increase hair shedding in the trial that measured it [1].\n\n" +
    "## How solid is this?\n\n" +
    "Confidence here is exceptionally high, well beyond what the small samples would usually support [1].";
  const out = bindProseConfidenceToLevel(answer, "thin", THIN_LINE);
  assert.ok(!out.includes("exceptionally high"), "the exceptionally high assertion shipped beside thin");
  assert.ok(out.includes(THIN_LINE), "the computed line did not replace the assertion");
});

await test("a moderate assertion beside moderate keeps its limitations and gains the computed line", () => {
  // PIN UPDATED (2026-10-14, wave ten, brief item 6): this pin
  // codified the old conditional contract, under which model
  // authored solidity prose shipped as the section whenever it
  // did not overclaim. The hardcore audit's A1 specimen proved
  // the contract defective: prose the recogniser could not rank
  // ("high resolution crystal structures", "a high level of
  // confidence") shipped beside a thin object with claim check
  // 0 of 1. The corrected contract: the headed solidity section
  // DERIVES from the confidence object at every level, so the
  // section body is the computed line and the model's own
  // solidity sentence does not ship, within level or not.
  // PIN UPDATED AGAIN (2026-10-23, Wave 3 S4 landing, audit
  // L4-12): the logic audit found the replace contract itself
  // defective, because replacing the section deleted the
  // model's specific limitations (sample sizes, tangential
  // papers, unreplicated results) that the section exists to
  // carry. The catalog's repair: the binder APPENDS the
  // computed line to the model's section instead of replacing
  // it. Overclaiming prose beside a lower level is still
  // replaced (the pins above stand); within level, the model's
  // limitations ship and the computed line stands with them.
  const answer =
    "## Summary\n\n" +
    "Creatine did not increase hair shedding in the trial that measured it [1].\n\n" +
    "## How solid is this?\n\n" +
    "Confidence is moderate: the trials agree, but the samples are small and the follow up short [1].";
  const out = bindProseConfidenceToLevel(answer, "moderate", MODERATE_LINE);
  assert.ok(out.includes(MODERATE_LINE),
    "the computed line was not appended to the section: " + out);
  assert.ok(out.includes("the trials agree, but the samples are small"),
    "the model's stated limitations were deleted by the binder");
  assert.ok(out.includes("did not increase hair shedding"), "the answer body was harmed");
});

await test("a high assertion beside strong ships verbatim; strength words about other things are untouched", () => {
  const answer =
    "## Summary\n\n" +
    "The high dose group shed no more hair than the low dose group [1]. Confidence is high that the effect is absent at these doses [1].";
  const out = bindProseConfidenceToLevel(answer, "strong", "Strong confidence: this answer rests on 6 cited sources.");
  assert.equal(out, answer, "a strong level answer was rewritten");
  // Beside thin, only the confidence sentence is bound; the
  // dose sentence is about dosing, not confidence, and stands.
  const outThin = bindProseConfidenceToLevel(answer, "thin", THIN_LINE);
  assert.ok(outThin.includes("high dose group shed no more hair"), "a non confidence sentence was rewritten");
  assert.ok(outThin.includes(THIN_LINE), "the standalone assertion was not replaced in place");
  assert.ok(!outThin.includes("Confidence is high"), "the overclaiming sentence shipped beside thin");
});

await test("an answer with no confidence assertion is unchanged at any level", () => {
  const answer =
    "## Summary\n\n" +
    "Creatine did not increase hair shedding in the trial that measured it [1]. " +
    "Dosing was five grams a day for twelve weeks [1].";
  assert.equal(bindProseConfidenceToLevel(answer, "thin", THIN_LINE), answer);
  assert.equal(confidenceAssertionRank("The dose was high and the effect strong."), -1,
    "strength words without confidence are not assertions");
  assert.equal(confidenceAssertionRank("Confidence is absolute."), 3);
  assert.equal(confidenceAssertionRank("Confidence is moderate."), 1);
});

// ═══════════════════════════════════════════════════════════════════
group("(e) duplicate claims are not a dispute (Job 3b)");

// The panel's specimen: the ten percent brain myth stated twice,
// both sources calling it a misconception, shipped as status
// divided with conflictCount 1. The two claims are near copies of
// one assertion; opposition cannot rest on the same words.
const MYTH_A = "Humans use only ten percent of their brains, a claim with no scientific support";
const MYTH_B = "Humans use only ten percent of their brains, a claim scientists call a misconception";

await test("the specimen pair is a near duplicate, not an opposition", () => {
  assert.equal(claimsNearDuplicates(MYTH_A, MYTH_B), true,
    "the two statements of the myth were not recognized as near duplicates");
  // A genuine opposing pair is worded differently and stands.
  assert.equal(claimsNearDuplicates(
    "Caffeine raised systolic blood pressure by eight points in the trial group",
    "Across the cohort, habitual coffee intake was associated with lower systolic readings"
  ), false, "a genuine opposing pair was misread as a duplicate");
});

await test("the specimen pair yields zero conflicts and a non divided verdict", () => {
  const papers = [
    { title: "The ten percent myth in textbooks", abstract: MYTH_A + ". Textbooks repeat the claim without evidence." },
    { title: "Brain myths in popular culture", abstract: MYTH_B + ". Surveys show the belief is widespread." },
  ];
  const detected = detectSourceConflicts(papers, null);
  assert.equal(detected.conflicts.length, 0,
    "the source level pass built a conflict from two copies of one claim: " + JSON.stringify(detected.conflicts));
  const { verdict } = reconcileDisagreementVerdict(detected, []);
  assert.equal(verdict.conflictCount, 0);
  assert.notEqual(verdict.status, "divided", "the verdict shipped divided on duplicate claims");
});

await test("a genuine opposing pair still conflicts", () => {
  const papers = [
    { title: "Caffeine and blood pressure trial", abstract: "In the trial, caffeine increased systolic blood pressure by eight points in healthy adults within an hour of dosing." },
    { title: "Coffee intake cohort study", abstract: "Across the cohort, habitual coffee intake decreased systolic blood pressure in healthy adults over the follow up year." },
  ];
  const detected = detectSourceConflicts(papers, null);
  assert.ok(detected.conflicts.length >= 1,
    "a genuine opposing pair no longer conflicts: " + JSON.stringify(detected));
  const { verdict } = reconcileDisagreementVerdict(detected, []);
  assert.equal(verdict.status, "divided");
});

await test("extractLiteratureConflicts drops a mined pair built from near duplicate sentences", () => {
  const answer =
    "One source reports that humans use only ten percent of their brains, a claim with no scientific support [1]. " +
    "However, another reports that humans use only ten percent of their brains, a claim scientists call a misconception [2].";
  const sources = [{ title: "Textbook myths" }, { title: "Popular brain myths" }];
  const conflicts = extractLiteratureConflicts(answer, sources);
  assert.equal(conflicts.length, 0,
    "the text mining pass shipped a dispute from two copies of one claim: " + JSON.stringify(conflicts));
});

// ═══════════════════════════════════════════════════════════════════
group("provenance, not verification — the extractive check's contract (sixth panel, Job 1)");

await test("an extractive only run over a junk pool: every trace marked, no support counted, thin shipped", () => {
  // The panel's shape: the shelf is junk for the question (cooking
  // and cleaning papers under a carpet cleaning question), but the
  // extractive body copies their sentences, so the old alignment
  // check marked claim after claim "supported" and the run shipped
  // them as verified support at a moderate line. The trace itself
  // is honest — the wording DOES trace — so the fix is not to fail
  // the trace but to stop calling it verification.
  const junk = [
    { title: "Beeswax and paraffin blends in candle manufacture",
      abstract: "Beeswax candles burn with a warm glow and drip less than paraffin candles in draught free rooms. Paraffin wax melts at lower temperatures and holds fragrance oils well in container candles.",
      year: 2024, relevance: 88 },
    { title: "Solvent extraction of turpentine from pine resin",
      abstract: "Turpentine extraction from pine resin yields a solvent used in varnish manufacture. The resin is heated and the volatile fraction condensed in water cooled coils over several hours.",
      year: 2025, relevance: 86 },
  ];
  const md = buildExtractiveSynthesis(junk, null, { query: "how do I get candle wax out of a carpet" });
  assert.ok(md, "expected an extractive synthesis over the junk pool");
  const aligned = verifyExtractiveAlignment(md, junk);
  assert.ok(aligned && aligned.checked && aligned.claims.length > 0,
    "the trace found no claims to trace in a cited extractive answer");
  // CORRECTED CONTRACT (2026-10-14, seventh panel, wave eight
  // round two): this pin used to assert the copied claims carry
  // status "supported" — the kind label was supposed to carry the
  // distinction on its own, and at claim level it did not. A claim
  // whose wording traces now carries "traced", no provenance claim
  // carries "supported", and the run's overall is "traced".
  assert.ok(aligned.claims.some((c) => c.status === "traced"),
    "fixture broken: copied claims should trace (that is the circularity)");
  assert.ok(aligned.claims.every((c) => c.status !== "supported"),
    "a provenance claim shipped as supported: " + JSON.stringify(aligned.claims));
  assert.equal(aligned.overall, "traced",
    "a provenance only run's overall is not the trace's own word: " + aligned.overall);
  // (a) Labeled provenance in the shipped object, and its summary
  // speaks of traces, never of supported claims.
  assert.equal(aligned.checkKind, "provenance");
  assert.equal(factCheckKind(aligned), "provenance");
  assert.match(aligned.summary, /not a verification/);
  assert.ok(!/claim check supports/i.test(aligned.summary), "the summary still sells traces as support");
  // The trace's own counts are available AS a trace...
  const prov = factCheckProvenance(aligned);
  assert.ok(prov && prov.checked === aligned.claims.length && prov.traced >= 1);
  // ...but no support total anywhere counts them.
  assert.equal(factCheckSupport(aligned), null,
    "provenance marks fed a support total");
  // (b) The shipped confidence for a provenance only run is thin,
  // always — over this junk shelf and over a strong one alike.
  const junkLine = buildConfidenceLine(junk, { status: "settled" },
    { support: factCheckSupport(aligned), factCheckChecked: true, provenanceOnly: true });
  assert.equal(junkLine.level, "thin", "a provenance only run shipped above thin: " + junkLine.line);
  assert.ok(!junkLine.line.includes("claim check supports"), "the line claims support from a trace");
  assert.match(junkLine.line, /not a verification/);
  const strongShelf = Array.from({ length: 10 }, (_, i) => ({
    title: "Cited paper " + (i + 1), year: 2026, relevance: 95,
    abstract: "A detailed abstract reports a measured result with enough supporting detail for the answer.",
  }));
  const strongLine = buildConfidenceLine(strongShelf, { status: "settled" },
    { support: factCheckSupport(aligned), factCheckChecked: true, provenanceOnly: true });
  assert.equal(strongLine.level, "thin",
    "a strong shelf lifted a provenance only run above thin: " + strongLine.line);
  // A verification check's counts still count (the distinction is
  // the kind, not a blanket refusal).
  const deep = { mode: "claims", claims: [{ claim: "x", status: "supported" }] };
  assert.equal(factCheckKind(deep), "verification");
  assert.deepEqual(factCheckSupport(deep), { supported: 1, checked: 1 });
  assert.equal(factCheckProvenance(deep), null);
});

await test("a duplicated claim counts once in the checked total (Job 1c)", () => {
  // The same claim text checked against two citations: the deep
  // check emits it twice (different quotes, different sources),
  // and every total downstream used to count it twice.
  const fc = {
    mode: "claims",
    overall: "partly",
    summary: "Checked 3 claims against the cited sources: 2 supported, 1 thin, 0 unsupported.",
    claims: [
      { claim: "Creatine did not increase hair shedding in the trial.", source_index: 1, status: "supported", note: "\"...\" [1]" },
      { claim: "Creatine did not increase hair shedding in the trial.", source_index: 2, status: "supported", note: "\"...\" [2]" },
      { claim: "Dosing was five grams daily.", source_index: 1, status: "thin", note: "\"...\" [1]" },
    ],
  };
  const out = dedupeFactCheckClaims(fc);
  assert.equal(out.claims.length, 2, "the duplicate claim survived the fold");
  assert.equal(out.claims[0].source_index, 1, "the first occurrence should stand");
  assert.deepEqual(factCheckSupport(out), { supported: 1, checked: 2 },
    "the support total still counts the duplicate");
  assert.equal(out.summary,
    "Checked 2 claims against the abstracts of the cited sources: 1 supported, 1 thin, 0 unsupported.",
    "the summary was not recounted from the folded claims");
  // The extractive trace folds too, and its summary recounts in
  // provenance wording. The folded object's claims carry the
  // trace's own status word (wave eight round two): the recount
  // counts "traced" claims and a clean fold's overall is "traced".
  const trace = {
    mode: "extractive", checkKind: "provenance", overall: "traced", checked: true,
    summary: "Traced 3 cited claims against the wording of the papers they cite: 2 traced to the cited paper's wording, 1 overlap only weakly, 0 do not trace. A wording trace is not a verification of the claims.",
    claims: [
      { claim: "Beeswax candles burn with a warm glow in draught free rooms.", status: "traced", note: "The claim's wording traces to the cited paper's title/abstract." },
      { claim: "Beeswax candles burn with a warm glow in draught free rooms.", status: "traced", note: "The claim's wording traces to the cited paper's title/abstract." },
      { claim: "Paraffin wax melts at lower temperatures.", status: "thin", note: "Shares some wording with the cited paper's title/abstract." },
    ],
  };
  const folded = dedupeFactCheckClaims(trace);
  assert.equal(folded.claims.length, 2);
  assert.equal(folded.overall, "traced",
    "the fold promoted a clean trace to a verification's overall: " + folded.overall);
  assert.equal(folded.summary,
    "Traced 2 cited claims against the wording of the papers they cite: 1 traced to the cited paper's wording, 1 overlap only weakly, 0 do not trace. A wording trace is not a verification of the claims.",
    "the trace summary was not recounted from the folded claims");
  assert.equal(folded.checkKind, "provenance", "the fold lost the provenance label");
  assert.equal(factCheckSupport(folded), null, "the folded trace fed a support total");
  // The integrity flags object's narrative summary states no
  // counts: its claims fold, its summary and overall stand as
  // written.
  const flags = {
    mode: "claims", overall: "partly",
    summary: "Counts are from a mechanical integrity pass over the answer as shipped.",
    claims: [
      { claim: "Same text.", status: "unsupported", note: "flags" },
      { claim: "Same text.", status: "unsupported", note: "flags" },
    ],
  };
  const foldedFlags = dedupeFactCheckClaims(flags);
  assert.equal(foldedFlags.claims.length, 1);
  assert.equal(foldedFlags.summary, flags.summary, "a narrative summary was rewritten by the fold");
  assert.equal(foldedFlags.overall, "partly", "a non count overall was recomputed by the fold");
});

// ═══════════════════════════════════════════════════════════════════
group("solidity vocabulary — the prose gate learns the strength family (sixth panel, Job 2)");

await test("the panel's specimen sentence is bound under a thin ship", () => {
  // Verbatim from the sixth panel's Trust specimen (prose
  // confidence defect 2): a "How solid is this?" section asserting
  // high solidity while the computed line under it read Low
  // confidence with a claim check supporting 0 of 5. The old
  // detection keyed on the word "confidence" and never saw it.
  const shelf = Array.from({ length: 8 }, (_, i) => ({
    title: "Textbook myth paper " + (i + 1), year: 2024, relevance: 80,
    abstract: "A detailed abstract reports a measured result with enough supporting detail for the answer.",
  }));
  const canonical = buildConfidenceLine(shelf.slice(0, 1), { status: "settled" }).line;
  assert.match(canonical, /^Low confidence: this answer rests on/,
    "fixture broken: the canonical thin line is not what the binder would ship: " + canonical);
  const text =
    "## How solid is this?\n\n" +
    "The evidence is highly solid for bacterial pathogens but limited for viruses/fungi.";
  const boundThin = bindProseConfidenceToLevel(text, "thin", canonical);
  assert.ok(!boundThin.includes("highly solid"),
    "the specimen's solidity assertion shipped untouched under thin: " + boundThin);
  assert.ok(boundThin.includes(canonical),
    "the canonical thin line did not take the section: " + boundThin);
});

await test("the solidity family ranks on the confidence ladder", () => {
  assert.equal(confidenceAssertionRank("The evidence is highly solid."), 2);
  assert.equal(confidenceAssertionRank("The evidence is firmly established."), 2);
  assert.equal(confidenceAssertionRank("The evidence base is robust."), 2);
  assert.equal(confidenceAssertionRank("The evidence is conclusive."), 3);
  assert.equal(confidenceAssertionRank("The strength of the evidence is high."), 2);
  assert.equal(confidenceAssertionRank("This conclusion rests on solid ground."), 2);
  assert.equal(confidenceAssertionRank("The evidence is thin."), 0);
  assert.equal(confidenceAssertionRank("The evidence is moderate at best."), 1);
});

await test("strength words about methods, effects, and doses are not assertions", () => {
  // The contextual guard, same philosophy as the confidence word:
  // the rank word must predicate THIS answer's evidence. A robust
  // method and a strong coffee predicate something else entirely
  // and ship verbatim at any level.
  assert.equal(confidenceAssertionRank("The assay used a robust internal standard, and the method was validated across three laboratories."), -1);
  assert.equal(confidenceAssertionRank("Strong coffee was provided to the control group each morning."), -1);
  assert.equal(confidenceAssertionRank("The treatment effect was strong and dose dependent."), -1);
  const body =
    "## What the research shows\n\n" +
    "The assay used a robust internal standard, and the method was validated across three laboratories. " +
    "Strong coffee was provided to the control group each morning.";
  const thinLine = buildConfidenceLine([{ title: "One paper", year: 2024, relevance: 80 }], { status: "settled" }).line;
  const bound = bindProseConfidenceToLevel(body, "thin", thinLine);
  assert.equal(bound, body, "a methods sentence was rewritten by the solidity gate");
});

await test("a solidity assertion in free prose is replaced under a moderate ship", () => {
  const shelf = Array.from({ length: 8 }, (_, i) => ({
    title: "Cited paper " + (i + 1), year: 2024, relevance: 85,
    abstract: "A detailed abstract reports a measured result with enough supporting detail for the answer.",
  }));
  const moderateLine = buildConfidenceLine(shelf, { status: "settled" }, { extractive: true }).line;
  assert.match(moderateLine, /^Moderate confidence:/, "fixture broken: " + moderateLine);
  const text =
    "## Summary\n\n" +
    "Overall, the evidence is firmly established on this point. Creatine did not increase hair shedding in the trial [1].";
  const out = bindProseConfidenceToLevel(text, "moderate", moderateLine);
  assert.ok(!out.includes("firmly established"),
    "a high rank solidity assertion survived a moderate ship: " + out);
  assert.ok(out.includes("did not increase hair shedding"), "the factual sentence was harmed: " + out);
  assert.ok(out.includes(moderateLine), "the canonical line did not take the assertion's place: " + out);
});

await test("the seventh panel's specimens rank on the ladder and bind under thin", () => {
  // Verbatim shapes from the seventh panel's Trust audit: every
  // one shipped unbound beside a thin level because the wave six
  // family watched only evidence and data as subjects and had
  // none of these phrases. Each is an establishedness assertion
  // about the answer's own evidence base, rank 2 on the ladder.
  const specimens = [
    "The consensus among reviewers remains solid.",
    "Large scale clinical trials have established that the effect is real.",
    "The evidence is very solid.",
    "The literature is well established on this point.",
    "It is well established that sleep loss impairs memory consolidation.",
    "The findings are extremely strong.",
    "The research is solid.",
    "The science is firmly established.",
    "The strength of the findings is considerable.",
  ];
  for (const s of specimens) {
    assert.equal(confidenceAssertionRank(s), 2,
      "a seventh panel specimen does not rank as a high assertion: " + s);
  }
  // And the binding itself: under a thin ship the specimen
  // sentences are replaced by the shipped line, in place.
  const shelf = Array.from({ length: 8 }, (_, i) => ({
    title: "Textbook myth paper " + (i + 1), year: 2024, relevance: 80,
    abstract: "A detailed abstract reports a measured result with enough supporting detail for the answer.",
  }));
  const thinLine = buildConfidenceLine(shelf.slice(0, 1), { status: "settled" }).line;
  for (const s of [
    "The consensus among reviewers remains solid.",
    "Large scale clinical trials have established that the effect is real.",
    "The findings are extremely strong.",
  ]) {
    const body = "## Summary\n\n" + s + " Creatine did not increase hair shedding in the trial [1].";
    const out = bindProseConfidenceToLevel(body, "thin", thinLine);
    assert.ok(!out.includes(s), "the specimen shipped unbound under thin: " + out);
    assert.ok(out.includes(thinLine), "the shipped line did not take the specimen's place: " + out);
    assert.ok(out.includes("did not increase hair shedding"), "the factual sentence was harmed: " + out);
  }
});

await test("the extended family's spares still ship verbatim", () => {
  // The subject extension must not swallow strength predicated of
  // anything that is not the answer's evidence: a magnet's pull, a
  // colony's establishment, and a method noun inside a studies
  // sentence all predicate something else.
  assert.equal(confidenceAssertionRank("A strong magnet held the sample against the pull of the centrifuge."), -1);
  assert.equal(confidenceAssertionRank("The colony is well established and thriving after two winters."), -1);
  assert.equal(confidenceAssertionRank("The studies used a strong magnet to separate the cells."), -1);
  assert.equal(confidenceAssertionRank("The trial established a dosing schedule of five grams daily."), -1,
    "the verb pattern caught a study establishing a protocol, not a claim");
  const body =
    "## What the research shows\n\n" +
    "A strong magnet held the sample against the pull of the centrifuge. " +
    "The colony is well established and thriving after two winters.";
  const thinLine = buildConfidenceLine([{ title: "One paper", year: 2024, relevance: 80 }], { status: "settled" }).line;
  const bound = bindProseConfidenceToLevel(body, "thin", thinLine);
  assert.equal(bound, body, "a spare sentence was rewritten by the extended solidity gate");
});

// ═══════════════════════════════════════════════════════════════════
group("baked line binding — the extractive body's pre check line meets the shipped level (sixth panel follow up)");

// The extractive builder composes this paragraph BEFORE the claim
// check runs, from a wide shelf: a Moderate assertion, its non
// asserting remainder, then the pipeline appends the trace's real
// result to the same paragraph. The shipped object, computed
// after the check, caps at thin because the only check that ran
// is the provenance trace. Before this binding the body shipped
// the Moderate assertion untouched over the thin object.
const BAKED_THIN_LINE = "Low confidence: this answer rests on 8 cited sources, and the available checks do not support a stronger claim. Treat this answer as provisional. Confidence is capped because the only check that ran traced claim wording to the cited papers, which is not a verification.";
const BAKED_TRACE = "The wording of 6 of 7 cited claims traces to the papers they cite. A wording trace is not a verification.";
const BAKED_BODY =
  "## Summary\n\n" +
  "Germs in the gut change across the first year of life [1].\n\n" +
  "## How solid is this?\n\n" +
  "Moderate confidence: this answer rests on 8 cited sources. " +
  "No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim. " +
  "Confidence is capped because the answer was assembled from source excerpts. " +
  BAKED_TRACE + "\n\n" +
  "- Only 8 sources cleared the relevance bar. Treat this as a starting point, not a settled answer.\n" +
  "- 3 more papers were found but withheld: they didn't clear the relevance bar for this question.\n\n" +
  "## What would change this\n\n" +
  "- A direct replication in a second cohort.\n";

await test("a Moderate baked line is bound to the shipped thin line, trace and bullets intact", () => {
  const out = bindBakedConfidenceLine(BAKED_BODY, "thin", BAKED_THIN_LINE);
  assert.ok(!out.includes("Moderate confidence"),
    "the baked Moderate assertion shipped over a thin level: " + out);
  assert.ok(out.includes(BAKED_THIN_LINE),
    "the shipped line does not stand where the baked assertion stood: " + out);
  assert.ok(out.includes(BAKED_TRACE),
    "the appended trace sentence was harmed: " + out);
  assert.ok(out.includes("No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim."),
    "the baked line's non asserting remainder was removed: " + out);
  assert.ok(out.includes("- Only 8 sources cleared the relevance bar."),
    "the section's gap bullets were removed: " + out);
  assert.ok(out.includes("- 3 more papers were found but withheld"),
    "the section's gap bullets were removed: " + out);
  assert.ok(out.includes("## What would change this\n\n- A direct replication in a second cohort."),
    "the following section was harmed: " + out);
});

await test("a baked line asserting at the shipped level ships byte identical", () => {
  // Moderate baked, moderate shipped: the builder and the ship
  // agree, so nothing may move.
  const moderateLine = "Moderate confidence: this answer rests on 8 cited sources. No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim.";
  assert.equal(bindBakedConfidenceLine(BAKED_BODY, "moderate", moderateLine), BAKED_BODY,
    "a baked line at the shipped level was rewritten");
  // Thin baked, thin shipped: same agreement at the low band.
  const thinBody = BAKED_BODY.replace(
    "Moderate confidence: this answer rests on 8 cited sources. " +
    "No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim. " +
    "Confidence is capped because the answer was assembled from source excerpts. ",
    "Low confidence: this answer rests on only 1 cited source. Treat this answer as provisional. ");
  assert.equal(bindBakedConfidenceLine(thinBody, "thin", BAKED_THIN_LINE), thinBody,
    "a thin baked line under a thin ship was rewritten");
});

await test("the definition shape binds on its Evidence Strength line", () => {
  const defBody =
    "## What is a biofilm?\n\n" +
    "A biofilm is a structured community of microbes [1].\n\n" +
    "**Evidence Strength** Moderate confidence: this answer rests on 2 cited sources. " +
    "The wording of 1 of 1 cited claim traces to the papers they cite. A wording trace is not a verification.\n";
  const out = bindBakedConfidenceLine(defBody, "thin", BAKED_THIN_LINE);
  assert.ok(!out.includes("Moderate confidence"),
    "the definition body's baked assertion shipped over thin: " + out);
  assert.ok(out.includes("**Evidence Strength** " + BAKED_THIN_LINE),
    "the shipped line does not stand behind the Evidence Strength marker: " + out);
  assert.ok(out.includes("The wording of 1 of 1 cited claim traces to the papers they cite."),
    "the trace sentence on the definition line was harmed: " + out);
  assert.equal(bindBakedConfidenceLine(defBody, "moderate",
    "Moderate confidence: this answer rests on 2 cited sources."), defBody,
    "a definition line at the shipped level was rewritten");
});

await test("a body with no baked line shape is returned untouched", () => {
  const plain = "## Summary\n\nConfidence is high here, in the model's own words [1].\n";
  assert.equal(bindBakedConfidenceLine(plain, "thin", BAKED_THIN_LINE), plain,
    "a body without a baked span was rewritten (that is the prose binder's job, not this pass)");
  assert.equal(bindBakedConfidenceLine("", "thin", BAKED_THIN_LINE), "");
  assert.equal(bindBakedConfidenceLine(BAKED_BODY, "thin", ""), BAKED_BODY,
    "a missing shipped line rewrote the body");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
