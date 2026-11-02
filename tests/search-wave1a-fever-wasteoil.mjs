/**
 * Wave 1A (2026-11-02): the fever citation gate cluster (D1 to
 * D5), the fact check smalls (F1), and the waste oil remainders
 * (W1 to W3), from the fix all plan's Lane 1 diagnosis.
 *
 * The fever specimen behind every test here: "Why do we get a
 * fever when we are sick?" shipped citing only "The sick
 * songs" (2016), because the question resolved to two bare,
 * unbacked lay words, the gate demanded a paper engage BOTH,
 * and the field's own words (febrile, pyrexia, illness,
 * infection) engaged nothing. The waste oil specimen: a
 * collision pool counted as on topic through partial credit
 * disarmed the one funded rescue round, and the screening
 * chain's majority rule removed the adjacent subject
 * literature before the gate ever judged it.
 *
 * All records below are CONSTRUCTED: titles and abstracts
 * written to test the rules, not quoted from real papers.
 *
 * Run with: node tests/search-wave1a-fever-wasteoil.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  buildStructuredQuery, citationGateStandard, gateJudgedConcepts,
  paperClearsCitationGate, centralConceptHits, questionCentralConcepts,
  isMechanismShapeQuery, countOnTopicPapers, topicOverlapFilter,
  deepFactCheck, factCheckTierBudgetMs, FACT_CHECK_TIER_CAP_MS,
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

const FEVER_Q = "Why do we get a fever when we are sick?";

// ── Constructed records (see the header: constructed, not real) ──
const SONGS = {
  title: "The sick songs",
  abstract: "A review of popular songs. Song lyrics frequently describe sickness and illness, and being sick is a common theme in the lyrics analysed.",
};
const SONGS_BOTH_BARE = {
  title: "The sick songs",
  abstract: "A review of popular songs. Sickness and fever appear in song lyrics, fever as a metaphor for lovesickness.",
};
const GUIDELINE = {
  title: "Fever in children: paediatric fever guideline",
  abstract: "Assessment of the febrile child and fever management in paediatric practice.",
};
const PROSTAGLANDIN = {
  title: "Prostaglandin E2 and sickness behaviour",
  abstract: "Sickness behaviour and the febrile response during infection are mediated by prostaglandin E2 acting on the hypothalamus.",
};
const PATHOPHYSIOLOGY = {
  title: "The pathophysiology of fever",
  abstract: "Pyrogens raise the hypothalamic set point through prostaglandin E2, producing fever during infection.",
};

// ═══════════════════════════════════════════════════════════
console.log("\nD2 — the fever and sickness vocabulary bridges");

await test("both fever concepts resolve backed, through their groups", () => {
  const concepts = questionCentralConcepts(FEVER_Q);
  const byTerm = Object.fromEntries(concepts.map((c) => [c.term, c]));
  assert.ok(byTerm.fever && byTerm.fever.group, "fever concept carries no group");
  assert.ok(byTerm.sick && byTerm.sick.group, "sick concept carries no group");
  assert.ok(byTerm.fever.group.has("febrile"), "fever group lost febrile");
  assert.ok(byTerm.fever.group.has("pyrexia"), "fever group lost pyrexia");
  assert.ok(byTerm.sick.group.has("illness"), "sickness group lost illness");
  assert.ok(byTerm.sick.group.has("infection"), "sickness group lost infection");
});

await test("the field's words engage the concepts the asker's words name", () => {
  const std = citationGateStandard(FEVER_Q);
  const judged = gateJudgedConcepts(std);
  const febrileOnly = { title: "Febrile seizures in childhood", abstract: "A febrile seizure is a convulsion in a febrile child." };
  const hits = centralConceptHits(febrileOnly, judged);
  assert.ok(hits.total >= 1, "febrile engaged no concept: " + JSON.stringify(hits));
});

// ═══════════════════════════════════════════════════════════
console.log("\nD1 + D3 — the gate on the fever specimen shapes");

await test("under the pre fix bare standard the songs shape clears and the physiology shapes engage one bare word", () => {
  // The old standard's shape, built by hand: two bare concepts,
  // no groups. Judged by hit arithmetic (the gate itself now
  // carries the D3 degradation, so the old verdict is shown by
  // the engagement counts the old rule read).
  const bare = [{ term: "fever", group: null, subject: false }, { term: "sick", group: null, subject: false }];
  assert.equal(centralConceptHits(SONGS_BOTH_BARE, bare).total, 2,
    "the songs shape no longer engages both bare words");
  assert.equal(centralConceptHits(GUIDELINE, bare).total, 1,
    "the guideline shape engaged more than the one bare word the diagnosis measured");
  assert.equal(centralConceptHits(PROSTAGLANDIN, bare).total, 1,
    "the prostaglandin shape engaged more than the one bare word the diagnosis measured");
  assert.equal(centralConceptHits(PATHOPHYSIOLOGY, bare).total, 1,
    "the pathophysiology shape engaged more than the one bare word the diagnosis measured");
});

await test("the guideline, prostaglandin, and pathophysiology shapes now clear the gate", () => {
  const std = citationGateStandard(FEVER_Q);
  for (const [label, p] of [["guideline", GUIDELINE], ["prostaglandin", PROSTAGLANDIN], ["pathophysiology", PATHOPHYSIOLOGY]]) {
    assert.equal(paperClearsCitationGate(p, std), true, `${label} shape still fails the gate`);
  }
});

await test("the songs shape fails the gate", () => {
  const std = citationGateStandard(FEVER_Q);
  assert.equal(paperClearsCitationGate(SONGS, std), false,
    "a songs review engaging only the sickness side cleared the fever gate");
});

await test("D3 in isolation: a symptom plus a generic state word judges on the symptom alone", () => {
  // "cough" has no concept group, so this isolates the D3
  // degradation from the D2 bridges: cough (a CLINICAL_SHAPE_WORDS
  // symptom) beside sick (a generic state word).
  const q = "why do we cough when we are sick";
  const std = citationGateStandard(q);
  const coughPaper = {
    title: "The cough reflex in respiratory disease",
    abstract: "Cough is produced by airway sensory nerves and brainstem circuits during respiratory illness.",
  };
  const sickOnly = {
    title: "Being sick at home",
    abstract: "People who are sick and feel unwell stay home from work during illness.",
  };
  assert.equal(paperClearsCitationGate(coughPaper, std), true,
    "a paper engaging the symptom alone no longer clears");
  assert.equal(paperClearsCitationGate(sickOnly, std), false,
    "a paper engaging only the generic state word cleared on it");
});

await test("D1: the degraded structured query ORs bare terms, a grouped query still ANDs its groups", () => {
  assert.equal(buildStructuredQuery("has anyone assayed frogs"), "frogs OR assayed");
  const fever = buildStructuredQuery(FEVER_Q.toLowerCase());
  assert.ok(fever.includes(" AND "), "the fever query lost its group AND: " + fever);
  assert.ok(fever.includes("febrile"), "the fever query lost the group vocabulary: " + fever);
});

// ═══════════════════════════════════════════════════════════
console.log("\nD4 — the why form of the mechanism shape");

await test("why questions naming a clinical or bodily process word fire the mechanism shape", () => {
  for (const q of [
    FEVER_Q,
    "why does your temperature rise when you are ill",
    "why do we shiver when we are cold",
  ]) {
    assert.equal(isMechanismShapeQuery(q), true, `no mechanism shape for: ${q}`);
  }
});

await test("non clinical why questions do not fire the mechanism shape", () => {
  for (const q of [
    "why is the sky blue",
    "why did the council decide to close the road",
    "why do plants turn yellow in autumn",
    "why did the dinosaurs die out",
  ]) {
    assert.equal(isMechanismShapeQuery(q), false, `mechanism shape fired for: ${q}`);
  }
});

// ═══════════════════════════════════════════════════════════
console.log("\nD5 + W3 — the floors are described and reported as the binding reads them");

await test("D5: the citable binding's comment names the topical floor (source pin)", () => {
  assert.ok(/topical floor\s*\n\/\/ \(paperGateScore, the score's topical component, >=\s*\n\/\/ TOPICAL_GATE_FLOOR 25/.test(src),
    "the paperIsCitable header comment no longer names the topical binding");
});

await test("W3: the gate audit reports both floor readings with their own floors (source pin)", () => {
  assert.ok(src.includes('reasons.push("topical gate score " + gateRel + " below the floor of " + TOPICAL_GATE_FLOOR)'),
    "the gate audit lost the topical reading");
  assert.ok(src.includes('reasons.push("relevance " + rel + " below the floor of " + RELEVANCE_FLOOR)'),
    "the gate audit lost the blended reading");
});

// ═══════════════════════════════════════════════════════════
console.log("\nF1 — fact check smalls");

await test("the shared tier cap is 4,000 and a lone remaining tier can use it", () => {
  assert.equal(FACT_CHECK_TIER_CAP_MS, 4000);
  assert.equal(factCheckTierBudgetMs(8000, 1, 4000), 4000,
    "the shared cap still overrides the largest tier's own cap");
});

await test("unconfigured tiers leave no-key trace entries, and the fallback arms on an OpenRouter timeout", async () => {
  const realFetch = globalThis.fetch;
  const claimsJson = JSON.stringify({
    claims: [1, 2, 3].map((i) => ({
      claim: "Claim " + i + " from the answer",
      status: "supported",
      justification: "The cited abstract states it.",
      source_index: 1,
      sentence_index: i,
    })),
  });
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    const model = JSON.parse(opts.body).model;
    if (String(model).includes("gemma-4-31b")) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: claimsJson } }] }),
      text: async () => "",
    };
  };
  try {
    const trace = [];
    const papers = [{ title: "A fever paper", abstract: "Fever is produced by pyrogens acting on the hypothalamus." }];
    const claims = await deepFactCheck(
      "Fever is produced by pyrogens. It raises the set point. It is a symptom of infection.",
      papers, { OPENROUTER_KEY: "test-key" }, null, trace, null, {}
    );
    assert.ok(Array.isArray(claims) && claims.length >= 2,
      "the fallback tier did not land a verdict after the OpenRouter timeout");
    assert.equal(claims.checkTier, "openrouter-fallback",
      "the verdict did not come from the fallback tier: " + claims.checkTier);
    const byTier = Object.fromEntries(trace.map((e) => [e.tier, e.outcome]));
    assert.equal(byTier.gemini, "no-key", "the gemini tier left no no-key entry: " + JSON.stringify(trace));
    assert.equal(byTier.gemini2, "no-key", "the gemini2 tier left no no-key entry: " + JSON.stringify(trace));
    assert.equal(byTier.openrouter, "timeout", "the OpenRouter tier's timeout was not recorded: " + JSON.stringify(trace));
    assert.ok(calls >= 2, "the fallback fetch never fired");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ═══════════════════════════════════════════════════════════
console.log("\nW1 — the starved signal reads the full standard only");

const WASTE_Q = "can you feed maggots leftover frying grease and will they still grow fine and be safe to use";
const WOUND_CARE = {
  title: "Maggot therapy for wound care",
  abstract: "Maggots are used in wound care to debride necrotic tissue in chronic wounds and the therapy is safe.",
};
const BIODIESEL = {
  title: "Biodiesel production from waste oils",
  abstract: "Biodiesel can be produced from leftover frying grease and waste cooking oil by transesterification.",
};

await test("the lane's collision pool counts 2 under the counter's standing reading", () => {
  assert.equal(countOnTopicPapers([WOUND_CARE, BIODIESEL], WASTE_Q), 2);
});

await test("with clause contexts disabled the count drops the clause credit (compound proof)", () => {
  // A two field compound question that the shipped clause
  // split actually splits (an "and how" join): each field's
  // primary clears its own clause's standard, and only one
  // clears the full standard, so the clause credit is worth
  // exactly one paper here.
  const q = "how does crispr cut dna and how does pcr amplify dna";
  const crispr = {
    title: "CRISPR Cas9 nuclease activity",
    abstract: "The Cas9 nuclease cuts DNA at sites guided by a guide RNA in bacteria.",
  };
  const pcr = {
    title: "Polymerase chain reaction amplification",
    abstract: "PCR amplification of DNA uses cycles of denaturation and annealing.",
  };
  assert.equal(countOnTopicPapers([crispr, pcr], q), 2,
    "the standing counter lost its clause credit");
  assert.equal(countOnTopicPapers([crispr, pcr], q, null, { clauseContexts: false }), 1,
    "the clause disabled count still carries clause credit");
});

await test("the concept round's yield reads only the clause disabled count (source pin)", () => {
  assert.ok(src.includes("const onTopicAfterRawFullStandard = onTopicOf(results, { clauseContexts: false });"),
    "the concept round lost its full standard count");
  assert.ok(src.includes("onTopicAfterRawFullStandard === 0 && !laneShapeAhead"),
    "the yield's starved parameter is not the full standard count");
});

// ═══════════════════════════════════════════════════════════
console.log("\nW2 — the singleton filter's subject exemption");

await test("a subject engaging paper with one further accept set survives the majority rule", () => {
  const feeding = {
    title: "Feeding trials with grease diets",
    abstract: "Maggots were fed grease from restaurant fryers and their growth was recorded.",
  };
  const out = topicOverlapFilter(WASTE_Q, [{ ...feeding }]);
  assert.equal(out.length, 1, "the subject engaging feeding paper was removed: " + feeding._filteredReason);
});

await test("a subject engaging biodiesel record survives the majority rule", () => {
  const bio = {
    title: "Biodiesel from maggot grease",
    abstract: "Grease rendered from maggots was converted to biodiesel fuel.",
  };
  const out = topicOverlapFilter(WASTE_Q, [{ ...bio }]);
  assert.equal(out.length, 1, "the subject engaging biodiesel record was removed: " + bio._filteredReason);
});

await test("papers engaging no subject, or the subject alone, still face the majority rule", () => {
  // The biodiesel record engaging only the substrate clause
  // (no subject) is removed, exactly as the diagnosis measured.
  const bioPlain = { ...BIODIESEL };
  assert.equal(topicOverlapFilter(WASTE_Q, [bioPlain]).length, 0,
    "the substrate only biodiesel record survived without engaging the subject");
  assert.ok(/only shares 2 of the query's 6/.test(bioPlain._filteredReason || ""),
    "the removal reason changed: " + bioPlain._filteredReason);
  // The maize style collision: a paper engaging the subject
  // word and nothing else of the question still dies.
  const wound = { ...WOUND_CARE };
  assert.equal(topicOverlapFilter(WASTE_Q, [wound]).length, 0,
    "the subject only wound care collision survived");
  // An outcome only paper (grow, fine: two sets, no subject,
  // no substrate) still dies.
  const outcomeOnly = {
    title: "Growth outcomes in animals",
    abstract: "The animals grow fine and remain healthy throughout the study period.",
  };
  assert.equal(topicOverlapFilter(WASTE_Q, [{ ...outcomeOnly }]).length, 0,
    "the outcome only paper survived the majority rule");
});

console.log(`\nsearch-wave1a-fever-wasteoil: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
