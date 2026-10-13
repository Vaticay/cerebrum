/**
 * Extractive-fallback integrity regressions (2026-09-16).
 *
 * From a real production QA pass on the signed-out search path (Wave-4
 * deterministic fallback), two defects shipped in the rendered answer:
 *
 *   1. ABBREVIATION TRUNCATION. An abstract's "An. stephensi" was split at
 *      "An.", and the fragment "…infection intensities in An." shipped as a
 *      cited claim. Genus abbreviations (An./P./E./S.) must not split
 *      sentences; a sentence ending on a bare "X." is rejected by the gate.
 *   2. DISHONEST FALLBACK COPY. A signed-out reader (AI synthesis gated,
 *      not failed) read "Cerebrum's AI providers were temporarily
 *      unavailable" — a false claim about our own infrastructure. The
 *      closing line now names the true gate reason.
 *
 * Unit tests against the real exports (no server, no network).
 *
 * Run with: node tests/extractive-fallback.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  buildExtractiveSynthesis, isWellFormedClaim, buildEvidenceBrief, getLastExtractiveTier, verifyExtractiveAlignment,
  pruneExtractiveEvidence, conceptGateContext, conceptGateKeeps, extractiveTermHit,
  buildFurtherReadingTail, paperConceptGroupHits, questionConceptGroups,
  buildDynLookup, gateConceptGroups, gateDynLookup,
} = await import(
  join(root, "functions/api/search.js")
);

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

const PAPER = (title, abstract) => ({ title, abstract, year: 2024 });

// The abstract is built so the ONLY high-scoring finding sentence contains
// the genus abbreviation; if the splitter cuts at "An.", the emitted text
// contains the dangling fragment.
const GENUS_ABSTRACT =
  "We previously demonstrated that modifying An. gambiae to express two " +
  "exogenous antimicrobial peptides inhibits the sporogonic development of " +
  "laboratory-cultured P. falciparum, and models predict significant " +
  "reductions in transmission. The compound effector molecule gene complexes " +
  "significantly reduced both parasite prevalence and infection intensities " +
  "in An. stephensi populations.";

await test("genus abbreviations do not split sentences", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive mosquitoes" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /An\. stephensi/, "full binomial must survive intact");
  assert.match(md, /P\. falciparum/, "full binomial must survive intact");
  assert.doesNotMatch(
    md,
    /in An\.\s*(\[\d+\]|$)/m,
    "dangling 'An.' fragment must never ship"
  );
});

await test("genuine sentence ends still split (uppercase follow)", () => {
  const md = buildExtractiveSynthesis(
    [
      PAPER(
        "Vitamin D trial",
        "Supplementation with vitamin D. The results demonstrated a " +
          "significant increase in serum levels across all cohorts studied."
      ),
    ],
    null,
    { query: "vitamin D" }
  );
  assert.ok(md, "expected markdown output");
  // "vitamin D." must remain a sentence boundary — the two sentences must
  // not be glued into one.
  assert.doesNotMatch(md, /vitamin D\. The results demonstrated a significant increase in serum levels[^.]*\./s, "sentences must not glue across the boundary");
});

await test("gate rejects dangling abbreviation fragments", () => {
  assert.equal(
    isWellFormedClaim("The compound reduced infection intensities in An."),
    false,
    "sentence ending on bare 'An.' is a splitter casualty"
  );
  assert.equal(
    isWellFormedClaim("The compound reduced infection intensities in An. stephensi."),
    true,
    "intact binomial sentence still passes"
  );
  assert.equal(
    isWellFormedClaim("Supplementation increased serum vitamin D levels significantly."),
    true,
    "ordinary sentence still passes"
  );
});

await test("signed-out fallback names the gate, not an outage", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive", aiGateReason: "signin-required" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /Sign in to use your free AI answers/i);
  assert.doesNotMatch(md, /sign in for AI-synthesized answers/i, "old paywall tease survived");
  assert.doesNotMatch(md, /temporarily unavailable/i);
});

await test("free-cap fallback names the cap, not an outage", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive", aiGateReason: "free-cap" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /used this period's AI answers/i);
  assert.doesNotMatch(md, /temporarily unavailable/i);
});

await test("true provider failure keeps the outage copy", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /temporarily unavailable/i);
});

// Dusty's 2026-10-08 photo: "THE SHORT ANSWER" opened with
// "Further, PERMANOVA showed that age and gender..." . a transitional
// opener on a tangential finding. The lede must strip connective openers
// and prefer the claim that shares the question's terms.
await test("short-answer lede strips transitional openers and answers the question", () => {
  const md = buildExtractiveSynthesis(
    [
      PAPER(
        "Microbial variation across demographics",
        "Further, PERMANOVA showed that age and gender explained a small yet " +
          "significant difference in microbial variation with greater variability " +
          "observed between males and females than across age groups. " +
          "The gut microbiome influences cardiovascular disease through " +
          "inflammatory pathways and metabolite signaling."
      ),
    ],
    null,
    { query: "How does the gut microbiome influence cardiovascular disease?" }
  );
  const lede = md.split("## ")[1] || "";
  assert.doesNotMatch(
    lede,
    /^[\s\S]*?further,/i,
    "transitional opener 'Further,' leaked into the short answer"
  );
  assert.match(
    lede,
    /gut microbiome influences cardiovascular disease/i,
    "query-relevant claim did not win the short-answer lede"
  );
});

// Same photo: "WASTE · FLY · HERMETIA" shipped as a ### subheader under
// "WHAT THE RESEARCH SHOWS". Tag-soup headers must never be generated.
await test("research tier emits no tag-soup subheaders", () => {
  const md = buildExtractiveSynthesis(
    [
      PAPER(
        "BSFL on waste oil 1",
        "Waste oil substrates were fed to black soldier fly larvae. Larval " +
          "growth was unaffected up to 30 percent replacement."
      ),
      PAPER(
        "BSFL on waste oil 2",
        "Black soldier fly larvae converted waste oil efficiently. The gut " +
          "microbiome of hermetia illucens shifted with waste oil inclusion."
      ),
      PAPER(
        "BSFL on waste oil 3",
        "Hermetia illucens larvae showed stable development on waste oil " +
          "substrates. Waste oil did not compromise protein content."
      ),
    ],
    null,
    { query: "Studies involving BSFL waste oil substrates" }
  );
  assert.ok(md, "expected markdown output");
  assert.doesNotMatch(
    md,
    /^### [A-Z][A-Z\s]*(?:\s*[·•]\s*[A-Z][A-Z\s]*)+\s*$/m,
    "tag-soup ### header survived in the research tier"
  );
  assert.doesNotMatch(
    md,
    /^[A-Z][A-Z\s]*(?:\s*[·•]\s*[A-Z][A-Z\s]*)+\s*$/m,
    "tag-soup keyword line survived anywhere in the answer"
  );
});

// The evidence brief is prompt context for the AI: a "[Waste · Fly ·
// Hermetia]" label teaches the model to emit the same pseudo-headers the
// NO SUBHEADERS rule bans. Labels stay sentence-case.
await test("evidence brief labels are sentence-case, not tag soup", () => {
  const papers = [
    { title: "BSFL on waste oil", abstract: "Waste oil fed to black soldier fly larvae." },
  ];
  const claimLists = [
    [
      "Waste oil substrates reshape the fly gut microbiome.",
      "Fly larvae converted waste oil substrates efficiently.",
    ],
  ];
  const brief = buildEvidenceBrief(papers, claimLists);
  assert.ok(brief && brief.text, "expected brief output");
  assert.doesNotMatch(brief.text, /\[Waste ·/);
  assert.match(brief.text, /\[findings on /);
});

// A source can hand the year back as a float string ("2015.0"); the venue
// lines in the extractive answers must print the integer year, never the
// decimal artifact (panel 2026-10-13).
await test("extractive venue lines render an integer year, never a float artifact", () => {
  const md = buildExtractiveSynthesis(
    [
      { title: "Gut enzyme activity in termite workers fed wood diets", abstract: "", year: "2015.0", journal: "Insect Science" },
      { title: "Digestive proteases of the cockroach midgut respond to diet protein", abstract: "", year: "2018", journal: "J Insect Physiol" },
      { title: "Amylase activity in whole gut homogenates of grasshoppers", abstract: "", year: "2011", journal: "Comp Biochem" },
    ],
    [],
    { query: "gut enzyme activity in insects" }
  );
  assert.ok(md, "expected markdown output");
  assert.doesNotMatch(md, /\b\d{4}\.\d+\b/, "float year artifact must never print");
  assert.match(md, /Insect Science, 2015 \[1\]/, "venue must carry the integer year");
});

// Voice pass (2026-10-13): the limited tier used to open with
// "## What the sources say" and narrate the pipeline's own process
// ("N of the papers above had abstracts detailed enough to draw
// findings from... The sentences below are the ones that speak to the
// question most closely"), so the fallback read as a report about
// papers. The corrected frame leads with the honest answer line and
// presents the quoted passages as supporting evidence, labeled as
// quotations, with the honest assembly closing intact.
const BEE_PAPERS = [
  PAPER(
    "Honey bee winter cluster thermoregulation",
    "Honey bee colonies maintain cluster temperature during winter by shivering flight muscles. " +
      "Bees at the cluster core stay warmer than bees at the surface."
  ),
  PAPER(
    "Varroa mite effects on colony survival",
    "Colonies infested with varroa mites showed higher winter losses than uninfested colonies in the survey."
  ),
];

// CONTRACT UPDATE (2026-10-13, extractive evidence fix): the
// BEE_PAPERS shelf below used to land on the limited tier only
// because the honesty gate judged it literally — analyzeQuery's
// glued window phrases could never fully match, so every paper
// read as a total miss. Under concept aware judging the shelf
// genuinely engages the question and earns the research tier;
// the first test pins that corrected landing. The limited tier
// formatting pins move to LIMITED_BEES, a shelf with no strongly
// relevant paper (both relevance 35), which is what the limited
// tier is honestly for.
const LIMITED_BEES = [
  { title: "Cluster thermoregulation in overwintering colonies", abstract: "Colonies maintain cluster temperature through the winter by shivering flight muscles. Bees at the cluster core stay warmer than bees at the surface.", year: 2024, relevance: 35 },
  { title: "Parasite loads and colony losses in cold months", abstract: "Colonies infested with varroa mites showed higher winter losses than uninfested colonies in the survey.", year: 2024, relevance: 35 },
];

await test("an on question shelf reaches the research tier under concept aware judging", () => {
  const md = buildExtractiveSynthesis(BEE_PAPERS, null, { query: "How do bees stay warm in winter?" });
  assert.ok(md, "expected markdown output");
  assert.equal(getLastExtractiveTier(), "research",
    "the bee shelf engages its question and must not be demoted to the limited tier by literal judging");
});

await test("limited tier leads with the answer line, excerpts labeled as quotations", () => {
  const md = buildExtractiveSynthesis(LIMITED_BEES, null, { query: "How do bees stay warm in winter?" });
  assert.ok(md, "expected markdown output");
  assert.equal(getLastExtractiveTier(), "limited", "fixture must land on the limited tier");
  assert.ok(md.startsWith("## The short answer\n\n"), "answer must open with The short answer, got: " + md.slice(0, 60));
  assert.doesNotMatch(md, /What the sources say/, "report frame heading survived");
  assert.doesNotMatch(md, /abstracts detailed enough/, "process narration survived");
  assert.doesNotMatch(md, /speak to the question most closely/, "process narration survived");
  const leadEnd = md.indexOf("### Supporting evidence");
  assert.ok(leadEnd > 0, "supporting evidence section missing");
  const lead = md.slice(0, leadEnd);
  assert.match(lead, /\[1\]/, "the lead line must be a cited quoted finding");
  assert.match(md, /Passages quoted from the papers:/, "excerpts must be labeled as quotations");
  assert.match(md, /without AI interpretation/, "honest assembly label must stay");
});

await test("limited tier existence question leads with the existence line", () => {
  const md = buildExtractiveSynthesis(
    [
      { title: "Insect gut microbiome survey", abstract: "Researchers sequenced bacterial communities from insect intestines and compared taxa across several diets and host species.", year: 2022, journal: "J Test", relevance: 35 },
      { title: "Purified enzyme kinetics in vitro", abstract: "Purified enzymes were isolated from insect tissue and their kinetics were measured in vitro under controlled conditions.", year: 2021, journal: "J Test", relevance: 35 },
    ],
    null,
    { query: "Do researchers ever just grind up insect intestines and test the juice for enzymes?" }
  );
  assert.ok(md, "expected markdown output");
  assert.equal(getLastExtractiveTier(), "limited", "fixture must land on the limited tier");
  assert.ok(
    md.startsWith("## The short answer\n\nNone of the retrieved papers report this practice directly."),
    "existence line must be the first content under the heading, got: " + md.slice(0, 120)
  );
  assert.match(md, /### Supporting evidence/, "quoted passages must sit under Supporting evidence");
  assert.doesNotMatch(md, /What the sources say/, "report frame heading survived");
});

await test("alignment checker still verifies the reframed limited answer end to end", () => {
  const md = buildExtractiveSynthesis(LIMITED_BEES, null, { query: "How do bees stay warm in winter?" });
  const res = verifyExtractiveAlignment(md, LIMITED_BEES);
  assert.equal(res.checked, true, "reframed answer escaped alignment checking");
  assert.equal(res.claims.length, 3, "lead plus both supporting passages must be checked, bibliography excluded");
  assert.equal(res.overall, "supported");
});

// ── EXTRACTIVE EVIDENCE STANDARD (2026-10-13) ────────────────────
// The production defect (build 6a5cad3, fleet capped): the baby
// belly question ran extractive and its record shipped 18 sources
// with exactly ONE citation — the baby spinach paper, a literal
// word collision — while the real infant gut shelf sat uncited in
// further reading and the shipped list also carried belly dance,
// prune belly case reports, a surrogacy law paper, and a big belly
// case report. The trace: the extractive honesty gate judged the
// shelf with literal term matching, so the field's own vocabulary
// (growth, microbiota, infants) scored zero against the question's
// words (grows, germs, baby) and the whole shelf "failed"; the
// run fell to the limited tier, whose literal sentence ranking
// made the spinach paper (which prints baby, belly, and gut
// vocabulary verbatim) nearly the only excerpt candidate; and the
// both concepts gate, which runs on the finished answer, can only
// demote markers — it cannot re pick excerpts — and its floor rule
// leaves a one citation answer untouched. The fixtures below pin
// the corrected contract: excerpts and the extractive shipped list
// are drawn only from papers meeting the gate's standard, the
// extractive instruments judge by concept and stem rather than
// literal words, and the guaranteed cascade still answers on a
// genuinely thin shelf. The question is worded in plain everyday
// language throughout, per the mismatched language rule.

const BELLY_Q = "Do the germs in a baby belly change how well the baby grows";
const DRAW_PAPER = (title, abstract, relevance) => ({ title, abstract, relevance, year: 2024, journal: "J Test" });
// The spinach paper's real abstract (Europe PMC): it genuinely
// touches both resolved concept groups (microbiome modulation;
// gastrointestinal, gut derived), so it MEETS the gate standard —
// the measured fact the report states plainly. What the fix ends
// is its monopoly: it can no longer be the only citation or the
// lede of an answer whose shelf is the infant gut literature.
const SPINACH_PAPER = () => DRAW_PAPER(
  "Metabolomic Characterization of Baby Spinach Phenolics Transformation During Gastrointestinal Digestion",
  "Gastrointestinal digestion and colonic fermentation determine phenolic transformation and reciprocal microbiome modulation, influencing the generation of gut-derived metabolites associated with epithelial integrity, inflammatory regulation, and metabolic homeostasis. Baby spinach phenolics possess antioxidant and microbiome-modulating potential; however, their functional efficacy is constrained by storage-induced degradation and limited gastrointestinal bioaccessibility. This study investigated phenolic transformation in fresh and stored baby spinach (4 °C and 25 °C) during simulated gastrointestinal digestion and colonic fermentation in vitro.",
  77
);
const CESAREAN_PAPER = () => DRAW_PAPER(
  "Partial restoration of the microbiota of cesarean-born infants via vaginal microbial transfer",
  "Exposure of newborns to the maternal vaginal microbiota is interrupted with cesarean birthing. Babies delivered by cesarean section acquire a microbiota that differs from that of vaginally delivered infants, and C-section delivery has been associated with increased risk for immune and metabolic disorders. Here we conducted a pilot study in which infants delivered by C-section were exposed to maternal vaginal fluids at birth. Similarly to vaginally delivered babies, the gut, oral and skin bacterial communities of these newborns during the first 30 days of life were enriched in vaginal bacteria.",
  58
);
const BIFIDO_PAPER = () => DRAW_PAPER(
  "Bifidobacteria-mediated immune system imprinting early in life",
  "Bifidobacteria are among the first colonizers of the newborn gut, yet how these bacteria imprint immune development is unclear. We show that bifidobacteria dominate the intestinal microbiota of breastfed infants in the first weeks. Infants lacking bifidobacteria showed weaker vaccine responses and slower growth over the first year.",
  57
);
const STUNTING_PAPER = () => DRAW_PAPER(
  "Early life gut microbiome and stunting in rural infants",
  "Gut microbiome samples from infants in rural Malawi were sequenced. Children with immature gut microbiota communities showed more stunting and poorer linear growth. Microbiota maturity at six months predicted height gain at eighteen months.",
  64
);
const ENTEROPATHY_PAPER = () => DRAW_PAPER(
  "Disrupting the vicious cycle of malnutrition and enteropathy: advancing strategies for child growth",
  "Environmental enteropathy is driven by chronic intestinal exposure in low-resource settings. Gut microbial communities in undernourished children fail to mature on schedule, and linear growth falters alongside them. Interventions that restore a healthier gut microbiota improved weight gain in recent trials.",
  64
);
const DANCE_PAPER = () => DRAW_PAPER(
  "The Influence of Belly Dance on the Second Stage of Labor and the Condition of the Baby",
  "Belly dance classes during pregnancy were studied for their effect on labor duration in 120 women. Women who danced reported less pain in the second stage of labor, and their babies were in good condition at birth.",
  66
);
const PRUNE_PAPER = () => DRAW_PAPER(
  "Prune belly syndrome: a case series",
  "Prune belly syndrome presents with abdominal wall deficiency in newborns. Three cases are described with urinary tract anomalies and surgical management in infancy.",
  59
);
const SURROGACY_PAPER = () => DRAW_PAPER(
  "Her Belly, Their Baby: A Contract Solution for Surrogacy Agreements",
  "This Note examines surrogacy contract law. Courts have split on enforcing gestational agreements, and this article proposes a contract framework for intended parents and carriers under state law.",
  63
);
const BIG_BELLY_PAPER = () => DRAW_PAPER(
  "Acute abdomen in a patient with a big belly: a case report",
  "A 54 year old man presented with abdominal distension. Imaging showed a large abdominal mass and surgery removed a benign tumor.",
  67
);
const COLLISION_TITLES = [
  "The Influence of Belly Dance on the Second Stage of Labor",
  "Prune belly syndrome",
  "Her Belly, Their Baby",
  "Acute abdomen in a patient with a big belly",
];
// The production evidence order: relevance put the collisions at
// the top of the shelf alongside the on point papers.
const PRODUCTION_EVIDENCE = () => [
  SPINACH_PAPER(), DANCE_PAPER(), BIG_BELLY_PAPER(), ENTEROPATHY_PAPER(),
  SURROGACY_PAPER(), CESAREAN_PAPER(), BIFIDO_PAPER(), STUNTING_PAPER(), PRUNE_PAPER(),
];
const citedIndices = (md) => {
  const out = [];
  for (const m of String(md || "").matchAll(/\[(\d+)\]/g)) out.push(Number(m[1]));
  return out;
};

await test("extractive term matching judges by concept and stem, not literal words", () => {
  assert.ok(extractiveTermHit("Linear growth faltered in the cohort.", "grows", null),
    "growth must answer for the question's word grows");
  assert.ok(extractiveTermHit("The microbiota differed by delivery mode.", "germs", null),
    "microbiota must answer for the question's word germs");
  assert.ok(extractiveTermHit("Intestinal communities mature over the first year.", "belly", null),
    "intestinal must answer for the question's word belly");
  assert.ok(extractiveTermHit("Babies delivered by section were enrolled.", "baby", null),
    "babies must answer for the question's word baby");
  assert.ok(!extractiveTermHit("Phenolic content fell during storage.", "grows", null),
    "an unrelated sentence must not hit");
});

await test("the prune drops the one concept collisions and keeps the on point shelf", () => {
  const groups = questionConceptGroups(BELLY_Q, null);
  assert.equal(groups.length, 2, "the question resolves to the microbe and gut groups");
  for (const p of [DANCE_PAPER(), PRUNE_PAPER(), SURROGACY_PAPER(), BIG_BELLY_PAPER()]) {
    assert.ok(paperConceptGroupHits(p, groups) < 2, `${p.title} must touch fewer than two groups`);
  }
  const pruned = pruneExtractiveEvidence(PRODUCTION_EVIDENCE(), BELLY_Q, null);
  assert.ok(pruned.changed, "the production evidence set must be pruned");
  const titles = pruned.papers.map((p) => p.title);
  for (const t of COLLISION_TITLES) {
    assert.ok(!titles.some((x) => x.includes(t)), `collision must leave the extractive evidence set: ${t}`);
  }
  for (const keep of ["cesarean-born infants", "Bifidobacteria-mediated", "stunting in rural infants", "malnutrition and enteropathy"]) {
    assert.ok(titles.some((x) => x.includes(keep)), `on point paper must stay: ${keep}`);
  }
  // The index map must point each kept paper at its new position.
  const original = PRODUCTION_EVIDENCE();
  for (const [oldIdx, newIdx] of pruned.idxMap) {
    assert.equal(pruned.papers[newIdx - 1].title, original[oldIdx - 1].title,
      "the index map must track each kept paper to its new position");
  }
});

await test("forced extractive run of the draw: the real shelf carries the answer", () => {
  const pruned = pruneExtractiveEvidence(PRODUCTION_EVIDENCE(), BELLY_Q, null);
  const md = buildExtractiveSynthesis(pruned.papers, null, { query: BELLY_Q });
  assert.ok(md, "the extractive builder must produce an answer");
  assert.equal(getLastExtractiveTier(), "research",
    "with concept aware judging the on point shelf must reach the research tier, not the limited tier");
  const cited = citedIndices(md);
  const idxOf = (frag) => pruned.papers.findIndex((p) => p.title.includes(frag)) + 1;
  for (const frag of ["cesarean-born infants", "Bifidobacteria-mediated", "stunting in rural infants"]) {
    assert.ok(cited.includes(idxOf(frag)), `on point paper must be cited: ${frag}`);
  }
  assert.ok(cited.length >= 3 && new Set(cited).size >= 3,
    "the answer must cite several papers, not one");
  const onPoint = new Set([
    idxOf("cesarean-born infants"), idxOf("Bifidobacteria-mediated"),
    idxOf("stunting in rural infants"), idxOf("malnutrition and enteropathy"),
  ]);
  assert.ok(onPoint.has(cited[0]),
    "the first citation (the lede) must come from an on point paper, not the collision");
  assert.ok(!(cited.length === 1 && cited[0] === idxOf("Baby Spinach")),
    "the spinach paper must never again be the only cited source");
  for (const t of COLLISION_TITLES) {
    assert.ok(!md.includes(t), `collision title must not appear anywhere in the answer: ${t}`);
  }
});

await test("the builder's own pool standard holds without the handler prune", () => {
  // Direct builder callers (and any future path that skips the
  // handler prune) get the same standard from the pool filter:
  // sub standard papers supply no excerpts and are not even listed.
  const md = buildExtractiveSynthesis(PRODUCTION_EVIDENCE(), null, { query: BELLY_Q });
  assert.ok(md, "the builder must produce an answer");
  for (const t of COLLISION_TITLES) {
    assert.ok(!md.includes(t), `collision title must not appear in builder output: ${t}`);
  }
  const cited = new Set(citedIndices(md));
  // Input positions: dance 2, big belly 3, surrogacy 5, prune 9.
  for (const idx of [2, 3, 5, 9]) {
    assert.ok(!cited.has(idx), `collision at input position ${idx} must never be cited`);
  }
});

await test("the extractive shipped list obeys the caps and carries no collisions", () => {
  // Assembly level composition, exactly as the handler composes
  // it: passes shelf snapshot, evidence cut, extractive prune,
  // tail held to the same standard, shipped = evidence + tail.
  const shelf = [...PRODUCTION_EVIDENCE()];
  for (let i = 0; i < 14; i++) {
    shelf.push(DRAW_PAPER(
      `Gut microbiota and early growth cohort study ${i + 1}`,
      "Cohort infants were followed for two years. Gut microbiota composition and intestinal markers were measured at three months, and linear growth and weight gain were tracked to age two.",
      60 - i
    ));
  }
  const evidence = shelf.slice(0, 12);
  const pruned = pruneExtractiveEvidence(evidence, BELLY_Q, null);
  assert.ok(pruned.papers.length <= 12, "evidence stays within the evidence cap after the prune");
  const tailAll = buildFurtherReadingTail(shelf, pruned.papers);
  const tailCtx = conceptGateContext(tailAll, BELLY_Q, null);
  const tail = tailAll.filter((p) => conceptGateKeeps(p, 0, tailCtx));
  assert.ok(tail.length <= 10, "the extractive tail stays within the tail cap");
  const shipped = [...pruned.papers, ...tail];
  assert.ok(shipped.length <= 22, "the shipped list stays within evidence cap plus tail cap");
  for (const t of COLLISION_TITLES) {
    assert.ok(!shipped.some((p) => p.title.includes(t)), `collision must not ship in any position: ${t}`);
  }
  for (const p of shipped) {
    assert.ok(p.thinEvidence || paperConceptGroupHits(p, tailCtx.groups) >= 2,
      `every shipped paper meets the gate standard: ${p.title}`);
  }
});

await test("thin shelf control: the cascade still answers when nothing clears the standard", () => {
  // A genuinely thin shelf: the only retrieved papers are two
  // case reports the relevance cascade flagged thinEvidence. They
  // touch one concept group at most, but the cascade guarantee
  // outranks the standard — the prune must stand down and the
  // builder must still answer.
  const thin = [
    { ...PRUNE_PAPER(), thinEvidence: true },
    { ...BIG_BELLY_PAPER(), thinEvidence: true },
  ];
  const pruned = pruneExtractiveEvidence(thin, BELLY_Q, null);
  assert.ok(!pruned.changed, "cascade papers must not be pruned away");
  const md = buildExtractiveSynthesis(pruned.papers, null, { query: BELLY_Q });
  assert.ok(md && md.length > 0, "a thin shelf still produces an honest answer, never zero sources");
  // Floor rule without cascade flags: when NO paper clears the
  // standard and none is flagged, the set also stands — a
  // mechanical pass must never manufacture zero sources.
  const floor = pruneExtractiveEvidence([DANCE_PAPER(), PRUNE_PAPER()], BELLY_Q, null);
  assert.ok(!floor.changed && floor.papers.length === 2, "the floor rule keeps the set when nothing clears");
  const md2 = buildExtractiveSynthesis(floor.papers, null, { query: BELLY_Q });
  assert.ok(md2 && md2.length > 0, "the floor set still answers");
});

// ── GATE GROUP PRECEDENCE (2026-10-13) ──────────────────────────
// The production defect (build 363d02c): a fresh run of this
// question drew a different shelf with the expansion leg cold and
// cited "The Baby with a Big Belly" and the belly dance paper in
// extractive mode, 8 cited of 9 shipped. When expansion DOES fire
// it can mint a group for the population word (baby becomes
// infant, newborn, birth), and every consumer counting the merged
// groups then lets gut plus population satisfy the two group
// standard — so the gates' strictness depended on the expansion
// leg. Gating now counts curated groups first (gateConceptGroups);
// model groups count only when the hand table resolves fewer than
// two. The adversarial lookup below is that population group.
const ADV_BABY_DYN = () => buildDynLookup([
  { term: "baby", alternates: ["infant", "newborn", "birth"] },
]);

await test("the prune holds under an adversarial expansion lookup", () => {
  assert.equal(gateDynLookup(BELLY_Q, ADV_BABY_DYN()), null,
    "two curated groups resolve, so the model lookup must not gate");
  assert.equal(gateConceptGroups(BELLY_Q, ADV_BABY_DYN()).length, 2,
    "the gating resolution is the microbe and gut groups alone");
  const plain = pruneExtractiveEvidence(PRODUCTION_EVIDENCE(), BELLY_Q, null);
  const adversarial = pruneExtractiveEvidence(PRODUCTION_EVIDENCE(), BELLY_Q, ADV_BABY_DYN());
  assert.ok(adversarial.changed, "the production evidence set must still be pruned");
  assert.deepEqual(adversarial.papers.map((p) => p.title), plain.papers.map((p) => p.title),
    "the pruned set is identical whether or not the expansion leg fired");
  for (const t of COLLISION_TITLES) {
    assert.ok(!adversarial.papers.some((p) => p.title.includes(t)),
      `collision must leave the evidence set under the adversarial lookup: ${t}`);
  }
});

await test("the builder holds under an adversarial expansion lookup", () => {
  // Direct builder call with the dyn lookup in ctx, the handler's
  // shape: the pool standard and the judging bridge both follow
  // the precedence, so the collisions supply no excerpts and are
  // not cited or listed. Input positions: dance 2, big belly 3,
  // surrogacy 5, prune 9.
  const md = buildExtractiveSynthesis(PRODUCTION_EVIDENCE(), null, { query: BELLY_Q, dynLookup: ADV_BABY_DYN() });
  assert.ok(md, "the builder must produce an answer");
  assert.equal(getLastExtractiveTier(), "research",
    "the on point shelf still reaches the research tier");
  for (const t of COLLISION_TITLES) {
    assert.ok(!md.includes(t), `collision title must not appear in builder output: ${t}`);
  }
  const cited = new Set(citedIndices(md));
  for (const idx of [2, 3, 5, 9]) {
    assert.ok(!cited.has(idx), `collision at input position ${idx} must never be cited`);
  }
  for (const idx of [6, 7, 8]) {
    assert.ok(cited.has(idx), `on point paper at input position ${idx} must be cited`);
  }
});

await test("the extractive tail standard holds under an adversarial expansion lookup", () => {
  const shelf = [...PRODUCTION_EVIDENCE()];
  const pruned = pruneExtractiveEvidence(shelf, BELLY_Q, ADV_BABY_DYN());
  const tailAll = buildFurtherReadingTail(shelf, pruned.papers);
  const tailCtx = conceptGateContext(tailAll, BELLY_Q, ADV_BABY_DYN());
  assert.equal(tailCtx.groups.length, 2, "the tail standard counts the curated groups alone");
  const tail = tailAll.filter((p) => conceptGateKeeps(p, 0, tailCtx));
  for (const t of COLLISION_TITLES) {
    assert.ok(!tail.some((p) => p.title.includes(t)), `collision must not ride the tail: ${t}`);
  }
  for (const p of tail) {
    assert.ok(p.thinEvidence || paperConceptGroupHits(p, tailCtx.groups) >= 2,
      `every tail entry meets the gate standard: ${p.title}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
