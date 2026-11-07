/**
 * Record wording cleanup tests (2026-11-07).
 *
 * The cold demo fix (2026-11-06) screened the record's diagnostic
 * prose through plain language maps, and its fix report flagged
 * two adjacent observations it deliberately left behind:
 *   1. The Model section printed the raw synthesis label verbatim
 *      (a live record carried "gemini:gemini-3.5-flash-lite").
 *   2. The per source outcome list printed "stopped on the
 *      retrieval budget", internal machinery vocabulary.
 * This suite pins both fixes on every surface that prints them:
 * the public record page (rendered for real through the route),
 * the coverage note sentence, and the client renderers (pinned
 * at source, the suite style used across this repo).
 *
 * No network, no DOM. Run with: node tests/record-wording-nov07.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildCoverageNote } = await import(join(root, "functions/api/search.js"));
const recordRoute = await import(join(root, "functions/record/[id].js"));
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const recordRouteSrc = readFileSync(join(root, "functions/record/[id].js"), "utf8");
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");

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

/* A record carrying both defects at once: the live cold demo
   record's own model label, a budget stopped source, and the
   other three outcome states beside it. */
const WORDING_RECORD = {
  version: 2,
  id: "r_0123456789abcdef0123456789abcdef",
  url: "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef",
  askedAt: "2026-11-06T20:17:25.000Z",
  question: "why do we dream",
  degraded: false,
  failedStages: [],
  databases: [
    { source: "europePMC", ok: true, count: 12 },
    { source: "semanticScholar", ok: false, count: 0, attempts: 2 },
    { source: "plos", ok: false, count: 0, budgetStopped: true },
    { source: "CORE", ok: false, count: 0, notSearched: 3 },
  ],
  funnel: { gathered: 47, deduped: 43, excludedWeak: 18, excludedNonEnglish: 0, excludedRetracted: 0, cited: 3 },
  synthesisModel: "gemini:gemini-3.5-flash-lite",
  sources: [
    { n: 1, title: "The content and structure of dreams", authors: "Leckie L", journal: "Sleep", year: 2024, doi: "10.1000/dream1", url: "https://doi.org/10.1000/dream1", cited: true },
  ],
};
const routeDbWith = (row) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
const routeCall = (id, env, suffix = "") => recordRoute.onRequestGet({
  request: new Request("https://askcerebrum.org/record/" + id + suffix),
  env,
  params: { id },
});
const pageFor = async (record) => (await routeCall(record.id, { DB: routeDbWith({ record: JSON.stringify(record) }) })).text();

group("record page: the Model section never prints the raw label");

await test("a Gemini label renders the family sentence, never the raw string", async () => {
  const html = await pageFor(WORDING_RECORD);
  assert.ok(html.includes("Written by a Gemini model."), "the family sentence is missing");
  assert.ok(!html.includes("gemini:gemini-3.5-flash-lite"), "the raw label rendered on the public page");
  assert.ok(!html.includes("gemini-3.5-flash-lite"), "the model slug rendered on the public page");
});

await test("every label shape maps to its proven family or the generic sentence", async () => {
  const cases = [
    ["groq:openai/gpt-oss-120b", "Written by a GPT OSS model."],
    ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Written by a Llama model."],
    ["google/gemma-4-26b-a4b-it:free", "Written by a Gemma model."],
    ["mistral:mistral-small-latest", "Written by a Mistral model."],
    ["nvidia:meta/llama-3.3-70b-instruct", "Written by a Llama model."],
    ["some-vendor:some-model-9", "Written by an AI model."],
  ];
  for (const [label, sentence] of cases) {
    const html = await pageFor({ ...WORDING_RECORD, synthesisModel: label });
    assert.ok(html.includes(sentence), `label ${label} did not render "${sentence}"`);
    assert.ok(!html.includes(label), `the raw label ${label} rendered on the public page`);
  }
});

await test("a null model keeps the no synthesis sentence", async () => {
  const html = await pageFor({ ...WORDING_RECORD, synthesisModel: null });
  assert.ok(html.includes("No AI synthesis model ran for this answer."), "the no synthesis sentence changed");
});

await test("the verbatim record stays available as data at ?format=json", async () => {
  const res = await routeCall(WORDING_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(WORDING_RECORD) }) }, "?format=json");
  const json = await res.text();
  assert.ok(json.includes("gemini:gemini-3.5-flash-lite"), "the JSON form no longer carries the stored label");
});

