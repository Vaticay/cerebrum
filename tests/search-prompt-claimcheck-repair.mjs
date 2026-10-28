/**
 * Full process repair lane (2026-10-22, owner order "Fix all of
 * it"). Pins the three findings this lane owns in
 * functions/api/search.js:
 *
 *   L4-1 (remainder, after base 268707c). The existence scope
 *         rule already landed separately, in its own wording, in
 *         the compact and bulletproof prompts, backed by the
 *         L4-2 ship gate. What remained open was the rest of the
 *         full prompt's reasoning contract: the paper usage
 *         protocol essentials, the thin evidence first sentence
 *         rule, the citation permission protocol, the measured
 *         versus inferred separation, and the single weak source
 *         flagging rule reached no serving leg. Every wave,
 *         retry, and rescue now consumes a prompt built from the
 *         one shared contract (SYNTHESIS_CONTRACT_BLOCKS), the
 *         landed existence block is asserted alongside them in
 *         each leg, and the dead buildBriefMessages constructor
 *         is gone.
 *   L5-3. The deep claim check's verdicts were never verified
 *         against the sources. A claim is countable only when
 *         its quote is a verbatim substring of the abstract at
 *         its source index, the index is present, and the index
 *         is a citation marker on the claim's own sentence.
 *   L5-1. The terms name presence fallback was counted in the
 *         same support ledger as the deep claim check. It now
 *         returns no support count, in either direction.
 *
 * Written depth lane (2026-10-28, panel verdict of the same
 * day): the October 28 acceptance draws served a full slice
 * of 12 papers through every upstream stage and shipped 2
 * cited and 1 cited, and the twelve scorer panel ruled the
 * cause a prompt and instruction problem, 12 of 12, because
 * the synthesis instructions carried format and honesty rules
 * but no citation minimum of any kind. The citation depth
 * floor is now a sixth block of the shared contract above, and
 * the pins below assert that every serving prompt variant
 * carries it, that its wording stays conditioned on relevance
 * and support, and that the zero evidence prompt stays exempt.
 *
 * Run with: node tests/search-prompt-claimcheck-repair.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));
const { clampMessages } = await import(join(root, "functions/lib/inputGuard.js"));

const {
  SYNTHESIS_CONTRACT_BLOCKS, SYNTHESIS_CONTRACT_TEXT, CITATION_DEPTH_FLOOR_TEXT,
  buildCompactSystemPrompt, buildBulletproofSystemPrompt,
  buildQualityRetrySystemPrompt, buildCitationRetrySystemPrompt,
  factCheckKind, factCheckSupport, factCheckNamePresence,
  factCheckActuallyChecked, factCheckClaimCountable,
  buildConfidenceLine, applyUniversalClaimRule,
  applyUniversalClaimRuleToClaims, parseDeepFactCheckJSON,
  quoteIsVerbatimInAbstract, deepClaimEvidenceVerified,
  attributeDeepFactCheckClaims,
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
function group(name) { console.log(`\n${name}`); }

function assertContract(messages, leg) {
  const joined = (messages || []).map((m) => String(m.content || "")).join("\n");
  for (const block of SYNTHESIS_CONTRACT_BLOCKS) {
    assert.ok(joined.includes(block.text), leg + " is missing the contract block: " + block.name);
  }
}

// ═══════════════════════════════════════════════════════════
group("L4-1 — every serving leg's messages carry the shared contract blocks");

await test("the contract names the five remainder blocks and carries no dash characters", () => {
  // Pin changed 2026-10-28 (written depth lane): the block
  // list gains a sixth entry, the citation depth floor, after
  // the five remainder blocks. The five above keep their
  // names and their order.
  assert.deepEqual(SYNTHESIS_CONTRACT_BLOCKS.map((b) => b.name), [
    "paper usage protocol",
    "thin evidence first sentence rule",
    "citation permission protocol",
    "measured versus inferred separation",
    "single weak source flagging",
    "citation depth floor",
  ]);
  assert.ok(!/[-—–]/.test(SYNTHESIS_CONTRACT_TEXT),
    "the contract text carries a dash character");
});

await test("wave 1 and wave 2 messages, built the way the handler builds them, carry every block inside the clamp", () => {
  // The handler's compact construction: a system message from
  // buildCompactSystemPrompt plus a user message, clamped at
  // 16,000 chars. The user content here is deliberately oversized
  // evidence, so the clamp bites the evidence, never the system.
  const compactSystem = buildCompactSystemPrompt({
    id: "You are Cerebrum. ", mechanismShape: false, lengthHint: "LENGTH: a full answer.", structure: "STRUCTURE",
    existenceRule: "Existence questions bind harder: when the question asks whether any papers report something and none of the retrieved papers does, the only honest negative is 'I could not find one in the papers retrieved here. That is not proof that none exists.' Never write 'no paper does X', 'no study has done X', or 'the literature does not contain X' from a retrieved set, never answer with a bare 'no', and do not let the disagreement or limits sections treat such a negative as established about the field. ",
  });
  const compactMessages = clampMessages([
    { role: "system", content: compactSystem },
    { role: "user", content: "EVIDENCE ".repeat(4000) + "Question: why is the sky blue" },
  ], 16000).messages;
  assertContract(compactMessages, "compact messages (waves 1 and 2, rescue, delayed rescue)");
  // The already landed existence block, in its own wording,
  // asserted alongside the remainder blocks (base 268707c and
  // the compact prompt before it): this lane does not restate it.
  assert.ok(compactSystem.includes("Existence questions bind harder: when the question asks whether any papers report something and none of the retrieved papers does, the only honest negative is 'I could not find one in the papers retrieved here. That is not proof that none exists.'"),
    "the compact messages lost the landed existence block");
  // Wave 2's derivative, built the way the handler builds it:
  // the compact messages with the brief folded into the last one.
  const wave2Messages = (() => {
    const withBrief = compactMessages.map((m) => ({ ...m }));
    const last = withBrief[withBrief.length - 1];
    last.content = last.content + "\n\nPre-extracted claims from the sources above.";
    return withBrief;
  })();
  assertContract(wave2Messages, "wave 2 messages");
  // The mechanism shape keeps its first contract as well.
  const mechSystem = buildCompactSystemPrompt({
    id: "You are Cerebrum. ", mechanismShape: true, lengthHint: "", structure: "STRUCTURE", existenceRule: "",
  });
  assert.ok(mechSystem.includes("MECHANISM QUESTION . READ THIS FIRST."), "mechanism compact lost its opening contract");
  assertContract([{ role: "system", content: mechSystem }], "mechanism compact messages");
});

await test("wave 3 bulletproof messages carry every block", () => {
  const bulletproofMessages = [
    { role: "system", content: buildBulletproofSystemPrompt({ id: "You are Cerebrum. ", structure: "STRUCTURE", useEvidence: true, existenceRule: "If the question asks whether any papers report something and none of the sources below does, write 'I could not find one in the papers retrieved here. That is not proof that none exists.' Never state that no paper does something or that the literature lacks something; you can only describe the sources below." }) },
    { role: "user", content: "Sources:\n\n[1] A paper\n\n---\nQuestion: why is the sky blue" },
  ];
  assertContract(bulletproofMessages, "bulletproof messages");
  assert.ok(bulletproofMessages[0].content.includes("Teach plainly: findings stated as facts about the world"),
    "the bulletproof teaching frame was lost in the move to the builder");
  // The existence block landed at 268707c, verbatim: the builder
  // must carry it exactly, not this lane's restatement of it.
  assert.ok(bulletproofMessages[0].content.includes("If the question asks whether any papers report something and none of the sources below does, write 'I could not find one in the papers retrieved here. That is not proof that none exists.' Never state that no paper does something or that the literature lacks something; you can only describe the sources below."),
    "the bulletproof messages lost or rewrote the landed existence block");
});

await test("both retry legs' messages carry every block", () => {
  const qualityRetryMsgs = [
    { role: "system", content: buildQualityRetrySystemPrompt() },
    { role: "user", content: "Sources:\n\n[1] A paper\n\n---\nQuestion: why is the sky blue" },
  ];
  assertContract(qualityRetryMsgs, "quality retry messages");
  assert.ok(qualityRetryMsgs[0].content.includes("TEACH, DO NOT REPORT: phrase claims as facts about the world, explained plainly, with citations as support"),
    "the quality retry teaching frame was lost in the move to the builder");
  const citationRetryMsgs = [
    { role: "system", content: buildCitationRetrySystemPrompt() },
    { role: "user", content: "Papers:\n\n[1] A paper\n\n---\nQuestion: why is the sky blue" },
  ];
  assertContract(citationRetryMsgs, "citation retry messages");
  assert.ok(citationRetryMsgs[0].content.includes("Teach plainly: state findings as facts about the world"),
    "the citation retry teaching frame was lost in the move to the builder");
  // Both retries already carried an existence block before this
  // lane; the builders keep those wordings untouched.
  assert.ok(qualityRetryMsgs[0].content.includes("EXISTENCE SCOPE: if the question asks whether any papers report something and none of the sources does, write 'I could not find one in the papers retrieved here. That is not proof that none exists.'"),
    "the quality retry lost its pre existing existence block");
  assert.ok(citationRetryMsgs[0].content.includes("say 'I could not find one in the papers retrieved here. That is not proof that none exists.' Never state a field wide negative from a retrieved set."),
    "the citation retry lost its pre existing existence block");
});

await test("the handler wires every leg through the shared builders and no dead prompt constructor remains", () => {
  assert.ok(src.includes("buildCompactSystemPrompt({"), "the compact messages are not built by the shared constructor");
  assert.ok(src.includes("buildBulletproofSystemPrompt({"), "the bulletproof messages are not built by the shared constructor");
  assert.ok(src.includes("const retrySystemPrompt = buildQualityRetrySystemPrompt();"), "the quality retry does not consume its builder");
  assert.ok(src.includes("content: buildCitationRetrySystemPrompt()"), "the citation retry does not consume its builder");
  assert.ok(src.includes('systemPrompt = systemPrompt + "\\n\\n" + SYNTHESIS_CONTRACT_TEXT'),
    "the full prompt does not append the shared contract");
  assert.ok(!src.includes("const buildBriefMessages ="), "buildBriefMessages still exists as a dead prompt constructor");
  assert.ok(!src.includes("buildBriefMessages(brief)"), "a caller still reaches for the dead constructor");
});

// ═══════════════════════════════════════════════════════════
group("Written depth (2026-10-28) — every serving prompt variant carries the citation depth floor");

await test("the floor text states a relevance and support conditioned minimum of 3, never a bare count", () => {
  const floor = CITATION_DEPTH_FLOOR_TEXT;
  assert.ok(floor.includes("Citation depth floor."), "the floor lost its name line");
  assert.ok(floor.includes("Where at least 3 of the sources in front of you directly address the question and support claims in the answer, cite at least 3 of them"),
    "the floor lost its conditioned minimum of 3");
  assert.ok(floor.includes("each at the end of a sentence that source itself supports"),
    "the floor lost its per sentence support placement");
  assert.ok(floor.includes("never attach a citation to a claim its source does not report"),
    "the floor could now license citing a source for a claim it does not support");
  assert.ok(floor.includes("never cluster citations on one sentence to reach the count"),
    "the floor could now be met by padding one sentence");
  assert.ok(floor.includes("never invent a citation"), "the floor lost its no invention rule");
  assert.ok(floor.includes("When fewer than 3 of the sources in front of you directly address the question, cite the ones that do and say plainly that the rest do not cover it."),
    "the floor lost its thin pool sentence, so a thin or no evidence shaped set could be read as owing 3 citations");
  assert.ok(!/[-—–]/.test(floor), "the floor text carries a dash character");
  // The block in the shared contract is this exact text, so
  // no serving builder can carry a drifted copy of the floor.
  const block = SYNTHESIS_CONTRACT_BLOCKS.find((b) => b.name === "citation depth floor");
  assert.ok(block, "the shared contract has no citation depth floor block");
  assert.equal(block.text, floor, "the contract block is not the shared floor text");
  assert.ok(SYNTHESIS_CONTRACT_TEXT.includes(floor), "the assembled contract text lost the floor");
});

await test("each serving prompt builder carries the floor verbatim", () => {
  const variants = {
    "compact (waves 1 and 2, rescue, delayed rescue, minimum support retry)": buildCompactSystemPrompt({
      id: "You are Cerebrum. ", mechanismShape: false, lengthHint: "", structure: "STRUCTURE", existenceRule: "",
    }),
    "compact, mechanism shape": buildCompactSystemPrompt({
      id: "You are Cerebrum. ", mechanismShape: true, lengthHint: "", structure: "STRUCTURE", existenceRule: "",
    }),
    "bulletproof, evidence (wave 3)": buildBulletproofSystemPrompt({
      id: "You are Cerebrum. ", structure: "STRUCTURE", useEvidence: true, existenceRule: "",
    }),
    "bulletproof, no evidence flag (wave 3)": buildBulletproofSystemPrompt({
      id: "You are Cerebrum. ", structure: "STRUCTURE", useEvidence: false, existenceRule: "",
    }),
    "quality retry": buildQualityRetrySystemPrompt(),
    "citation retry": buildCitationRetrySystemPrompt(),
  };
  for (const [leg, prompt] of Object.entries(variants)) {
    assert.ok(prompt.includes(CITATION_DEPTH_FLOOR_TEXT), leg + " is missing the citation depth floor");
  }
});

await test("the handler wiring keeps the floor on the full prompt and off the zero evidence prompt", () => {
  // The full evidence prompt takes the whole contract, floor
  // included, by the append the L4-1 test above already pins.
  // The reference source (web) branch of that same prompt
  // takes the floor alone, in this exact form.
  assert.ok(src.includes('else if (useWeb) systemPrompt = systemPrompt + "\\n\\n" + CITATION_DEPTH_FLOOR_TEXT'),
    "the full prompt's reference source branch lost its floor append");
  // The floor text is referenced exactly three times in the
  // source: its definition, the contract block entry, and the
  // reference source append. A fourth reference would be a
  // new prompt site carrying it (the zero evidence branch
  // among them, which must stay exempt by construction), and
  // a missing one would be a serving variant that dropped it.
  assert.equal(src.split("CITATION_DEPTH_FLOOR_TEXT").length - 1, 3,
    "the floor text is referenced somewhere other than its definition, its contract block, and the reference source append");
  // The legs with no prompt constructor of their own consume
  // the compact or full messages, floor included: the rescue
  // and the minimum support retry build their messages from
  // exactly those two arrays.
  assert.ok(src.includes("const rescueMsgs = compactMessages || messages;"),
    "the rescue wave no longer consumes the compact or full messages");
  assert.ok(src.includes("const retryMsgs = (compactMessages || messages).map("),
    "the minimum support retry no longer consumes the compact or full messages");
  assert.ok(src.includes("callForLegLabel(label, compactMessages || messages,"),
    "the delayed rescue no longer consumes the compact or full messages");
});

// ═══════════════════════════════════════════════════════════
group("L5-3 — a deep verdict is countable only on verified evidence");

const FC_PAPERS = [
  { title: "Why the sky is blue", abstract: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths, and the sky appears blue from the ground." },
  { title: "Aerosols and the horizon", abstract: "Aerosol particles scatter all wavelengths of light, whitening the sky near the horizon on hazy days." },
];
const FC_ANSWER =
  "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths [1]. " +
  "Aerosol particles scatter all wavelengths of light [2].";

await test("a verbatim quote at the cited index stays countable", () => {
  const claim = {
    claim: "Air molecules scatter short wavelength blue light",
    status: "supported", sourceIndex: 1,
    quote: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths",
    justification: "The source states it directly.",
  };
  assert.equal(deepClaimEvidenceVerified(claim, FC_ANSWER, FC_PAPERS), true);
  assert.equal(quoteIsVerbatimInAbstract(claim.quote, FC_PAPERS[0]), true);
  // Whitespace differences alone do not break verbatim.
  const spaced = { ...claim, quote: "Air molecules scatter short wavelength\nblue light   far more strongly than longer wavelengths" };
  assert.equal(deepClaimEvidenceVerified(spaced, FC_ANSWER, FC_PAPERS), true,
    "a quote differing only in whitespace failed verification");
});

await test("a fabricated or paraphrased quote becomes unattributed and leaves the denominator", () => {
  const fabricated = {
    claim: "Air molecules scatter short wavelength blue light",
    status: "supported", sourceIndex: 1,
    quote: "Air molecules glow blue at midday and paint the sky",
    justification: "The source states it directly.",
  };
  const paraphrased = { ...fabricated, quote: "Air molecules scatter blue light strongly" };
  const emptyQuoted = { ...fabricated, quote: "" };
  for (const bad of [fabricated, paraphrased, emptyQuoted]) {
    assert.equal(deepClaimEvidenceVerified(bad, FC_ANSWER, FC_PAPERS), false,
      "an unverified quote verified: " + JSON.stringify(bad.quote));
  }
  const good = {
    claim: "Aerosol particles scatter all wavelengths of light",
    status: "supported", sourceIndex: 2,
    quote: "Aerosol particles scatter all wavelengths of light",
    justification: "The source states it directly.",
  };
  // The handler's own construction: attribution first, then the
  // panel shape with the unattributed kind, then the support
  // count. The fabricated verdict leaves the denominator.
  const attributed = attributeDeepFactCheckClaims([fabricated, good], FC_ANSWER, FC_PAPERS);
  assert.equal(attributed[0].unattributed, true, "the fabricated verdict was attributed");
  assert.equal(attributed[1].unattributed, false, "the verbatim verdict was marked unattributed");
  const panel = {
    overall: "partly", mode: "claims",
    claims: attributed.map((c) => ({
      claim: c.claim, status: c.status,
      ...(c.unattributed ? { kind: "unattributed" } : {}),
      note: c.justification,
    })),
  };
  assert.deepEqual(factCheckSupport(panel), { supported: 1, checked: 1 },
    "the denominator still counts the fabricated verdict: " + JSON.stringify(factCheckSupport(panel)));
  assert.equal(factCheckClaimCountable(panel.claims[0]), false);
});

await test("a missing index, an out of range index, and a misattributed binding are all unattributed", () => {
  const base = {
    claim: "Aerosol particles scatter all wavelengths of light",
    status: "supported",
    quote: "Aerosol particles scatter all wavelengths of light",
    justification: "The source states it directly.",
  };
  assert.equal(deepClaimEvidenceVerified({ ...base, sourceIndex: null }, FC_ANSWER, FC_PAPERS), false,
    "a claim with no source index verified");
  assert.equal(deepClaimEvidenceVerified({ ...base, sourceIndex: 9 }, FC_ANSWER, FC_PAPERS), false,
    "a claim bound outside the set verified");
  // The quote is verbatim in paper 1's abstract and paper 1
  // exists, but the claim's own sentence cites paper 2: the
  // binding, not the quote, is what fails.
  const misbound = {
    claim: "Air molecules scatter short wavelength blue light",
    status: "supported", sourceIndex: 2,
    quote: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths",
    justification: "The source states it directly.",
  };
  assert.equal(deepClaimEvidenceVerified(misbound, FC_ANSWER, FC_PAPERS), false,
    "a verdict bound to a paper its sentence does not cite verified");
  // A quote drawn from a different paper than the index names.
  const wrongPaperQuote = {
    claim: "Air molecules scatter short wavelength blue light",
    status: "supported", sourceIndex: 1,
    quote: "Aerosol particles scatter all wavelengths of light",
    justification: "The source states it directly.",
  };
  assert.equal(deepClaimEvidenceVerified(wrongPaperQuote, FC_ANSWER, FC_PAPERS), false,
    "a quote from another paper verified against the named index");
});

await test("an unsupported verdict is gated on its binding, its empty quote being the sanctioned refusal form", () => {
  const refusal = {
    claim: "Aerosol particles scatter all wavelengths of light",
    status: "unsupported", sourceIndex: 2, quote: "",
    justification: "No cited source mentions aerosol scattering in these terms.",
  };
  assert.equal(deepClaimEvidenceVerified(refusal, FC_ANSWER, FC_PAPERS), true,
    "a bound refusal with the sanctioned empty quote was marked unattributed");
  assert.equal(deepClaimEvidenceVerified({ ...refusal, sourceIndex: null }, FC_ANSWER, FC_PAPERS), false,
    "an unbound refusal verified");
  assert.equal(deepClaimEvidenceVerified({ ...refusal, sourceIndex: 1 }, FC_ANSWER, FC_PAPERS), false,
    "a refusal bound to a paper its sentence does not cite verified");
});

await test("composition with L5-2 claim typing: a universal typed claim is governed by the universal rule, not by quote verification", () => {
  // Parse time typing landed at 268707c: the universal claim
  // below is typed at extraction, before any verification here.
  const parsed = parseDeepFactCheckJSON(JSON.stringify({ claims: [
    { claim: "No study has measured this enzyme in soil samples", source_index: 1, quote: "a quote the checker invented for this claim", status: "supported", justification: "The cited paper does not measure it." },
    { claim: "Air molecules scatter short wavelength blue light", source_index: 1, quote: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths", status: "supported", justification: "The source states it directly." },
  ] }));
  assert.ok(parsed && parsed.length === 2, "the fixture did not parse into two claims");
  assert.equal(parsed[0].kind, "universal", "parse time typing did not mark the universal claim");
  // Attribution: the universal claim keeps the pre existing out
  // of range attribution and reaches the universal rule with its
  // kind intact, even though its quote would fail verification.
  // Quote verification governs the remaining claim, which passes.
  const attributed = attributeDeepFactCheckClaims(parsed, FC_ANSWER, FC_PAPERS);
  assert.equal(attributed[0].unattributed, false,
    "a universal typed claim was consumed by quote verification instead of the universal rule");
  assert.equal(attributed[1].unattributed, false, "the ordinary verified claim was marked unattributed");
  // The universal rule then does its own work: forced to
  // unsupported, countable as a checked, refused claim, because
  // no cited source is a systematic review or survey.
  const ruled = applyUniversalClaimRuleToClaims(attributed, FC_PAPERS);
  assert.equal(ruled[0].status, "unsupported", "the universal rule did not force the typed claim to unsupported");
  assert.equal(ruled[0].kind, "universal");
  const panel = {
    overall: "partly", mode: "claims",
    claims: ruled.map((c) => ({
      claim: c.claim, status: c.status,
      ...(c.unattributed ? { kind: "unattributed" } : (c.kind ? { kind: c.kind } : {})),
      note: c.justification,
    })),
  };
  assert.deepEqual(factCheckSupport(panel), { supported: 1, checked: 2 },
    "the universal claim did not stay countable as a refused claim: " + JSON.stringify(factCheckSupport(panel)));
});

await test("the handler and the checker prompt carry the verification contract", () => {
  assert.ok(src.includes("attributeDeepFactCheckClaims(deepClaims, answer, evidencePapers)"),
    "the handler does not verify the deep verdicts it counts");
  assert.ok(src.includes("MUST be one of the [N]"), "the checker prompt still permits closest match binding");
  assert.ok(!src.includes("otherwise the source whose content is the closest match"),
    "the checker prompt still instructs closest match binding");
  assert.ok(src.includes("character for character"), "the checker prompt does not demand a verbatim quote");
});

// ═══════════════════════════════════════════════════════════
group("L5-1 — name presence is not claim support, in either direction");

const TERMS_PANEL = {
  overall: "supported", mode: "terms",
  summary: "Every specific name the answer uses turns up in a paper it cites.",
  claims: [{ claim: "BSFL", status: "supported", note: "" }],
};
const TERMS_PANEL_FAILED = {
  overall: "unsupported", mode: "terms",
  summary: "One name does not turn up in any paper the answer cites.",
  claims: [{ claim: "ZZZ9", status: "unsupported", note: "Not in the title or abstract of anything the answer cites." }],
};
const DEEP_PANEL = {
  overall: "supported", mode: "claims",
  claims: [{ claim: "A checked claim", status: "supported", note: "quote" }],
};

await test("factCheckKind separates terms from verification and provenance", () => {
  assert.equal(factCheckKind(TERMS_PANEL), "terms");
  assert.equal(factCheckKind(DEEP_PANEL), "verification");
  assert.equal(factCheckKind({ mode: "extractive", claims: [] }), "provenance");
  assert.equal(factCheckKind(null), null);
});

await test("factCheckSupport is null for terms and provenance and real for deep", () => {
  assert.equal(factCheckSupport(TERMS_PANEL), null,
    "a name match still mints a support count: " + JSON.stringify(factCheckSupport(TERMS_PANEL)));
  assert.equal(factCheckSupport(TERMS_PANEL_FAILED), null,
    "a failed name match still produces a zero support count");
  assert.equal(factCheckSupport({ mode: "extractive", claims: [{ claim: "x", status: "traced" }] }), null);
  assert.deepEqual(factCheckSupport(DEEP_PANEL), { supported: 1, checked: 1 });
});

await test("a terms result reports as name presence through its own ledger", () => {
  assert.deepEqual(factCheckNamePresence(TERMS_PANEL), { present: 1, indirect: 0, checked: 1 });
  assert.deepEqual(factCheckNamePresence({
    mode: "terms",
    claims: [
      { claim: "BSFL", status: "supported" },
      { claim: "HPLC", status: "thin" },
      { claim: "ZZZ9", status: "unsupported" },
    ],
  }), { present: 1, indirect: 1, checked: 3 });
  assert.equal(factCheckNamePresence(DEEP_PANEL), null, "a deep panel borrowed the name presence ledger");
  assert.equal(factCheckNamePresence({ mode: "extractive", claims: [{ claim: "x", status: "traced" }] }), null);
});

await test("a terms panel cannot satisfy the claim check gate; the degrade trigger reads name presence only", () => {
  assert.equal(factCheckActuallyChecked(TERMS_PANEL), false,
    "a name presence result counted as a claim check that ran");
  assert.equal(factCheckActuallyChecked(DEEP_PANEL), true);
  // The support ledger is closed to terms in the certifying
  // direction: a terms panel yields no support object, so no
  // consumer can read it as claims checked or supported.
  assert.equal(factCheckSupport(TERMS_PANEL_FAILED), null);
  // Landing decision (Wave 1-C): the zero support serve's
  // degrade trigger is not certification, and it keeps the wave
  // eight protection: a terms panel whose every checked name
  // turned up nowhere in the cited papers (present and indirect
  // both zero) reads as a zero through factCheckNamePresence,
  // while any name turning up in either form keeps the draft.
  const np = factCheckNamePresence(TERMS_PANEL_FAILED);
  assert.ok(np && np.checked >= 1 && np.present === 0 && np.indirect === 0,
    "the failed terms panel does not read as a name presence zero: " + JSON.stringify(np));
  const npOk = factCheckNamePresence(TERMS_PANEL);
  assert.ok(!(npOk && npOk.present === 0 && npOk.indirect === 0),
    "a terms panel with a name present reads as a zero");
  assert.ok(src.includes("np.present === 0 && np.indirect === 0"),
    "the handler's zero support serve does not read the terms panel through name presence");
  // The confidence line's support input, replicated: a terms
  // panel hands buildConfidenceLine no support object, so its
  // zero support cap cannot fire on a name match failure. The
  // papers and context are the integrity suite's strong shape.
  const papers = [0, 1, 2, 3, 4].map((i) => ({
    title: "Paper " + i, year: 2025, type: "Journal Article", source: "pubmed", relevance: 92,
  }));
  const conf = buildConfidenceLine(papers, { status: "settled" }, {
    factCheckChecked: factCheckActuallyChecked(TERMS_PANEL_FAILED),
    support: factCheckSupport(TERMS_PANEL_FAILED),
  });
  assert.ok(!(conf.capReasons || []).some((r) => /supports none of the claims it checked/.test(r)),
    "a terms panel fired the confidence line's zero support cap: " + JSON.stringify(conf.capReasons));
  // The cache eligibility consumer reads the same support
  // object: a failed terms panel must not block a clean run.
  const supportAtWrite = factCheckSupport(TERMS_PANEL_FAILED);
  assert.equal(!(supportAtWrite && supportAtWrite.checked > 0 && supportAtWrite.supported === 0), true,
    "a failed terms panel still blocks cache eligibility as zero support");
});

await test("the universal claim rule leaves a terms panel untouched", () => {
  const out = applyUniversalClaimRule(TERMS_PANEL, FC_PAPERS);
  assert.equal(out, TERMS_PANEL, "the universal claim rule rewrote a name presence panel");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
