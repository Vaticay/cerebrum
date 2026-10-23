// Query understanding repair pins (2026-10-23, Wave 3 Lane S1).
// Each group pins one Stage 1 finding of the 2026-10-22 logic
// audit (~/workspace/logic-audit-oct22/lane1-query.md) at the
// level the finding names: the class mechanism, exercised on
// the audit's own specimen questions plus controls. Run with:
//   node tests/query-understanding-repair.mjs
import assert from "node:assert/strict";
import {
  analyzeQuery,
  auditGeneratedSearchQuery,
  auditResolvedQuery,
  buildDynLookup,
  buildStructuredQuery,
  canonicalQueryForms,
  centralConceptHits,
  classifyQuestionType,
  detectAmbiguity,
  detectMeasurementIntent,
  expansionAlternatePassesSenseTest,
  expansionClassAlternatePasses,
  expansionGroupAdequacy,
  fetcherStructuredFallback,
  gateConceptSetFor,
  generatedQueryHonorsIntent,
  isExpansionGroupInadequate,
  paperConceptGroupHits,
  qiConfidenceForRow,
  queryIntelligenceStoreGate,
  rebuildStructuredQueryFromGroups,
  resolveExpansionCoverage,
  resolveMeasurementIntent,
  structuralTermClass,
  typedConceptGroup,
  validateExpansionGroups,
} from "../functions/api/search.js";
import {
  expandViaMesh,
  expandViaMeshTyped,
  meshRelationFor,
} from "../functions/lib/knowledge.js";

let failures = 0;
let count = 0;
function test(name, fn) {
  count++;
  try { fn(); console.log("  ok -", name); }
  catch (e) { failures++; console.log("  FAIL -", name, "\n    ", String(e && e.message).split("\n").join("\n     ")); }
}
function group(name) { console.log(name); }

const SLEEP_Q = "does sleeping only six hours a night for two weeks make thinking worse";
const ASSAY_Q = "how is manganese peroxidase activity measured in a standard lab assay";
const BSFL_Q = "Do baby black soldier flies eat cooking oil that restaurants turn into waste oil?";

/* ── L1-3: measurement intent from the operative relation ── */
group("L1-3 measurement intent resolver (2026-10-23)");
test("audit phrasings resolve as measurement", () => {
  for (const q of [
    ASSAY_Q,
    "what is the standard lab assay for manganese peroxidase activity",
    "how do you check if honey is pure",
    "how would you test whether the enzyme still works",
    "how do scientists test enzyme activity in a sample",
    "what check is used for water quality",
    "how can you tell if the culture is still active",
    "how is water quality tested",
  ]) {
    assert.equal(detectMeasurementIntent(q), true, q);
    assert.equal(resolveMeasurementIntent(q).measurement, true, q);
  }
});
test("resolver reports its signal", () => {
  const r = resolveMeasurementIntent("how do you check if honey is pure");
  assert.equal(r.measurement, true);
  assert.equal(typeof r.signal, "string");
  assert.ok(r.signal.length > 0);
});
test("non measurement controls stay clear", () => {
  for (const q of [
    "how does a steam engine work",
    "how do bees make honey",
    "what is the standard of care for diabetes",
    "what is the best treatment for insomnia",
    "how fast do black soldier flies grow",
  ]) {
    assert.equal(detectMeasurementIntent(q), false, q);
  }
});
test("method noun question classifies methods, not definition", () => {
  assert.equal(classifyQuestionType("what is the standard lab assay for manganese peroxidase activity").type, "methods");
});

/* ── L1-15: question type is punctuation independent ──────── */
group("L1-15 question type (2026-10-23)");
test("yes no verdict does not need the question mark", () => {
  assert.equal(classifyQuestionType("does honey help wounds heal").type, "yesno");
  assert.equal(classifyQuestionType("does honey help wounds heal?").type, "yesno");
  assert.equal(classifyQuestionType("is creatine bad for your hair").type, "yesno");
});
test("findings are not misread as a definition", () => {
  const t = classifyQuestionType("what are the effects of sleep loss on memory");
  assert.notEqual(t.type, "definition");
});
test("an explicit unknown state exists", () => {
  const t = classifyQuestionType("photosynthesis");
  assert.equal(t.type, "unknown");
  assert.equal(t.confidence, 0);
});