group("record page: the per source outcomes print plain words");

await test("the budget stop renders in the budget section's own vocabulary", async () => {
  const html = await pageFor(WORDING_RECORD);
  assert.ok(html.includes("plos: stopped when the search reached its working limit"), "the plain budget stop wording is missing");
  assert.ok(!html.includes("stopped on the retrieval budget"), "the internal phrase rendered on the public page");
  assert.ok(!html.includes("retrieval budget"), "the machinery term rendered anywhere on the public page");
});

await test("the other three outcome states print unchanged", async () => {
  const html = await pageFor(WORDING_RECORD);
  assert.ok(html.includes("europePMC: 12 papers returned"), "the returned state changed");
  assert.ok(html.includes("semanticScholar: did not respond"), "the did not respond state changed");
  assert.ok(html.includes("CORE: not searched"), "the not searched state changed");
});

group("coverage note: the grouped sentence is plain too");

await test("buildCoverageNote names the budget stop in plain words", () => {
  const note = buildCoverageNote([
    { source: "europePMC", ok: true, count: 5 },
    { source: "CORE", ok: false, count: 0, budgetStopped: true },
    { source: "pmcFullText", ok: false, count: 0, notSearched: 2 },
  ]);
  assert.ok(note.includes("1 of 3 databases stopped when the search reached its working limit (CORE)"), "coverage note budget group wrong: " + note);
  assert.ok(!note.includes("retrieval budget"), "the internal phrase is in the coverage note");
  assert.ok(note.includes("1 of 3 databases not searched because the budget ran out (pmcFullText)"), "coverage note not searched group wrong: " + note);
});

group("client surfaces: the same screening, pinned at source");

await test("the client carries the model helper with the same family vocabulary", () => {
  assert.ok(appSrc.includes("function recordModelPlain(label)"), "the client model helper is missing");
  for (const pair of ['["gemini", "Gemini"]', '["llama", "Llama"]', '["gpt-oss", "GPT OSS"]', '["gemma", "Gemma"]']) {
    assert.ok(appSrc.includes(pair), "the client family vocabulary is missing " + pair);
  }
  assert.ok(appSrc.includes('"Written by an AI model."'), "the client generic sentence is missing");
});

await test("the Markdown export and the record panel route the model through the helper", () => {
  assert.ok(appSrc.includes("record.synthesisModel ? recordModelPlain(record.synthesisModel) : \"No AI synthesis model ran for this answer.\""),
    "the Markdown Model section does not use the helper");
  assert.ok(appSrc.includes("record.synthesisModel ? recordModelPlain(record.synthesisModel) : \"Drafted from sources\""),
    "the panel Model row does not use the helper");
  const md = appSrc.slice(appSrc.indexOf("function searchRecordMarkdown"), appSrc.indexOf("function SearchRecordPanel"));
  assert.ok(!md.includes("String(record.synthesisModel)"), "the Markdown still stringifies the raw label above the JSON block");
  // The JSON block at the export's end is data by design and keeps
  // the stored record verbatim; only the prose above it screens.
  assert.ok(md.includes("JSON.stringify(record, null, 2)"), "the export's JSON block is missing");
});

await test("no client renderer prints the internal outcome phrase or the machinery label", () => {
  const diag = appSrc.slice(appSrc.indexOf("function AnswerDiagnostics"), appSrc.indexOf("function AnswerDiagnostics") + 14000);
  assert.ok(diag.includes("stopped when the search reached its working limit: ${missingBudgetStopped.join(\", \")}"),
    "the diagnostics Databases row does not use the plain budget stop wording");
  assert.ok(!diag.includes("stopped on the retrieval budget"), "the diagnostics still print the internal phrase");
  assert.ok(appSrc.includes('databaseOutcomeLabel(x) === "stopped at the limit"'), "the diagnostics budget group does not match the plain label");
  assert.ok(appSrc.includes('return "stopped at the limit"'), "the panel short label is not the plain form");
  assert.ok(!appSrc.includes('"budget stopped"'), "the machinery label survives as a string in the client");
});

await test("the server sources carry no user facing copy of the old strings", () => {
  assert.ok(!recordRouteSrc.includes('"stopped on the retrieval budget"'), "the record page still carries the internal phrase as copy");
  assert.ok(!searchSrc.includes('["budget-stopped", "stopped on the retrieval budget"]'), "the coverage note still carries the internal phrase as copy");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
