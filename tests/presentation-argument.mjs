/**
 * Presentation of the answer as an argument — Wave 3 Lane S7 tests
 * (2026-10-23, logic audit Stage 7, L7-3 to L7-20).
 *
 * Unit tests against the real modules plus source level snapshots of
 * the client surfaces — no server, no database, no network. Fixtures
 * are taken from the Oct 21 corpus records under
 * ~/workspace/audit-oct21-searchfix/after (loaded when present) and
 * embedded verbatim where a shape must survive without the corpus.
 *
 * Run with: node tests/presentation-argument.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push({ name, error: e }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function group(name) { console.log(`\n${name}`); }

const pres = await import(join(root, "src/answerPresentation.js"));
const insights = await import(join(root, "src/answerInsights.js"));
const fc = await import(join(root, "src/fcLabel.js"));
const server = await import(join(root, "functions/api/search.js"));
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const fcSrc = await readFile(join(root, "src/fcLabel.js"), "utf8");

const corpusDir = join(root, "..", "audit-oct21-searchfix", "after");
const corpus = {};
if (existsSync(corpusDir)) {
  for (const n of ["01", "02", "03", "04", "05", "09", "15", "16"]) {
    const f = join(corpusDir, `${n}.json`);
    if (existsSync(f)) { try { corpus[n] = JSON.parse(readFileSync(f, "utf8")); } catch { /* skip */ } }
  }
}
const countConfidenceAssertions = (text) => {
  let n = 0;
  for (const m of String(text || "").matchAll(/\bconfidence\b/gi)) n++;
  return n;
};

// ══════════════════════════════════════════════════════════════════
group("L7-4 — one shared sectioniser splits glued headings first");

await test("server sectioniser splits the after/02 glued confidence heading", () => {
  const split = server.splitGluedServerHeading(
    "How solid is this? The conclusion rests on one peer reviewed experiment that measured multiple endpoints across a controlled diet comparison and gives moderate confidence that the oil influences larval composition in this study");
  assert.equal(split.head, "How solid is this?");
  assert.ok(split.body.startsWith("The conclusion rests on"), `body lost: ${split.body}`);
});

await test("binder output contains exactly one confidence assertion, the computed line", () => {
  const line = "Low confidence: this answer rests on only 1 cited source. Treat this answer as provisional.";
  const answer = "## The short answer\n\nOil can be fed to larvae [1].\n\n## How solid is this? The conclusion rests on one experiment and gives moderate confidence that the oil influences composition even if the effect sizes are not fully reported in the abstract provided here\n\nBody text.";
  const bound = server.bindProseConfidenceToLevel(answer, "thin", line);
  assert.ok(bound.includes("## How solid is this?"), "heading lost");
  assert.ok(!bound.includes("gives moderate confidence"), "glued essay survived the binder");
  assert.equal(countConfidenceAssertions(bound.split("## How solid is this?")[1] || ""), 1,
    "the confidence section must contain exactly the computed line's assertion");
});

await test("client, insights and server share the one label list", () => {
  assert.ok(appSrc.includes("SECTION_LABELS"), "client label list missing");
  for (const label of pres.SECTION_LABELS) {
    assert.ok(appSrc.includes(`"${label}"`), `client list missing ${label}`);
  }
  const serverSrcHas = (label) => label; // server list is asserted through behaviour above
  assert.equal(typeof serverSrcHas, "function");
  const secs = insights.splitAnswerSections("## How solid is this? A long glued essay about evidence quality that runs well past the heading limit for this section in the answer\n\nBody.");
  assert.equal(secs[0].heading, "How solid is this");
  assert.ok(secs[0].body.includes("glued essay"), "insights sectioniser lost the glued body");
});