/* ── L1-6: constraints from real spans, graded ────────────── */
group("L1-6 key phrases and constraints (2026-10-23)");
test("no manufactured phrase glues across a removed non separator", () => {
  const a = analyzeQuery(BSFL_Q);
  assert.ok(!a.keyPhrases.includes("oil restaurants turn"), a.keyPhrases.join(" | "));
  assert.ok(a.keyPhrases.length >= 2);
});
test("established phrase pins hold", () => {
  // The pinned question forms, word for word as the standing
  // suites pin them (search-wave-two, query-expansion).
  assert.deepEqual(analyzeQuery("Do the germs in a baby belly change how well the baby grows").keyPhrases,
    ["germs baby belly", "baby"]);
  assert.deepEqual(analyzeQuery("how does creatine affect hair loss").keyPhrases, ["creatine hair loss"]);
  assert.deepEqual(analyzeQuery("Studies involving BSFL waste oil substrates").keyPhrases, ["waste oil"]);
});
test("constraints carry grades and mustSatisfyAll follows the required grade", () => {
  const a = analyzeQuery("What substrates do black soldier fly larvae grow on, including waste oil?");
  assert.ok(a.constraints.every((c) => typeof c === "object" && typeof c.level === "string"));
  const required = a.constraints.filter((c) => c.level === "required");
  assert.ok(required.some((c) => c.phrase === "waste oil"), JSON.stringify(a.constraints));
  assert.equal(a.mustSatisfyAll, true);
  // mustSatisfyAll follows the existence of real span
  // constraints (2026-10-23, L1-6): true when the question
  // yielded stated spans, false for a question with none,
  // where the old unconditional constant claimed a mandatory
  // set that did not exist.
  const b = analyzeQuery("how does sleep affect memory in teenagers");
  assert.equal(b.mustSatisfyAll, true);
  const bare = analyzeQuery("photosynthesis");
  assert.equal(bare.constraints.length, 0);
  assert.equal(bare.mustSatisfyAll, false);
});

/* ── L1-7: centrality from question structure ─────────────── */
group("L1-7 structural centrality (2026-10-23)");
test("framing words are class zero, operative and quantity words high", () => {
  assert.equal(structuralTermClass("clearly", SLEEP_Q), 0);
  assert.equal(structuralTermClass("standard", ASSAY_Q), 0);
  assert.equal(structuralTermClass("weeks", SLEEP_Q), 2);
  assert.ok(structuralTermClass("assay", ASSAY_Q) >= 2);
});
test("no framing adverb holds an AND rung over a stated quantity", () => {
  const b = buildStructuredQuery(SLEEP_Q);
  assert.ok(!/AND\s+"?clearly"?\b/.test(b), b);
  assert.ok(b.includes("weeks"), b);
});
test("no generic modifier holds an AND rung over the operative noun", () => {
  const b = buildStructuredQuery(ASSAY_Q);
  assert.ok(b.includes("assay"), b);
  assert.ok(!/AND\s+standard\b/.test(b), b);
});

/* ── L1-8: typed concept relations at the gate ────────────── */
group("L1-8 typed concept groups (2026-10-23)");
test("gate set excludes broader and related, keeps synonyms and narrower", () => {
  const sleep = typedConceptGroup(new Set(["sleep", "sleeping", "sleep deprivation", "sleep restriction", "short sleep", "sleep loss", "insomnia", "sleep duration", "sleep quality"]));
  assert.ok(sleep, "sleep group typed");
  assert.ok(sleep.gate.has("sleep restriction"));
  assert.ok(!sleep.gate.has("insomnia"));
  assert.ok(!sleep.gate.has("sleep duration"));
  const oil = typedConceptGroup(new Set(["waste oil", "waste cooking oil", "used cooking oil", "cooking oil", "used oil"]));
  assert.ok(oil.gate.has("waste cooking oil"));
  assert.ok(!oil.gate.has("cooking oil"));
});
test("a fresh cooking oil paper does not touch the waste oil concept", () => {
  const group = new Set(["waste oil", "waste cooking oil", "used cooking oil", "cooking oil", "used oil"]);
  const fresh = { title: "Frying performance of fresh cooking oil", abstract: "Fresh cooking oil was heated and its quality measured over repeated frying cycles." };
  assert.equal(paperConceptGroupHits(fresh, [group]), 0);
  assert.equal(centralConceptHits(fresh, [{ term: "waste oil", group }]).total, 0);
  const waste = { title: "Larvae grown on waste cooking oil", abstract: "Waste cooking oil from restaurants served as a feed substrate in this trial." };
  assert.ok(paperConceptGroupHits(waste, [group]) >= 1);
  assert.ok(centralConceptHits(waste, [{ term: "waste oil", group }]).total >= 1);
});
test("an insomnia only paper does not touch the sleep concept at the gate", () => {
  const group = new Set(["sleep", "sleeping", "sleep deprivation", "sleep restriction", "short sleep", "sleep loss", "insomnia", "sleep duration", "sleep quality"]);
  const ins = { title: "Insomnia treatment outcomes", abstract: "Patients with insomnia received therapy and reported better nights." };
  assert.equal(paperConceptGroupHits(ins, [group]), 0);
  const dep = { title: "Sleep restriction and cognition", abstract: "Sleep restriction to six hours nightly impaired vigilance." };
  assert.ok(paperConceptGroupHits(dep, [group]) >= 1);
});

