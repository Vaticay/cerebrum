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
const { buildExtractiveSynthesis, isWellFormedClaim, buildEvidenceBrief } = await import(
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
