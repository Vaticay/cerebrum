/**
 * Search wave ten (2026-10-14): the hardcore audit wave.
 *
 *   Item 1 and 2: the gate audit. When the citation layer
 *     empties a healthy gathered pool, the run re judges the
 *     pool under the pre wave eight standard, records the top
 *     exclusions with reasons, and ships a limited answer over
 *     the comparison set instead of a false no evidence state.
 *     The honest no evidence state still fires when retrieval
 *     itself gathered near zero, and its copy never claims a
 *     finding was "too new to be indexed" when papers were
 *     gathered.
 *   Item 3: the audit's funnels as fixtures — yogurt and
 *     creatine pools where the strict standard admits nothing
 *     and the comparison standard admits the on point papers
 *     (and not the junk).
 *   Item 4: presented list hygiene — a title engaging none of
 *     the question's central concepts never ships, and the
 *     live lipid nanoparticle shape (delivery title with an
 *     application purpose clause) is application only.
 *   Item 5: famous health questions — the shape detector, the
 *     design tiers, and the shelf ordering that puts cohort
 *     studies and systematic reviews ahead of newsletters.
 *   Item 6: one source of truth for solidity — the headed
 *     confidence section is always the computed line.
 *   Item 7: disagreement requires genuine opposition — the
 *     audit's lead in water pair (a legislation passage and a
 *     study aim passage) is not a conflict.
 *   Item 8: repeated sentences are removed at ship time.
 *   Item 9: rephrasings are grammatical full questions.
 *   Item 10: the cache — the key derives from
 *     CACHE_SCHEMA_VERSION (v44), clean answers write serve
 *     eligible score, distinct citation counting.
 *   Item 11: the method walk teaches steps in order, and
 *     says plainly when the excerpts do not lay out the method
 *     (the live PCR excerpts are the negative fixture).
 *   Item 12: excerpt formatting — abbreviations expand,
 *     pseudo precise p values go, the falsification list is a
 *     list, a negative percentage keeps its sign in the bold.
 *   Item 13: the limited tier does not dress an unrelated
 *     paper as "The short answer" (the farmers hat fixture).
 *   Item 15: the free fleet spreads — bucket level daily
 *     parks, the model restricted class, interleaved firing
 *     order, auxiliary stages sharing leg health.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 * Handler scenarios run the real onRequest against a stub env
 * modeled on tests/search-wave-nine.mjs.
 *
 * Run with: node tests/search-wave-ten.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  onRequest, createSubrequestLedger,
  citationGateStandard, paperClearsCitationGate, paperClearsLegacyStandard,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  buildNoResultsPayload, buildSearchRecord, distinctCitedCount,
  paperTitleEngagesConcepts, paperApplicationOnly,
  isFamousHealthShapeQuery, healthEvidenceTier, orderShelfForHealth,
  bindProseConfidenceToLevel, buildConfidenceLine, confidenceAssertionRank,
  detectSourceConflicts, claimsGenuinelyOppose,
  dedupeRepeatedSentences, bindBakedConfidenceLine,
  deriveReformulations, isUsableReformulation, deriveRelatedTopics,
  expandExcerptAbbreviations, ensureFalsificationList,
  buildExtractiveSynthesis, getLastExtractiveTier,
  classifyLegFailure, synthesisBucketForLabel, bucketParkInfo,
  recordLegOutcome, legParkInfo, resetLegHealth, interleaveByBucket,
  methodStepPlanFor, methodStepIndex,
  RELEVANCE_FLOOR,
} = search;

const dynFor = (q) => buildDynLookup(buildDeterministicFallbackGroups(q, centralContentTerms(q)));

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

const paper = (title, abstract, year = "2021", citations = 50, extra = {}) => ({
  title, abstract, year: String(year), citations,
  citedByCount: citations, citationCount: citations,
  authors: "Doe J et al.", journal: "Journal of Recorded Studies",
  doi: "10.1000/w10-" + Math.abs([...title].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)),
  url: "https://doi.org/10.1000/w10-unit",
  relevance: 90,
  ...extra,
});

// ═══════════════════════════════════════════════════════════════
group("Item 15 — failure classes, bucket parks, interleaving");

await test("a provider restricted 403 classifies as model-restricted and parks", () => {
  resetLegHealth();
  // The wave nine live PCR probe's exact failure shape.
  const err = new Error("thinkingmachines/inkling:free: HTTP 403 . {\"error\":{\"message\":\"thinkingmachines/inkling is only available on agenti\"}}");
  assert.equal(classifyLegFailure(err), "model-restricted");
  assert.equal(classifyLegFailure(new Error("some model: HTTP 403 . forbidden")), "other",
    "a bare 403 without restriction wording must not read as a model restriction");
  recordLegOutcome("thinkingmachines/inkling:free", false, err);
  assert.ok(legParkInfo("thinkingmachines/inkling:free"), "the restricted leg is not parked");
  resetLegHealth();
});

await test("a daily cap inside the shared OpenRouter bucket parks the bucket, not just the model", () => {
  resetLegHealth();
  const daily = new Error("google/gemma-4-31b-it:free: HTTP 429 . rate limit exceeded: free models per day");
  recordLegOutcome("google/gemma-4-31b-it:free", false, daily);
  assert.equal(bucketParkInfo("gemini:gemini-3.8-flash"), null, "a compat label has no shared bucket park");
  assert.ok(bucketParkInfo("google/gemma-4-26b-a4b-it:free") !== null,
    "a sibling OpenRouter model does not see the bucket park");
  assert.equal(synthesisBucketForLabel("google/gemma-4-26b-a4b-it:free"), "openrouter");
  assert.equal(synthesisBucketForLabel("@cf/meta/llama-3.3-70b-instruct-fp8-fast"), "workers-ai");
  assert.equal(synthesisBucketForLabel("groq:openai/gpt-oss-120b"), "compat:groq");
  // A success in the bucket clears the bucket park.
  recordLegOutcome("google/gemma-4-26b-a4b-it:free", true);
  assert.equal(bucketParkInfo("google/gemma-4-31b-it:free"), null, "a bucket success did not clear the bucket park");
  resetLegHealth();
});

await test("a Groq daily cap parks the leg but NOT a shared bucket", () => {
  resetLegHealth();
  recordLegOutcome("groq:openai/gpt-oss-120b", false,
    new Error("groq:openai/gpt-oss-120b: HTTP 429 . rate limit reached for model, per day allowance spent"));
  assert.ok(legParkInfo("groq:openai/gpt-oss-120b"), "the groq leg itself is not parked");
  assert.equal(bucketParkInfo("groq:openai/gpt-oss-20b"), null,
    "groq models carry separate per model pools and must not bucket park");
  resetLegHealth();
});

await test("interleaveByBucket spreads a provider grouped array round robin", () => {
  const legs = [
    { label: "or-1", bucket: "openrouter" }, { label: "or-2", bucket: "openrouter" }, { label: "or-3", bucket: "openrouter" },
    { label: "g-1", bucket: "compat:groq" }, { label: "g-2", bucket: "compat:groq" },
    { label: "w-1", bucket: "workers-ai" },
  ];
  assert.deepEqual(interleaveByBucket(legs).map((d) => d.label),
    ["or-1", "g-1", "w-1", "or-2", "g-2", "or-3"]);
});

await test("the retries no longer race OpenRouter through a bare Promise.any", () => {
  assert.ok(!src.includes("retryModels.map((m) => callOR(m, retryMsgs"), "the quality retry still bypasses the wave planner");
  assert.ok(!src.includes("retryModels2.map((m) => callOR(m, retryMsgs2"), "the citation retry still bypasses the wave planner");
  assert.ok(src.includes("plannedRetryRace(retryMsgs"), "the quality retry is not on the planned race");
  assert.ok(src.includes("plannedRetryRace(retryMsgs2"), "the citation retry is not on the planned race");
});

// ═══════════════════════════════════════════════════════════════
group("Items 1 to 3 — the gate audit standards and the audit's funnels");

await test("yogurt funnel: the strict standard admits nothing, the comparison admits the on point papers", () => {
  // The audit's yogurt funnel, with the mechanism found
  // while building this fixture (2026-10-14, wave ten):
  // analyzeQuery used to mint the constraint "eating your"
  // (the question's verb glued to its possessive), a phrase
  // no paper contains, and the handler's constraint filter
  // zeroed the shelf before the citation gate ran. Wave ten
  // puts the possessives in the filler set (the constraint
  // is now the single word "eating") and gives the
  // constraint filter the never zero stand down the
  // programmatic passes already live by, so a defective
  // constraint cannot empty a healthy shelf again. At the
  // citation gate itself the divergence stands as the audit
  // recorded it: strict admits nothing, legacy admits the
  // review — the comparison the gate audit ships on.
  const q = "does eating yogurt actually help your gut";
  const dyn = dynFor(q);
  const std = citationGateStandard(q, dyn);
  const review = paper("Yogurt consumption and the intestinal microbiota: a narrative review",
    "This review discusses yogurt and fermented dairy foods. Yogurt provides live bacterial cultures that pass through the stomach and reach the intestine, where they interact with the resident microbiota. Trials report small changes in stool consistency and bloating after daily yogurt intake. The evidence that yogurt improves gut function in healthy adults remains limited and mixed.");
  assert.equal(paperClearsCitationGate(review, std), false,
    "fixture drift: the narrative review now clears the strict standard, so it no longer exercises the comparison");
  assert.equal(paperClearsLegacyStandard(review, q, dyn), true,
    "the comparison standard does not admit the on point yogurt review");
  const qa = search.analyzeQuery(q);
  assert.ok(!(qa.constraints || []).some((c) => /your/.test(c.phrase)),
    "a constraint still carries the asker's possessive: " + JSON.stringify(qa.constraints));
});

await test("creatine funnel: the comparison admits the supplementation review, not the neuroscience editorial", () => {
  const q = "is creatine bad for your kidneys";
  const dyn = dynFor(q);
  const std = citationGateStandard(q, dyn);
  const review = paper("Creatine supplementation and renal function: a systematic review",
    "This systematic review examines creatine supplementation and kidney outcomes. Across trials, creatine monohydrate at recommended doses did not impair renal function in healthy adults. Serum creatinine rose slightly during creatine loading without changes in measured glomerular filtration. The review concludes creatine supplementation is not harmful to the kidneys of healthy users.");
  const editorial = paper("Editorial: the athlete's brain and the substances of sport",
    "This editorial comments on neuroscience and sport, discussing how athletes think about supplements, training, and the culture of performance in modern athletics.");
  // PIN UPDATED (2026-10-15, wave seventeen): the review now
  // clears the strict standard, and that is the corrected
  // contract, not drift. The question's judged set carries
  // exactly one real concept — the creatine subject (the
  // kidney side resolved as a gating group but never became
  // a central concept on this question) — so the strict
  // standard is the diagnosis's one real concept rule, and a
  // review engaging the subject in its abstract clears it.
  // The strict versus legacy divergence this funnel existed
  // to exercise stands on the yogurt funnel above; the
  // comparison assertions below are unchanged.
  assert.equal(paperClearsCitationGate(review, std), true,
    "the creatine review no longer clears the strict standard under the one real concept rule");
  assert.equal(paperClearsLegacyStandard(review, q, dyn), true,
    "the comparison standard does not admit the creatine review");
  assert.equal(paperClearsLegacyStandard(editorial, q, dyn), false,
    "the comparison standard admitted the off topic editorial — the comparison must not become a junk gate");
});

await test("the no evidence copy never blames indexing when papers were gathered", () => {
  const gathered = buildNoResultsPayload({
    query: "how does pcr make more copies of dna",
    sourcesQueried: [{ name: "Europe PMC", ok: true }],
    rungsTried: ["exact"], gatedOut: 66, gatedExamples: ["Some paper"], errored: false,
  });
  assert.ok(!gathered.likelyReasons.some((r) => /too new to be indexed/i.test(r)),
    "the too new boilerplate shipped on a gathered pool: " + gathered.likelyReasons.join(" | "));
  assert.ok(gathered.likelyReasons.some((r) => /Papers exist nearby/i.test(r)),
    "the gathered pool reason is missing");
  const empty = buildNoResultsPayload({
    query: "what is the airspeed of a laden swallow cultivar trial",
    sourcesQueried: [{ name: "Europe PMC", ok: true }],
    rungsTried: ["exact"], gatedOut: 0, gatedExamples: [], errored: false,
  });
  assert.ok(empty.likelyReasons.some((r) => /too new to be indexed/i.test(r)),
    "the too new reason vanished from the genuinely empty retrieval it describes");
});

// ═══════════════════════════════════════════════════════════════
group("Item 4 — presented list hygiene");

await test("titles engaging none of the central concepts never present", () => {
  const crisprQ = "how does crispr cas9 actually cut dna";
  assert.equal(paperTitleEngagesConcepts(
    paper("Enhancer-Associated LncRNA-ITGA2 Promotes Vascular Remodeling Through ITGA2", "Vascular remodeling in pulmonary tissue."), crisprQ, dynFor(crisprQ)), false,
    "the vascular remodeling paper presents on the CRISPR question");
  assert.equal(paperTitleEngagesConcepts(
    paper("CRISPR Cas9 DNA cleavage by a dual RNA guided endonuclease", "Cas9 cleaves DNA."), crisprQ, dynFor(crisprQ)), true,
    "an on topic title does not engage");
  const leadQ = "how do you test if water has lead in it";
  assert.equal(paperTitleEngagesConcepts(
    paper("Bioethics and the Rohingya refugee crisis: consent in field research", "Ethics of research with displaced populations."), leadQ, dynFor(leadQ)), false,
    "the Rohingya bioethics paper presents on the lead question");
});

await test("the live lipid nanoparticle shape is application only, the mechanism engaging delivery paper is not", () => {
  const live = paper(
    "Comparative analysis of lipid Nanoparticle-Mediated delivery of CRISPR-Cas9 RNP versus mRNA/sgRNA for gene editing",
    "Lipid nanoparticles delivered CRISPR Cas9 ribonucleoprotein and messenger RNA guide complexes to liver tissue. Cleavage of the target gene and binding of the complexes were reported for each formulation, and editing rates in tissue were compared across doses.");
  assert.equal(paperApplicationOnly(live), true,
    "the live probe's delivery paper is not application only under the purpose clause rule");
});

// ═══════════════════════════════════════════════════════════════
group("Item 5 — famous health questions");

await test("the health shape detector fires on plain benefit and harm questions only", () => {
  assert.equal(isFamousHealthShapeQuery("does eating yogurt actually help your gut"), true);
  assert.equal(isFamousHealthShapeQuery("is creatine bad for your kidneys"), true);
  assert.equal(isFamousHealthShapeQuery("does coffee make you live longer"), true);
  assert.equal(isFamousHealthShapeQuery("how does crispr cas9 actually cut dna"), false);
  assert.equal(isFamousHealthShapeQuery("what is the capital of France"), false);
});

await test("design tiers rank cohorts and reviews ahead of newsletters, and the shelf order follows", () => {
  const cohort = paper("Coffee consumption and all cause mortality: a prospective cohort study", "A cohort of adults was followed for two decades.", "2019", 900, { journal: "European Journal of Epidemiology" });
  const review = paper("Coffee and mortality: a systematic review and meta-analysis", "Pooled evidence across cohorts.", "2021", 400);
  const newsletter = paper("Coffee: how much is too much?", "Our editors weigh in on the morning cup.", "2015", 5, { journal: "Harvard Health Letter" });
  const plain = paper("Coffee drinking habits in office workers", "A survey of habits.", "2018", 30);
  assert.equal(healthEvidenceTier(review), 3);
  assert.equal(healthEvidenceTier(cohort), 2);
  assert.equal(healthEvidenceTier(newsletter), 0);
  const ordered = orderShelfForHealth([newsletter, plain], [newsletter, plain, cohort, review]);
  assert.equal(ordered[0], review, "the systematic review does not lead the shelf: " + ordered.map((p) => p.title).join(" | "));
  assert.ok(!ordered.includes(newsletter), "the newsletter kept its seat against the review");
  assert.equal(ordered.length, 2, "the shelf grew");
});

// ═══════════════════════════════════════════════════════════════
group("Item 6 — solidity derives from the confidence object");

await test("the A1 solidity shape: the model's own solidity sentences never ship beside a thin line", () => {
  const line = buildConfidenceLine([paper("One paper", "One abstract.")],
    { status: "settled" }, { support: { supported: 0, checked: 1 } }).line;
  const answer =
    "## Summary\n\nCas9 cuts DNA at the guide site [1].\n\n" +
    "## How solid is this?\n\n" +
    "The mechanism is supported by multiple biochemical and structural studies, including high resolution crystal structures of Cas9 bound to its guide, indicating a high level of confidence.\n";
  const bound = bindProseConfidenceToLevel(answer, "thin", line);
  assert.ok(bound.includes("## How solid is this?\n\n" + line),
    "the section is not exactly the computed line: " + bound);
  assert.ok(!/crystal structures/i.test(bound), "the model's solidity claim shipped");
  assert.ok(!/high level of confidence/i.test(bound), "the model's confidence claim shipped");
  assert.ok(bound.includes("Cas9 cuts DNA at the guide site [1]."), "the answer body was harmed");
  assert.equal(confidenceAssertionRank("the trials are consistent, indicating a high level of confidence."), 2,
    "the reversed confidence phrasing does not rank as a high assertion");
});

// ═══════════════════════════════════════════════════════════════
group("Item 7 — genuine opposition only");

await test("the audit's lead pair is not a disagreement", () => {
  const papers = [
    paper("State policies for testing lead in school drinking water",
      "Across the states surveyed, no regulations exist for higher education settings, while several states require testing in primary schools. Programs vary in sampling frequency and in the action level applied to results."),
    paper("Baseline lead concentrations in school drinking water across seven states",
      "To detail baseline drinking water sample lead concentrations and features of US state level programs and policies to test school drinking water for lead in 7 states' operating programs between 2016 and 2018."),
  ];
  const result = detectSourceConflicts(papers);
  const conflicts = Array.isArray(result) ? result : result.conflicts;
  assert.equal(conflicts.length, 0, "the lead pair reads as a conflict: " + JSON.stringify(result));
  assert.notEqual(result.verdict && result.verdict.status, "divided", "the verdict reads divided on the lead pair");
});

await test("genuinely opposed findings still conflict", () => {
  const a = "The treatment increased wheat yield by 34% across the trial plots.";
  const b = "The treatment decreased wheat yield by 21% across the trial plots.";
  assert.equal(claimsGenuinelyOppose(a, b), true, "a genuine increase versus decrease no longer opposes");
  const aim = "To detail baseline yield concentrations and features of programs between 2016 and 2018.";
  assert.equal(claimsGenuinelyOppose(a, aim), false, "an aim statement opposes a finding");
});

// ═══════════════════════════════════════════════════════════════
group("Item 8 — repeated sentences");

await test("the doubled confidence sentence collapses, different sentences survive", () => {
  const text = "Confidence is capped at thin because one claim check ran, and Confidence is capped because the answer was assembled from source excerpts. " +
    "Confidence is capped because the answer was assembled from source excerpts. " +
    "A different sentence about the evidence stays.";
  const out = dedupeRepeatedSentences(text);
  const occurrences = (out.match(/Confidence is capped because the answer was assembled/g) || []).length;
  assert.equal(occurrences, 1, "the repeated sentence survived: " + out);
  assert.ok(out.includes("A different sentence about the evidence stays."), "an unrelated sentence was dropped");
});

// ═══════════════════════════════════════════════════════════════
group("Item 9 — rephrasings are full questions");

await test("no fragment suggestions on the audit's four questions", () => {
  const questions = [
    "does eating yogurt actually help your gut",
    "is creatine bad for your kidneys",
    "does coffee make you live longer",
    "does the color of a farmers hat change how many eggs chickens lay",
  ];
  for (const q of questions) {
    const suggestions = deriveReformulations(q);
    // Every shipped suggestion must be usable; three of the
    // four questions are also pinned to produce at least one.
    // "is creatine bad for your kidneys" can legitimately
    // yield none: its only broaden drops strand a dangling
    // possessive, and shipping nothing beats shipping a
    // fragment.
    if (q !== "is creatine bad for your kidneys") {
      assert.ok(suggestions.length >= 1, "no suggestions for: " + q);
    }
    for (const s of suggestions) {
      assert.ok(isUsableReformulation(s.query), "an unusable suggestion shipped for " + q + ": " + JSON.stringify(s));
      assert.ok(String(s.query).trim().endsWith("?"), "a suggestion without a question mark shipped: " + s.query);
    }
    const texts = suggestions.map((s) => s.query.toLowerCase());
    assert.ok(!texts.some((t) => /yogurt your gut|bad your kidneys/.test(t)),
      "a keyword bag fragment shipped for " + q + ": " + texts.join(" | "));
  }
  const topics = deriveRelatedTopics("does coffee make you live longer");
  assert.ok(!topics.includes("Longer"), "the bare fragment 'Longer' shipped as a related topic: " + JSON.stringify(topics));
});

// ═══════════════════════════════════════════════════════════════
group("Item 12 — excerpt formatting");

await test("abbreviations expand at first use in excerpts, pseudo precision goes, signs stay inside the bold", () => {
  const seen = new Set();
  const out1 = expandExcerptAbbreviations("GGT rose after treatment, and GGT stayed high.", seen);
  assert.ok(out1.includes("gamma-glutamyl transferase (GGT)"), "GGT did not expand: " + out1);
  assert.equal((out1.match(/gamma-glutamyl transferase/g) || []).length, 1, "GGT expanded twice");
  const crispr = expandExcerptAbbreviations("CRISPR systems cut DNA.", new Set());
  assert.ok(crispr.includes("clustered regularly interspaced short palindromic repeats (CRISPR)"),
    "CRISPR did not expand: " + crispr);
});

await test("the falsification section rebuilds as a list when it collapsed into a paragraph", () => {
  const collapsed = "## What would change this\n\nA replication in a second cohort. - A study measuring the opposite outcome. - A larger trial with preregistered endpoints. - A direct test of the mechanism.\n";
  const out = ensureFalsificationList(collapsed);
  const bullets = out.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, 4, "the collapsed section did not rebuild into four bullets: " + out);
  const listed = "## What would change this\n\n- One bullet.\n- Two bullet.\n";
  assert.equal(ensureFalsificationList(listed), listed, "an already listed section was rewritten");
});

// ═══════════════════════════════════════════════════════════════
group("Item 13 — the limited tier names an unrelated paper honestly");

await test("the farmers hat fixture: no short answer framing for a paper that does not examine the question", () => {
  const plumage = paper(
    "Morphological characteristics of native chicken of village Chhajjian, Haripur Pakistan",
    "Comb types and body weights were documented across the flock, and beak shape was noted for each bird.");
  const md = buildExtractiveSynthesis([plumage], null,
    { query: "does the color of a farmers hat change how many eggs chickens lay" });
  assert.ok(md, "no answer at all");
  assert.ok(!md.includes("## The short answer"), "the unrelated paper was dressed as the short answer:\n" + md);
  // The honest framings: the limited tier's "no study here
  // examines this" (the wave ten gate in buildBackgroundAnswer)
  // or the weak tier's plain couldn't find (this single thin
  // paper takes the weak tier). Either names the paper a
  // closest match only; neither dresses it as the answer.
  assert.match(md, /No retrieved study examines|No study here examines|Couldn't find a direct answer/i,
    "the honest framing is missing:\n" + md);
});

// ═══════════════════════════════════════════════════════════════
group("Item 11 — the method walk");

await test("the PCR negative fixture: measurement excerpts do not count as method steps", () => {
  const q = "how does pcr make more copies of dna";
  const plan = methodStepPlanFor(q, false, true);
  assert.ok(plan && plan.id === "pcr-cycle", "no PCR plan resolved");
  const negatives = [
    "The uncertainty in the copy number estimate was calculated from replicate measurements.",
    "Partition occupancy ranged from 0.16% through to 99.6% across the dilution series.",
    "Primer primer interactions were screened before the assays were run.",
    "Extended Survival of patients was reported in the companion clinical cohort.",
  ];
  for (const s of negatives) {
    assert.equal(methodStepIndex(s, plan), -1, "a non step sentence counted as a method step: " + s);
  }
  assert.ok(methodStepIndex("The mixture is heated so the double stranded DNA denatures into single strands.", plan) >= 0,
    "a denaturation sentence does not count");
  assert.ok(methodStepIndex("Primers anneal to the template as the mixture cools.", plan) >= 0,
    "an annealing sentence does not count");
  assert.ok(methodStepIndex("The polymerase extends the primers, synthesizing new strands.", plan) >= 0,
    "an extension sentence does not count");
});

await test("the western blot walk orders steps separation, transfer, blocking, antibody, detection", () => {
  const mk = (title, abstract) => paper(title, abstract, "2020", 40);
  const pool = [
    mk("Western blot detection of a single protein in tissue lysates",
      "Protein samples were analyzed by western blot. In the western blot, proteins from the lysate were separated by gel electrophoresis according to size, resolving the target protein from the rest of the lysate. The separated proteins were then transferred onto a nitrocellulose membrane, so the western blot pattern of proteins could be probed."),
    mk("Blocking and antibody steps in western blot protocols compared",
      "In this western blot comparison, the membrane was incubated with a blocking solution to cover empty binding sites on the western blot membrane before any antibody was applied. A primary antibody that binds the target protein was then applied to the western blot membrane, followed by a labeled secondary antibody that binds the primary antibody."),
    mk("Signal detection in western blot analysis of tissue proteins",
      "For detection in this western blot protocol, bands of the target protein were visualized by chemiluminescence after the antibody steps. The film was exposed to the membrane to record the signal from the labeled antibody on the western blot."),
  ];
  const md = buildExtractiveSynthesis(pool, null, { query: "how does a western blot find one protein" });
  assert.ok(md, "no answer");
  const walkAt = md.indexOf("How the method runs, in order");
  if (walkAt >= 0) {
    const walk = md.slice(walkAt, walkAt + 1600);
    const order = ["Separation", "Transfer", "Blocking", "Antibody", "Detection"]
      .map((s) => walk.indexOf("**" + s + ":**"));
    const present = order.filter((i) => i >= 0);
    assert.ok(present.length >= 3, "the walk is missing its steps: " + walk);
    const sorted = [...present].sort((a, b) => a - b);
    assert.deepEqual(present, sorted, "the walk steps are out of plan order: " + walk);
  } else {
    assert.ok(/do not lay out the method/i.test(md) || /What the research shows/.test(md),
      "neither a walk nor the plain statement shipped:\n" + md);
  }
});

// ═══════════════════════════════════════════════════════════════
group("Item 10 — the cache contract");

await test("distinct cited counting reads only real shelf indices, distinctly", () => {
  assert.equal(distinctCitedCount("Claims [1] and [2], again [1], plus [9] and [0].", 3), 2);
  assert.equal(distinctCitedCount("No citations here.", 5), 0);
});

await test("a clean write is serve eligible at write time and the record labels single source outcomes", () => {
  assert.ok(src.includes("const cacheScore = cleanFullAi ? 2 : 0;"), "the write time score computation is missing");
  assert.ok(src.includes("VALUES (?, ?, ?, ?, ?, ?)"), "the insert does not bind the computed score");
  const rec = buildSearchRecord({
    question: "how does crispr cas9 actually cut dna",
    askedAt: new Date(),
    diag: { funnel: { gathered: 10, deduped: 9 } },
    funnel: { gathered: 10, deduped: 9, cited: 1 },
    databases: [{ name: "Europe PMC", ok: true }],
    sources: [{ title: "One paper", cited: true }],
    answer: "One claim [1].",
  });
  assert.ok(rec && rec.minSupport && rec.minSupport.singleSource === true,
    "a single source record carries no minSupport label: " + JSON.stringify(rec && rec.minSupport));
  const rec2 = buildSearchRecord({
    question: "q", askedAt: new Date(),
    diag: { funnel: { gathered: 10, deduped: 9 } },
    funnel: { gathered: 10, deduped: 9, cited: 1 },
    databases: [{ name: "Europe PMC", ok: true }],
    sources: [{ title: "One paper", cited: true }],
    answer: "One claim [1].",
    minSupport: { citedBefore: 1, retried: true, retryModel: "groq:openai/gpt-oss-120b", citedAfter: 2, singleSource: false, reason: "recovered" },
  });
  assert.equal(rec2.minSupport.reason, "recovered");
  assert.equal(rec2.minSupport.singleSource, false);
});

// ═══════════════════════════════════════════════════════════════
// Handler scenarios (stub env modeled on search-wave-nine).
// ═══════════════════════════════════════════════════════════════
function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) { return jsonRes({ choices: [{ message: { content } }] }); }
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
let scenFailSynthesis = false;

const decoded = (u) => { try { return decodeURIComponent(String(u)); } catch { return String(u); } };
const isLaneUrl = (u) => { const d = decoded(u); return d.includes("cleavage") || d.includes("cohort") || d.includes("systematic review"); };

async function runScenario(query, opts = {}) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (scenFailSynthesis) return jsonRes({ error: { message: "rate limited" } }, 429);
      if (body.includes("literature search specialist")) {
        if (body.includes("creatine")) return chatRes(JSON.stringify([
          { term: "creatine", alternates: ["creatine monohydrate", "supplementation"] },
          { term: "kidneys", alternates: ["renal", "kidney function", "renal function"] },
        ]));
        return chatRes(JSON.stringify([
          { term: "yogurt", alternates: ["fermented milk", "cultured dairy", "kefir"] },
          { term: "gut", alternates: ["intestinal", "digestive", "microbiota"] },
        ]));
      }
      if (body.includes("relevance validator")) return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      return chatRes(scenAnswer);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      if (isLaneUrl(u)) return jsonRes({ resultList: { result: scenPapers } });
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("api.openalex.org")) return jsonRes({ results: [] });
    if (u.includes("api.semanticscholar.org")) return jsonRes({ data: [] });
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger(opts.limit || undefined);
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "w10-test-openrouter-key-123456",
      ...(opts.envExtra || {}),
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, settings: opts.settings || {} }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

const epmc = (id, title, abstractText, citedByCount = 40, pubYear = "2021") => ({
  title,
  doi: "10.1000/w10-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

group("Handler — the creatine funnel lands in the honest retrieval state, not a readmitted limited answer");

await test("a legacy admitting pool ships the retrieval state answer, with the gate audit labeled and nothing readmitted", async () => {
  // Synthesis fails outright (the audit's afternoon shape):
  // the limited ship is the extractive tier over the
  // comparison admitted papers.
  scenFailSynthesis = true;
  // The audit's creatine funnel shape: papers that engage
  // the subject and the organ, which the strict topicality
  // standard admits none of, while the pre wave eight
  // standard admits them. The off topic editorial clears
  // neither standard and must stay excluded, with its
  // reasons recorded.
  // PIN UPDATED (2026-10-15, wave seventeen): the original
  // abstracts named creatine throughout, and under the
  // citation depth diagnosis's one real concept rule those
  // papers now clear the strict standard directly (pinned
  // at unit level above), so the pool no longer exercises
  // the comparison. The abstracts below speak of "the
  // supplement" after the titles name the subject — the
  // common scientific shape the divergence actually lives
  // on: the strict standard requires the subject engaged in
  // the abstract, the legacy standard counts the title
  // touch. The audit assertions below are unchanged.
  scenPapers = [
    epmc(1, "Creatine supplementation and renal function: a systematic review",
      "This systematic review examines the supplement and kidney outcomes in healthy adults. Across trials, the supplement at recommended doses did not impair renal function. Serum creatinine rose slightly during loading without changes in measured glomerular filtration. The review concludes the supplement is not harmful to the kidneys of healthy users.", 120),
    epmc(2, "Long term creatine use and kidney health in athletes",
      "Athletes taking the supplement for two years were monitored for kidney health. Renal function markers, including serum creatinine and estimated glomerular filtration, stayed within reference ranges throughout the monitoring period. No adverse kidney outcomes were recorded.", 60),
    epmc(3, "Editorial: the athlete's brain and the substances of sport",
      "This editorial comments on neuroscience and sport, discussing how athletes think about supplements, training, and the culture of performance in modern athletics.", 30),
    epmc(4, "Creatine loading and serum creatinine in resistance trained men",
      "Resistance trained men completed a loading phase of twenty grams daily for five days. Serum creatinine rose during loading, while estimated glomerular filtration rate stayed within reference ranges. The authors note the loading protocol raises creatinine readings without indicating kidney damage.", 45),
    epmc(5, "Creatine intake and estimated glomerular filtration: a cohort analysis",
      "This cohort analysis followed adults taking the supplement for three years. Estimated glomerular filtration rate, the standard kidney function measure, did not decline faster in the supplement group than in matched non users. No excess of kidney diagnoses was recorded.", 80),
  ];
  scenAnswer = "## Summary\n\nAcross trials, the **supplement** at recommended doses did not impair **renal function** in healthy adults [1]. Athletes taking the supplement for two years kept renal markers within reference ranges [2].";
  const { data } = await runScenario("is creatine bad for your kidneys");
  // PIN UPDATED (2026-10-22, logic audit L3-2, owner order
  // "fix all of it"): the comparison admission this test was
  // written to pin is retired. One standard governs citation
  // now, so a pool the current standard empties ships the
  // retrieval state answer (what was searched, how many
  // papers were gathered, how many were withheld and why in
  // aggregate) instead of a limited answer over papers a
  // retired weaker standard admitted. The gate audit still
  // runs and still counts, in the record only, how many the
  // legacy standard would have admitted; it admits none.
  assert.equal(data.responseKind, "no-results",
    "the creatine pool did not land in the retrieval state: " + data.responseKind);
  assert.ok((data.sources || []).every((s) => !s.cited),
    "a paper the current standard excluded shipped as cited: " + JSON.stringify((data.sources || []).map((s) => [s.title, s.cited])));
  const ga = data._record && data._record.gateAudit;
  assert.ok(ga, "the record carries no gate audit for a gate emptied run");
  assert.equal(ga.shippedLimited, false, "the gate audit still labels a comparison admission as shipped");
  assert.equal(ga.citableBefore, 0, "the strict standard admitted papers the fixture says it should not");
  assert.ok(ga.comparisonAdmitted >= 1,
    "the record no longer counts what the legacy standard would have admitted: " + ga.comparisonAdmitted);
  const answerText = String(data.answer || "");
  assert.ok(/Counted once per paper under the first reason it failed/.test(answerText),
    "the shipped answer carries no aggregate exclusion accounting: " + answerText.slice(0, 400));
  assert.ok(!answerText.includes("No citable primary literature was found for this question."),
    "the literature verdict sentence shipped as an answer claim");
});

group("Handler — the honest empty state still fires, with an audit and honest reasons");

await test("a junk pool still lands in no results, the audit records why, and indexing is not blamed", async () => {
  scenFailSynthesis = false;
  scenPapers = [
    epmc(1, "Municipal bond yields and the market for local infrastructure debt",
      "This paper studies bond yields in municipal markets, the pricing of local infrastructure debt, and the behavior of institutional buyers across interest rate cycles.", 80),
    epmc(2, "Medieval trade routes and the price of Baltic grain",
      "Grain prices along Baltic trade routes are reconstructed from toll records, with attention to harvest failures and the Hanseatic ports.", 45),
  ];
  scenAnswer = "";
  const { data } = await runScenario("does eating yogurt actually help your gut");
  assert.equal(data.responseKind, "no-results",
    "a junk pool did not land in the honest no results state: " + data.responseKind);
  const ga = data._record && data._record.gateAudit;
  assert.ok(ga, "the record carries no gate audit for an emptied pool");
  assert.equal(ga.shippedLimited, false, "the junk pool was comparison admitted");
  assert.ok(Array.isArray(ga.excluded) && ga.excluded.length >= 1, "the audit names no excluded papers");
  const reasons = (data.noResults && data.noResults.likelyReasons) || [];
  assert.ok(!reasons.some((r) => /too new to be indexed/i.test(r)),
    "the no results copy blamed indexing on a gathered pool: " + reasons.join(" | "));
});

group("Handler — the foundational lane is visible in the funnel");

await test("the CRISPR run's funnel names the lane: fired, query, admitted count", async () => {
  scenFailSynthesis = false;
  scenPapers = [
    epmc(1, "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity",
      "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria. Cas9 is a dual RNA guided DNA endonuclease whose two nuclease domains cleave each strand of the target DNA, generating a double strand break at the site the guide RNA recognizes.", 9500, "2012"),
    epmc(2, "Mechanisms of CRISPR Cas9 DNA cleavage: a review",
      "This review surveys how CRISPR Cas9 cuts DNA. Guide RNA recognition positions the Cas9 endonuclease, whose nuclease domains cleave the two DNA strands. Structural work on binding of the guide and the target strand, and on the conformational changes that license cleavage, is summarized.", 340, "2023"),
  ];
  scenAnswer = "## Summary\n\nCas9 is guided to a target DNA sequence by a guide RNA, and its two nuclease domains cleave each strand of the DNA, generating a double strand break [1]. Structural work on binding of the guide and the target strand explains how cleavage is licensed [2].";
  const { data } = await runScenario("how does crispr cas9 actually cut dna");
  const lane = (data._funnel && data._funnel.foundationalLane) ||
    (data._record && data._record.funnel && data._record.funnel.foundationalLane);
  assert.ok(lane && lane.fired === true,
    "the foundational lane is not visible in the funnel or the record: " + JSON.stringify(data._funnel || {}));
  assert.ok(typeof lane.query === "string" && lane.query.length > 0, "the lane query is not recorded");
  assert.ok(typeof lane.admitted === "number", "the lane admitted count is not recorded");
});

console.log(`\nsearch-wave-ten: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