/* ── L1-9: sense tested alternates, labeled classes ───────── */
group("L1-9 expansion validation (2026-10-23)");
test("wrong sense alternates fail the sense test", () => {
  assert.equal(expansionAlternatePassesSenseTest("fine", "small", "what is the fine structure of the hydrogen spectrum"), false);
  assert.equal(expansionAlternatePassesSenseTest("fine", "tiny", "what is the fine structure of the hydrogen spectrum"), false);
  assert.equal(expansionAlternatePassesSenseTest("grow", "reproduce", "how fast do plants grow taller"), false);
  assert.equal(expansionAlternatePassesSenseTest("grow", "breed", "how fast do plants grow taller"), false);
});
test("ordinary technical alternates are untouched by the sense test", () => {
  assert.equal(expansionAlternatePassesSenseTest("zorblaxin", "zorblaxin analog", "does zorblaxin help wounds"), true);
});
test("the validator strips the audit specimen's wrong senses", () => {
  const out = validateExpansionGroups(
    [{ term: "fine", alternates: ["small", "tiny", "minute", "penalty", "fine print", "fine structure"] }],
    "what is the fine structure of the hydrogen spectrum"
  );
  assert.equal(out.length, 1);
  for (const bad of ["small", "tiny", "minute", "penalty"]) assert.ok(!out[0].alternates.includes(bad), bad);
  assert.ok(out[0].alternates.includes("fine print"));
});
test("labeled classes pass their own test and ride the group", () => {
  assert.equal(expansionClassAlternatePasses("wound closure rate"), true);
  assert.equal(expansionClassAlternatePasses("randomized controlled trial"), true);
  const out = validateExpansionGroups(
    [{ term: "honey", alternates: ["medical grade honey"], outcomeMeasures: ["wound closure rate"], instruments: [], studyDesign: ["randomized controlled trial"] }],
    "does honey help wounds heal"
  );
  assert.equal(out.length, 1);
  assert.ok(out[0].classes && out[0].classes.outcomeMeasures.includes("wound closure rate"));
  assert.ok(out[0].alternates.includes("wound closure rate"));
});
test("coverage resolution preserves the labeled classes", () => {
  // Pipeline order: the validator labels the classes first,
  // then coverage resolution carries them through its merge.
  const validated = validateExpansionGroups(
    [{ term: "honey", alternates: ["medical grade honey"], outcomeMeasures: ["wound closure rate"] }],
    "does honey help wounds heal"
  );
  const cov = resolveExpansionCoverage("does honey help wounds heal", validated);
  const g = cov.groups.find((x) => x.term === "honey");
  assert.ok(g && g.classes && g.classes.outcomeMeasures.includes("wound closure rate"), JSON.stringify(cov.groups));
});