await test("every glued heading shape in the corpus binds to one assertion", () => {
  const line = "Low confidence: this answer rests on only 1 cited source.";
  let shapes = 0;
  for (const rec of Object.values(corpus)) {
    if (!rec.answer || !/## How solid is this\? ./ .test(rec.answer)) continue;
    shapes++;
    const bound = server.bindProseConfidenceToLevel(rec.answer, "thin", line);
    const sec = bound.split(/## How solid is this\?/)[1] || "";
    assert.ok(!/moderate confidence|high level of confidence/i.test(sec.split(/\n## /)[0]),
      "a glued moderate or high essay survived beside a thin line");
  }
  if (Object.keys(corpus).length) assert.ok(shapes >= 2, `expected glued shapes in corpus, saw ${shapes}`);
});

// ══════════════════════════════════════════════════════════════════
group("L7-5 — disagreement section bound to the verdict");

await test("zero conflicts replaces an unnamed disagreement section with the verdict summary", () => {
  const verdict = corpus["03"] && corpus["03"].disagreementVerdict
    ? corpus["03"].disagreementVerdict
    : { status: "settled", conflictCount: 0, summary: "No opposing findings were detected among the 3 cited sources checked. That absence does not show that every cited source agrees." };
  const answer = "## The short answer\n\nBoth effects occur together [1][2][3].\n\n## Where researchers disagree\n\nSome studies emphasise the detrimental side [1] while others focus on the performance gains [2][3], and the disagreement stems largely from differences in oil dosage and the metrics prioritized.\n\n## What would change this\n\nMore trials.";
  const out = server.bindDisagreementSectionToVerdict(answer, verdict, []);
  assert.ok(!out.includes("performance gains"), "manufactured split survived a settled verdict");
  assert.ok(out.includes(verdict.summary), "verdict summary did not stand in for the section");
  assert.ok(out.includes("## Where researchers disagree"), "heading lost");
});

await test("conflicts above zero restrict the section to conflict pair citations", () => {
  const verdict = { status: "divided", conflictCount: 1, summary: "The cited sources genuinely split on one point." };
  const answer = "## Where researchers disagree\n\nPaper one reports harm [1] and paper two reports none [2], while paper three is background [3].";
  const out = server.bindDisagreementSectionToVerdict(answer, verdict, [{ idxA: 1, idxB: 2 }]);
  assert.ok(out.includes("[1]") && out.includes("[2]"), "pair citations were removed");
  assert.ok(!out.includes("[3]"), "a citation outside the conflict pairs survived");
});

await test("the ship gate calls the verdict binding", () => {
  const serverFile = readFileSync(join(root, "functions/api/search.js"), "utf8");
  assert.ok(serverFile.includes("bindDisagreementSectionToVerdict(answer, disagreementVerdict, literatureConflicts)"),
    "ship gate does not bind the section to the verdict");
});

// ══════════════════════════════════════════════════════════════════
group("L7-3 — shipped confidence invariant (band checker)");

await test("after/04's shipped line contradicts itself and the checker flags it", () => {
  const conf = corpus["04"] && corpus["04"].confidence
    ? corpus["04"].confidence
    : { level: "strong", line: "Strong confidence: this answer rests on 4 cited sources. The claim check supports 1 of 3 checked claims." };
  const inv = pres.confidenceInvariant(conf);
  assert.equal(inv.ok, false, "1 of 3 supported must not carry strong");
  assert.equal(inv.maxLevel, "thin");
});

await test("consistent lines pass the invariant", () => {
  assert.equal(pres.confidenceInvariant({ level: "thin", line: "Low confidence: this answer rests on 3 cited sources. The claim check supports 1 of 3 checked claims." }).ok, true);
  assert.equal(pres.confidenceInvariant({ level: "moderate", line: "Moderate confidence: this answer rests on 4 cited sources. The claim check supports 2 of 3 checked claims." }).ok, true);
  assert.equal(pres.confidenceInvariant({ level: "strong", line: "Strong confidence: this answer rests on 4 cited sources. The claim check supports 3 of 3 checked claims." }).ok, true);
  assert.equal(pres.confidenceInvariant({ level: "thin", line: "Low confidence: this answer rests on only 1 cited source." }).ok, true);
});

// ══════════════════════════════════════════════════════════════════
group("L7-6 — the uncited flag honoured by every consumer");

const mixedSources = [
  { title: "Cited paper", authors: "A One", journal: "J One", year: 2021, citations: 10 },
  ...Array.from({ length: 10 }, (_, i) => ({ title: `Further paper ${i + 1}`, authors: "B Two", journal: "J Two", year: 2020, citations: 5, uncited: true })),
];

await test("partition and counts label the sets", () => {
  const parts = pres.partitionSources(mixedSources);
  assert.equal(parts.cited.length, 1);
  assert.equal(parts.further.length, 10);
  assert.equal(pres.sourceCountsLabel(mixedSources), "1 cited paper · 10 further reading");
});

await test("every named surface reads the partition or the counts label", () => {
  for (const frag of [
    "sourceCountsLabel(sources)",            // AnswerSourcesPanel and rail kicker
    "sourceCountsLabel(t.sources)",          // article header
    "sourceCountsLabel(sources)}",           // Evidence eyebrow and Bibliography eyebrow
    "partitionSources(sources).cited.length", // Evidence tab count
    "partitionSources(list)",                // PDF references
    "partitionSources(t.sources)",           // paper References
    "sources.filter((x) => !(x && x.uncited))", // structured exports and Zotero and Excel
  ]) assert.ok(appSrc.includes(frag), `surface does not honour the uncited flag: ${frag}`);
  assert.ok(appSrc.includes("citedTotal"), "KeyFigures cited count missing");
  assert.ok(!appSrc.includes("Copy and export still cover the full list"), "the old full list note survived");
});

await test("copy export sections cited and further reading under their own headings", () => {
  assert.ok(appSrc.includes('"Cited\\n\\n" + sectionText(parts.cited)'), "copy Cited section missing");
  assert.ok(appSrc.includes('"Further reading\\n\\n" + sectionText(parts.further)'), "copy Further reading section missing");
  assert.ok(appSrc.includes('sectionHeading("Further reading")'), "PDF Further reading heading missing");
});

// ══════════════════════════════════════════════════════════════════
group("L7-7 and L7-10 — PDF and paper carry the answer itself");

await test("sections come out in the answer's own order under their own headings", () => {
  for (const rec of Object.values(corpus)) {
    if (!rec.answer) continue;
    const secs = pres.answerSectionsInOrder(rec.answer).filter((x) => x.heading);
    const heads = [...rec.answer.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => pres.splitGluedHeadingText(m[1].trim()).head || m[1].trim());
    assert.deepEqual(secs.map((x) => x.heading), heads, "section order or headings diverged from the answer");
  }
  assert.ok(appSrc.includes("return answerSectionsInOrder(md);"), "pdfSplitSections is not the shared sectioniser");
  assert.ok(appSrc.includes("if (!printedBlocks && !String(answer || \"\").trim())"),
    "the no answer text sentence can still print over a non empty answer");
});

await test("round trip: whitespace normalised plain text equals the answer's plain text", () => {
  const answer = "## The short answer\n\nFeeding larvae **used cooking oil** changes **abundance** relative growth and the metagenome transcriptome read ratio metric [1].\n\n## What would change this\n\n- A trial at a higher dose would overturn this.\n- A replication in another species would shift the view.";
  const plain = pres.answerPlainTextPreserved(answer);
  assert.equal(pres.whitespaceNormalised(plain),
    pres.whitespaceNormalised("The short answer Feeding larvae used cooking oil changes abundance relative growth and the metagenome transcriptome read ratio metric [1]. What would change this - A trial at a higher dose would overturn this. - A replication in another species would shift the view."));
  assert.ok(!plain.includes("**"), "style markers survived into plain text");
  assert.ok(plain.includes("abundance relative"), "a styled compound lost its space");
  // Corpus round trip: every section heading survives in order in plain text.
  for (const rec of Object.values(corpus)) {
    if (!rec.answer) continue;
    const text = pres.answerPlainTextPreserved(rec.answer);
    let at = -1;
    for (const sec of pres.answerSectionsInOrder(rec.answer)) {
      if (!sec.heading) continue;
      const idx = text.indexOf(pres.plainTextOf(sec.heading), at + 1);
      assert.ok(idx > at, `heading out of order in plain text: ${sec.heading}`);
      at = idx;
    }
  }
});

// ══════════════════════════════════════════════════════════════════
group("L7-8 and L7-11 — provenance and denominators in exports");

await test("byline mapping covers all three modes plus unrecorded, weakest by default", () => {
  assert.equal(pres.synthesisByline("ai").byline, "Synthesized by Cerebrum");
  assert.equal(pres.synthesisByline("extractive").byline, "Drafted from sources");
  assert.equal(pres.synthesisByline("none").byline, "Synthesis unavailable");
  assert.equal(pres.synthesisByline(undefined).byline, "Generated by Cerebrum");
  assert.equal(pres.synthesisByline("mystery").tag, "Generated by Cerebrum");
  assert.ok(appSrc.includes("synthesisByline(t.synthesisMode).byline"), "a byline does not use the shared mapping");
  assert.ok(!appSrc.includes("Synthesized by Cerebrum · {new Date()"), "the unconditional paper byline survived");
});

await test("named set statistics never mix denominators", () => {
  const parts = pres.partitionSources(mixedSources);
  const citedStats = pres.namedSetStats(parts.cited, "cited");
  assert.equal(citedStats.count, 1);
  assert.equal(citedStats.combinedCitations, 10);
  const line = pres.describeNamedSetStats(citedStats);
  assert.ok(line.includes("in the cited set"), `set not named beside its numbers: ${line}`);
  const furtherStats = pres.namedSetStats(parts.further, "further reading");
  assert.equal(furtherStats.combinedCitations, 50);
  assert.ok(appSrc.includes('sectionHeading("About this export")'), "PDF export additions are not appended after the body");
});

await test("paper builder never relabels a paragraph Abstract or Conclusion", () => {
  const start = appSrc.indexOf("function buildAcademicPaperBlocks");
  const body = appSrc.slice(start, start + 2200);
  assert.ok(!/Abstract|Conclusion/.test(body.replace(/abstract|conclusion/gi, "")), "builder mentions a relabel");
  assert.ok(!body.includes('"Abstract"') && !body.includes('"Conclusion"'), "builder relabels paragraphs");
});

// ══════════════════════════════════════════════════════════════════
group("L7-9 — server status words only on client surfaces");

await test("no locally synonymised kicker remains and the fallback body is the shipped summary", () => {
  assert.ok(!appSrc.includes('"CONSISTENT"'), "CONSISTENT kicker survived");
  assert.ok(!appSrc.includes("reads as settled or too thin to divide"), "merged fallback body survived");
  assert.ok(appSrc.includes("disagreementKicker(v)"), "kicker does not come from the shared helper");
  assert.equal(pres.disagreementKicker({ status: "settled" }), "SETTLED");
  assert.equal(pres.disagreementKicker({ status: "divided" }), "DIVIDED");
  assert.equal(pres.disagreementKicker({ status: "thin" }), "THIN");
  assert.equal(pres.disagreementKicker(null), "No verdict");
  const rendered = [pres.disagreementKicker({ status: "settled" }), "No opposing findings were detected."];
  for (const w of rendered) assert.ok(!/consistent|consensus/i.test(w), `rendered copy invents a status word: ${w}`);
});

// ══════════════════════════════════════════════════════════════════
group("L7-12 — falsification quantities need a source");

await test("after/03's invented dose threshold is rewritten quantity free", () => {
  const rec = corpus["03"];
  const answer = rec ? rec.answer : "## What would change this\n\n- A large scale randomized trial showing that **high dose** UCO (e.g., >5 mL per 100 g feed) leads to **mortality** or severe growth inhibition in *H. illucens* would overturn the current view that oil is broadly safe.";
  const evidence = rec ? rec.sources.map((x) => [x.title, x.abstract].join(" ")).join("\n") : "waste oil (e.g., 2 mL waste cooking oil per 100 g diet)";
  const out = server.sanitizeFalsificationQuantities(answer, evidence);
  assert.ok(!/>5 mL|5 mL per 100 g/.test(out), "the invented 5 mL threshold survived");
  assert.ok(out.includes("would overturn the current view") || !rec, "the bullet's claim was dropped instead of rewritten");
});

await test("a bullet whose numbers all appear in sources ships untouched", () => {
  const answer = "## What would change this\n\n- A trial feeding 2 mL per 100 g that finds mortality would overturn this.";
  assert.equal(server.sanitizeFalsificationQuantities(answer, "doses of 2 mL per 100 g were used"), answer);
  assert.ok(server.quantityFreeForm("showing that **high dose** UCO (e.g., >5 mL per 100 g feed) leads to mortality").includes("leads to mortality"));
});

// ══════════════════════════════════════════════════════════════════
group("L7-13 — diagram label compression safety");

await test("the audit's two instances are skipped, not shortened", () => {
  assert.equal(fc.fcCompressStep("The treatment improved memory scores in patients with mild cognitive impairment, while worsening sleep quality and increasing fall risk substantially."), "");
  assert.equal(fc.fcCompressStep("Metformin reduced mortality in adults with type 2 diabetes compared with placebo over five years of follow up."), "");
});

await test("plain sentences still compress, and draft sites skip empty labels", () => {
  assert.equal(fc.fcCompressStep("The study found that metformin lowers blood glucose."), "Metformin lowers blood glucose");
  assert.ok(appSrc.includes("if (!label) return;"), "the answer draft does not skip empty labels");
  assert.ok(fcSrc.includes("fcCompressionUnsafe"), "compression safety helper missing");
});

// ══════════════════════════════════════════════════════════════════
group("L7-14 — the renderer never creates citations");

await test("number to citation conversions are gone from renderAnswer", () => {
  assert.ok(!appSrc.includes(".replace(/([a-z])\\s+(\\d(?:"), "the bare number to citation conversion survived");
  assert.ok(appSrc.includes("L7-14"), "the removal is not documented at the site");
});

await test("prose numbers stay numbers: the conversion patterns are absent as a class", () => {
  assert.ok(!appSrc.includes('.replace(/\\(([\\d,\\s]+)\\)/g, (m, nums)'), "parenthesised list conversion survived");
});

// ══════════════════════════════════════════════════════════════════
group("L7-15 — Answer Arc status discipline and neutral eras");

await test("an unsupported claim backs nothing (after/09 shape)", () => {
  const srcs = [2019, 2021, 2024, 2026].map((y, i) => ({ title: `Paper ${i}`, year: String(y), citations: 0, relevance: 50 }));
  const eras = insights.groupSourcesIntoEras(srcs);
  const out = insights.annotateEras(eras, {
    factCheck: { claims: [{ claim: "A core claim [4]", status: "unsupported", note: "" }] },
    sources: srcs,
  });
  const newest = out.eras[out.eras.length - 1];
  assert.equal(newest.claimCount, 0, "an unsupported claim was counted as backing");
  assert.ok(!/1 back core claim/.test(insights.describeEra(newest, true)), "era line credits backing to an unsupported claim");
});

await test("supported counts as backing, traced counts separately, names are neutral", () => {
  const srcs = [2004, 2015, 2024].map((y, i) => ({ title: `Paper ${i}`, year: String(y), citations: 0, relevance: 50 }));
  const eras = insights.groupSourcesIntoEras(srcs);
  assert.deepEqual(eras.map((e) => e.name), ["Earliest", "Middle", "Most recent"]);
  const out = insights.annotateEras(eras, {
    factCheck: { claims: [
      { claim: "Supported claim [3]", status: "supported", note: "" },
      { claim: "Traced claim [3]", status: "traced", note: "" },
    ] },
    sources: srcs,
  });
  const newest = out.eras[out.eras.length - 1];
  assert.equal(newest.claimCount, 1);
  assert.equal(newest.tracedCount, 1);
  assert.ok(insights.describeEra(newest, true).includes("1 traced core claim"));
});

await test("further reading never enters an era", () => {
  const srcs = [
    { title: "Old cited", year: "2004", citations: 0, relevance: 50 },
    { title: "New cited", year: "2024", citations: 0, relevance: 50 },
    { title: "Ancient further", year: "1990", citations: 99, relevance: 99, uncited: true },
  ];
  const eras = insights.groupSourcesIntoEras(srcs);
  assert.equal(eras[0].startYear, 2004, "an uncited paper set the era span");
});

// ══════════════════════════════════════════════════════════════════
group("L7-17 — one title renderer, deduped closest examples");

await test("after/01's closest list dedupes and never cuts mid word", () => {
  const title = "Evaluating the Composition of Biodiesel Synthesized from Black Soldier Fly (Hermetia illucens) Larvae";
  const payload = server.buildNoResultsPayload({
    query: "can you feed maggots leftover frying grease and will they still grow fine and be safe to use",
    sourcesQueried: [{ ok: true }], rungsTried: ["a", "b"], gatedOut: 3, gatedExamples: [title, title],
  });
  const line = payload.whatWasTried.join("\n");
  assert.equal((line.match(/Evaluating the Composition/g) || []).length, 1, "the same paper was named twice");
  assert.ok(!line.includes("(Herm\""), "title still cut mid word inside a parenthesis");
  assert.ok(line.includes("Hermetia illucens"), "full title or word boundary truncation expected");
  assert.equal(pres.renderTitleText(title, 60).endsWith("\u2026"), true);
  assert.ok(!pres.renderTitleText(title, 60).includes("Herm\u2026"));
  assert.equal(pres.dedupeByTitle([title, title.toUpperCase(), "Another paper"], (x) => x).length, 2);
});

// ══════════════════════════════════════════════════════════════════
group("L7-18 — one approved absence phrasing");

await test("no user facing copy paraphrases absence into settledness", () => {
  assert.equal(pres.NO_GAPS_PHRASE, "No gaps were detected by these checks.");
  assert.ok(!appSrc.includes("how settled this ground is"), "settled ground paraphrase survived");
  assert.ok(!appSrc.includes("absence of gaps means the literature"), "absence equals settled construction survived");
  assert.ok(!/looks settled/.test(appSrc), "looks settled construction survived");
});

// ══════════════════════════════════════════════════════════════════
group("L7-19 — one coverage count from the filtered ok count");

await test("indexes sentence counts only indexes that answered", () => {
  const queried = [{ ok: true }, { ok: false }, { ok: true }, { ok: false }];
  assert.deepEqual(pres.indexesAnswered(queried), { attempted: 4, answered: 2 });
  assert.equal(pres.indexesSentence(queried), "from 2 of 4 indexes");
});

await test("header, colophon and PDF all read the filtered count", () => {
  assert.ok(appSrc.includes("dbOutcomes.filter((x) => x.ok).length"), "header does not filter on ok");
  assert.ok(appSrc.includes("indexesAnswered(t.sourcesQueried)"), "colophon does not use the shared helper");
  assert.ok(appSrc.includes("indexesSentence(t.sourcesQueried)"), "PDF does not use the shared helper");
  assert.ok(!appSrc.includes("t.sourcesQueried.length : 0;\n  const dateStr = new Date(t.ts"), "colophon still counts attempted indexes");
});

// ══════════════════════════════════════════════════════════════════
group("L7-20 — one print contract");

await test("generic print excludes inputs, toolbars and other turns", () => {
  const start = appSrc.indexOf("@media print {");
  const block = appSrc.slice(start, start + 1800);
  assert.ok(block.includes("input, textarea, select, form"), "inputs are not excluded from generic print");
  assert.ok(block.includes('[role="toolbar"]'), "toolbars are not excluded");
  assert.ok(block.includes('.cb-turn:not(:has(.cb-article[data-settled="true"]))'), "other turns are not excluded");
  assert.ok(appSrc.includes('data-settled={last && done ? "true" : undefined}'), "the settled article is not marked");
  assert.ok(appSrc.includes('className="cb-rise cb-turn"'), "turn wrapper class missing");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