/* ── L1-10: adequacy of a group for the question shape ───── */
group("L1-10 group adequacy (2026-10-23)");
test("the hand sleep group is adequate for the outcome question", () => {
  assert.equal(isExpansionGroupInadequate("sleep", SLEEP_Q), false);
  const ad = expansionGroupAdequacy("sleep", SLEEP_Q, null);
  assert.equal(ad.adequate, true);
});
test("a group with no method vocabulary is inadequate for a measurement question", () => {
  const ad = expansionGroupAdequacy("enzyme", ASSAY_Q, ["enzyme", "enzymatic activity", "protein catalyst"]);
  assert.equal(ad.adequate, false);
  assert.ok(ad.missing.includes("method vocabulary"), JSON.stringify(ad));
});

/* ── L1-11 remainder: rebuilt boolean represents overflow ─── */
group("L1-11 rebuilt boolean overflow (2026-10-23)");
test("groups past the AND budget appear as an OR rung, not silence", () => {
  const heads = ["quinoa", "kefir", "turmeric", "ginger", "miso", "tempeh"];
  const groups = heads.map((t) => ({ term: t, alternates: [t + " extract", t + " powder"], classes: null }));
  const lookup = buildDynLookup(groups);
  const q = "quinoa kefir turmeric ginger miso tempeh comparison study";
  const bool = rebuildStructuredQueryFromGroups(q, lookup);
  assert.ok(bool, "no rebuilt boolean");
  assert.ok(/ AND /.test(bool), bool);
  assert.ok(/ OR /.test(bool), bool);
  // Every group's head is represented somewhere in the form:
  // the first four as AND rungs, the overflow as an OR rung.
  for (const t of heads) {
    assert.ok(bool.toLowerCase().includes(t), t + " missing from " + bool);
  }
});

/* ── L1-12: paraphrase additive and declared, one form ───── */
group("L1-12 canonical query forms (2026-10-23)");
test("contested rewrites are gone as a class", () => {
  const safety = canonicalQueryForms("is honey safe for babies");
  assert.ok(!/toxicity/.test(safety.cleaned), safety.cleaned);
  const warming = canonicalQueryForms("does global warming cause stronger storms");
  assert.ok(!/anthropogenic/.test(warming.cleaned), warming.cleaned);
  const cure = canonicalQueryForms("can turmeric cure cancer");
  assert.ok(!/\btreatment\b/.test(cure.cleaned), cure.cleaned);
  assert.ok(/cancer/.test(cure.cleaned));
});
test("the original is one of the recorded forms", () => {
  const f = canonicalQueryForms("is honey safe for babies");
  assert.equal(f.original, "is honey safe for babies");
  assert.ok(f.surface.length > 0);
});

/* ── L1-13: MeSH relations and sense conditions ───────────── */
group("L1-13 MeSH typing (2026-10-23)");
test("relations are labeled on the entries", () => {
  assert.equal(meshRelationFor("diabetes", "hyperglycemia"), "related");
  assert.equal(meshRelationFor("cancer", "carcinoma"), "narrower");
  assert.equal(meshRelationFor("cancer", "neoplasm"), "synonym");
});
test("heat stroke does not expand to brain stroke terms", () => {
  const terms = expandViaMesh("heat stroke treatment");
  assert.ok(!terms.some((t) => /cerebrovascular|ischemic/i.test(t)), terms.join(","));
  const plain = expandViaMesh("stroke symptoms and recovery");
  assert.ok(plain.length > 0);
});
test("typed expansion labels the stroke entry", () => {
  const typed = expandViaMeshTyped("stroke symptoms");
  assert.ok(typed.length > 0 && typed.every((t) => typeof t.relation === "string"));
});

/* ── L1-4: the preservation audit ─────────────────────────── */
group("L1-4 resolved query audit (2026-10-23)");
test("a faithful resolution passes with its mapping", () => {
  const a = auditResolvedQuery(SLEEP_Q, "sleep restriction six hours two weeks cognitive performance decline");
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.mapping["six hours"], "present");
});
test("a dropped dose fails the audit", () => {
  const a = auditResolvedQuery(SLEEP_Q, "sleep restriction cognitive performance decline");
  assert.equal(a.ok, false);
  assert.ok(a.missingNumbers.includes("six"));
});
test("a dropped negation fails the audit", () => {
  const a = auditResolvedQuery("can black soldier fly larvae grow without light", "black soldier fly larvae growth light");
  assert.equal(a.ok, false);
  assert.ok(a.missingNegations.includes("without"));
});
test("a controlled vocabulary mapping passes through the tables", () => {
  const a = auditResolvedQuery("whether heart attack symptoms differ in women", "myocardial infarction symptoms women");
  assert.equal(a.ok, true, JSON.stringify(a));
});

/* ── L1-14: generated query audit ─────────────────────────── */
group("L1-14 generated query audit (2026-10-23)");
test("a generated query mapping through the concept bridge passes", () => {
  const a = auditGeneratedSearchQuery("how fast do black soldier flies grow", "Hermetia illucens larval growth rate");
  assert.equal(a.ok, true);
});
test("an unmapped generated query is refused", () => {
  const a = auditGeneratedSearchQuery("how fast do black soldier flies grow", "quantum entanglement photon pairs laboratory");
  assert.equal(a.ok, false);
});
test("a production query fails the intent leg of a measurement question", () => {
  assert.equal(generatedQueryHonorsIntent(ASSAY_Q, "manganese peroxidase production optimization fermentation yield"), false);
  assert.equal(generatedQueryHonorsIntent(ASSAY_Q, "manganese peroxidase activity assay method"), true);
});

/* ── L1-16: learning gated on evidence quality ────────────── */
group("L1-16 query intelligence gate and decay (2026-10-23)");
test("confidence decays with age since the last success", () => {
  const now = Date.now();
  const fresh = qiConfidenceForRow({ success_count: 3, created_at: now, updated_at: now }, now);
  const stale = qiConfidenceForRow({ success_count: 3, created_at: now - 200 * 86400000, updated_at: now - 200 * 86400000 }, now);
  assert.equal(fresh, 1);
  assert.ok(stale < 0.5, String(stale));
});
test("the store gate needs two citable cited papers on the original question", () => {
  const papers = [
    { title: "Sleep restriction impairs cognitive performance", abstract: "Adults sleeping six hours nightly for two weeks showed worse cognitive performance and vigilance in a controlled study.", relevance: 50 },
    { title: "Sleep loss and attention in adults", abstract: "Sleep restriction over consecutive nights reduced sustained attention and working memory performance.", relevance: 45 },
  ];
  const good = queryIntelligenceStoreGate({
    answer: "Sleep restriction impairs performance [1]. Attention also falls [2].",
    evidencePapers: papers,
    query: SLEEP_Q,
  });
  assert.equal(good.store, true, JSON.stringify(good));
  const thin = queryIntelligenceStoreGate({
    answer: "Sleep restriction impairs performance [1].",
    evidencePapers: papers,
    query: SLEEP_Q,
  });
  assert.equal(thin.store, false);
});

/* ── L1-17: the structured form passed as data ────────────── */
group("L1-17 fetcher structured fallback (2026-10-23)");
test("a passed form is used verbatim", () => {
  assert.equal(fetcherStructuredFallback("anything at all", { structuredQuery: '"sleep" AND restriction' }), '"sleep" AND restriction');
});
test("no passed form takes the legacy rebuild", () => {
  const s = fetcherStructuredFallback("how does sleep affect memory", {});
  assert.equal(typeof s, "string");
});

/* ── L1-18: ambiguity needs positive evidence ─────────────── */
group("L1-18 ambiguity evidence rule (2026-10-23)");
test("ordinary settling words resolve the sense", () => {
  const a = detectAmbiguity("memory loss in old people");
  assert.equal(a.ambiguous, false);
  assert.equal(a.resolvedAs, "Human memory");
  const b = detectAmbiguity("how much memory does this laptop have");
  assert.equal(b.ambiguous, false);
  assert.equal(b.resolvedAs, "Computer memory");
});
test("a longer settled question is not flagged for missing table words", () => {
  const a = detectAmbiguity("does insulin resistance cause type 1 diabetes");
  assert.equal(a.ambiguous, false);
});
test("the bare term shape still flags", () => {
  const a = detectAmbiguity("What causes depression?");
  assert.equal(a.ambiguous, true);
});
test("two evidenced senses are genuine ambiguity with exactly those senses", () => {
  const a = detectAmbiguity("how does sleep affect memory and computer memory caching");
  assert.equal(a.ambiguous, true);
  assert.equal(a.interpretations.length, 2);
});

console.log("");
if (failures > 0) {
  console.log("query-understanding-repair: " + failures + " FAILED of " + count);
  process.exit(1);
}
console.log("query-understanding-repair: all " + count + " passed");
