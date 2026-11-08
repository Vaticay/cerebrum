/**
 * Small fixes tests (2026-11-08).
 *
 * Two items proven by the burnout replay diagnosis of the same day
 * (~/workspace/cerebrum-burnout-replay-nov08/report.md, sections 4
 * and 5):
 *   1. deriveTopic in src/CerebrumApp.jsx stripped the question
 *      words from "How can I fight graduate school burnout?" and
 *      then stopped at the pronoun, so the watched topic stored was
 *      "I fight graduate school burnout". The scaffolding strip now
 *      also drops a stranded subject pronoun and its pattern, but
 *      only when question scaffolding was stripped first.
 *   2. The stored search record kept only the failed stage names,
 *      so a saved failed answer could never say why writing failed.
 *      buildSearchRecord now persists the synthesis stage skipReason
 *      plus a compact failed legs summary (counts by kind, no model
 *      labels, no raw error text), and the public record page
 *      renders it in plain language beside the health note, only
 *      when the field is present. Older records render as before.
 *
 * deriveTopic is exercised by extracting the real shipped function
 * from the app source, the suite style used for other monolith
 * helpers in this repo. The record page is rendered for real
 * through its route. No network, no DOM.
 *
 * Run with: node tests/small-fixes-nov08.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildSearchRecord } = await import(join(root, "functions/api/search.js"));
const recordRoute = await import(join(root, "functions/record/[id].js"));
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

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
group("deriveTopic: the stranded pronoun is scaffolding too");

const topicStart = appSrc.indexOf("const TOPIC_STOP");
const topicEnd = appSrc.indexOf("function WatchTopicButton");
assert.ok(topicStart >= 0 && topicEnd > topicStart, "the deriveTopic block was not found in CerebrumApp.jsx");
const deriveTopic = new Function(appSrc.slice(topicStart, topicEnd) + "; return deriveTopic;")();

await test("the diagnosed question watches the subject, not the pronoun", () => {
  assert.equal(deriveTopic("How can I fight graduate school burnout?"), "fight graduate school burnout");
});

await test("the close variants all land on the same subject", () => {
  assert.equal(deriveTopic("How do I fight graduate school burnout?"), "fight graduate school burnout");
  assert.equal(deriveTopic("What can I do to fight graduate school burnout?"), "fight graduate school burnout");
  assert.equal(deriveTopic("Can I fight graduate school burnout?"), "fight graduate school burnout");
  assert.equal(deriveTopic("How can we reduce stress in graduate school?"), "reduce stress in graduate school");
  assert.equal(deriveTopic("What should I read to learn about sleep?"), "read to learn about sleep");
  assert.equal(deriveTopic("Why do I get migraines from red wine?"), "get migraines from red wine");
});

await test("normal topics are unchanged", () => {
  assert.equal(deriveTopic("how does the gut microbiome influence brain function?"),
    "gut microbiome influence brain function");
  assert.equal(deriveTopic("gut microbiome brain function"), "gut microbiome brain function");
  assert.equal(deriveTopic("How do bees find their way back to the hive?"),
    "bees find their way back to the hive");
  assert.equal(deriveTopic("What is photosynthesis?"), "photosynthesis");
  assert.equal(deriveTopic("tell me about black soldier fly larvae"), "black soldier fly larvae");
});

await test("a pronoun that was not stranded by question words is kept", () => {
  // The guard: the pronoun strip runs only after question
  // scaffolding was actually stripped, so a phrase that opens with
  // a pronoun on its own is a topic in its own right.
  assert.equal(deriveTopic("I fight graduate school burnout"), "I fight graduate school burnout");
  assert.equal(deriveTopic("we the people in order to form a union"), "we the people in order to form a union");
});

await test("the button stores the derived topic under the watch action", () => {
  const btn = appSrc.slice(topicEnd, topicEnd + 4000);
  assert.ok(btn.includes("const topic = deriveTopic(q);"), "WatchTopicButton no longer derives its topic");
  assert.ok(btn.includes('"watch-topic"'), "the watch action name changed");
  assert.ok(btn.includes("{ topic }"), "the watch action no longer stores the derived topic");
});

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: the synthesis verdict is persisted");

const BASE_INPUT = {
  question: "How can I fight graduate school burnout?",
  askedAt: "2026-11-08T12:00:00.000Z",
  funnel: { gathered: 34, deduped: 34, excludedWeak: 20, excludedNonEnglish: 0, excludedRetracted: 0, cited: 1 },
  sources: [{ title: "Stress and burnout among graduate students", year: 2021 }],
  degraded: true,
};

const FAILED_LEGS = [
  { model: "mistral:mistral-small-latest", ms: 284, error: "HTTP 429 rate limit" },
  { model: "gemini:gemini-example", ms: 596, error: "HTTP 503" },
  { model: "some-workers-model", ms: 3000, error: "timed out at 3,000 ms" },
  { model: "some-parked-model", ms: 0, error: "subrequest budget exhausted" },
  { model: "some-other-model", ms: 42, error: "connection reset by peer" },
];

await test("a failed synthesis stage persists its reason and a compact legs summary", () => {
  const rec = buildSearchRecord({
    ...BASE_INPUT,
    stageHealth: [
      { name: "retrieval", ok: true },
      { name: "synthesis", ok: false, skipReason: "all legs failed", failedLegs: FAILED_LEGS },
    ],
  });
  assert.ok(rec, "record must not be null");
  assert.equal(rec.synthesisSkipReason, "all legs failed");
  assert.deepEqual(rec.synthesisFailedLegs, {
    total: 5, rateLimited: 1, timedOut: 1, serverError: 1, budgetStopped: 1, other: 1,
  });
  assert.deepEqual(rec.failedStages, ["synthesis"], "the failed stage names keep their old shape");
});

await test("the summary carries no model labels and no raw error text", () => {
  const rec = buildSearchRecord({
    ...BASE_INPUT,
    stageHealth: [{ name: "synthesis", ok: false, skipReason: "all legs failed", failedLegs: FAILED_LEGS }],
  });
  const json = JSON.stringify(rec);
  for (const leaked of ["mistral-small-latest", "gemini-example", "some-workers-model", "HTTP 429", "HTTP 503", "connection reset"]) {
    assert.ok(!json.includes(leaked), `the stored record leaked "${leaked}"`);
  }
});

await test("no stage health means no new fields, exactly the old shape", () => {
  const rec = buildSearchRecord({ ...BASE_INPUT });
  assert.ok(!("synthesisSkipReason" in rec), "synthesisSkipReason appeared without a stage record");
  assert.ok(!("synthesisFailedLegs" in rec), "synthesisFailedLegs appeared without a stage record");
});

await test("a written answer records no failure reason", () => {
  const rec = buildSearchRecord({
    ...BASE_INPUT,
    degraded: false,
    stageHealth: [{ name: "synthesis", ok: true, skipReason: null, failedLegs: [] }],
  });
  assert.ok(!("synthesisSkipReason" in rec), "a successful stage left a skip reason behind");
  assert.ok(!("synthesisFailedLegs" in rec), "a successful stage left a legs summary behind");
});

await test("a reason without failed legs persists the reason alone", () => {
  const rec = buildSearchRecord({
    ...BASE_INPUT,
    stageHealth: [{ name: "synthesis", ok: false, skipReason: "gate" }],
  });
  assert.equal(rec.synthesisSkipReason, "gate");
  assert.ok(!("synthesisFailedLegs" in rec), "a legs summary was invented for a stage that recorded none");
});

await test("every main reason family persists verbatim", () => {
  const families = [
    "all legs failed", "budget", "subrequest budget exhausted", "gate",
    "answer had no citations", "no citable evidence",
    "drafts rejected downstream", "no legs recorded", "definition",
  ];
  for (const reason of families) {
    const rec = buildSearchRecord({
      ...BASE_INPUT,
      stageHealth: [{ name: "synthesis", ok: false, skipReason: reason }],
    });
    assert.equal(rec.synthesisSkipReason, reason, `reason "${reason}" did not persist`);
  }
});

// ═══════════════════════════════════════════════════════════════════
group("record page: the failure reason renders in plain language");

const PAGE_RECORD = {
  version: 2,
  id: "r_0123456789abcdef0123456789abcdef",
  url: "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef",
  askedAt: "2026-11-08T12:00:00.000Z",
  question: "How can I fight graduate school burnout?",
  degraded: true,
  failedStages: ["synthesis"],
  databases: [{ source: "pubmed", ok: true, count: 12 }],
  funnel: { gathered: 34, deduped: 34, excludedWeak: 20, excludedNonEnglish: 0, excludedRetracted: 0, cited: 1 },
  synthesisModel: null,
  sources: [
    { n: 1, title: "Stress and burnout among graduate students", authors: "Allen HK et al.", journal: "Intl J Behav Med", year: 2021, doi: "10.1000/burnout1", url: "https://doi.org/10.1000/burnout1", cited: true },
  ],
};
const routeDbWith = (row) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
const pageFor = async (record) => (await recordRoute.onRequestGet({
  request: new Request("https://askcerebrum.org/record/" + record.id),
  env: { DB: routeDbWith({ record: JSON.stringify(record) }) },
  params: { id: record.id },
})).text();

await test("the fleet failure shape names itself and counts its legs by kind", async () => {
  const html = await pageFor({
    ...PAGE_RECORD,
    synthesisSkipReason: "all legs failed",
    synthesisFailedLegs: { total: 5, rateLimited: 1, timedOut: 1, serverError: 1, budgetStopped: 1, other: 1 },
  });
  assert.ok(html.includes("Writing the answer was tried, but every writing service failed or did not answer in time"),
    "the plain fleet failure sentence is missing");
  assert.ok(html.includes("Of the writing services that were tried, 5 failed: 1 was at its usage limit, 1 did not answer in time, 1 answered with a server error, 1 stopped at the working limit, 1 failed for another reason."),
    "the failed legs summary sentence is missing or wrong");
  assert.ok(!html.includes("all legs failed"), "the raw taxonomy string rendered on the public page");
});

await test("the note sits beside the health note, before the question", async () => {
  const html = await pageFor({ ...PAGE_RECORD, synthesisSkipReason: "gate" });
  const healthAt = html.indexOf("This search ran degraded");
  const noteAt = html.indexOf("Writing the answer was not tried");
  const questionAt = html.indexOf("<h2>Question</h2>");
  assert.ok(healthAt >= 0 && noteAt > healthAt && noteAt < questionAt,
    "the synthesis note is not beside the health note");
});

await test("each main reason family renders its own plain sentence and never the raw value", async () => {
  const cases = [
    ["budget", "Writing the answer did not finish, because the search had reached its working limit"],
    ["subrequest budget exhausted", "Writing the answer did not finish, because the search had reached its working limit"],
    ["gate", "Writing the answer was not tried, because this account was not cleared for a written answer on this search"],
    ["answer had no citations", "A written draft was set aside because it did not cite its sources"],
    ["no citable evidence", "No paper cleared the bar to be cited, so there was no evidence a written answer could rest on."],
    ["drafts rejected downstream", "A written draft was produced, but a later check set it aside"],
    ["no legs recorded", "No writing service was recorded as having run for this search"],
    ["definition", "The writing services did not run for this search, because the question was handled as a definition lookup."],
    ["the cited set did not engage the question's subject; the answer was rebuilt over the subject engaging citable papers",
      "The answer was rebuilt, because the papers it first cited did not engage the subject of the question."],
  ];
  for (const [reason, sentence] of cases) {
    const html = await pageFor({ ...PAGE_RECORD, synthesisSkipReason: reason });
    assert.ok(html.includes(sentence), `reason "${reason}" did not render its plain sentence`);
    // The raw value must not print as itself. One word reasons
    // whose word is part of the plain sentence itself (definition)
    // are exempt from the substring check; their pin is the exact
    // sentence above.
    if (!sentence.includes(reason)) {
      assert.ok(!html.includes(reason), `the raw reason "${reason}" rendered on the public page`);
    }
    assert.ok(!/[-—–]/.test(sentence), `the plain sentence for "${reason}" contains a dash character`);
  }
});

await test("an unknown reason gets the generic sentence and never prints raw", async () => {
  const html = await pageFor({ ...PAGE_RECORD, synthesisSkipReason: "some future internal reason" });
  assert.ok(html.includes("Writing the answer did not complete for this search"),
    "the generic sentence is missing for an unknown reason");
  assert.ok(!html.includes("some future internal reason"), "an unknown raw reason rendered");
});

await test("a record without the field renders exactly as before", async () => {
  const html = await pageFor({ ...PAGE_RECORD });
  const noteCount = (html.match(/<p class="note">/g) || []).length;
  assert.equal(noteCount, 1, "an old record gained a note it never had");
  assert.ok(html.includes("This search ran degraded"), "the health note itself changed");
  assert.ok(!html.includes("writing service"), "synthesis wording appeared on a record without the field");
});

await test("the stored fields stay available as data at the json form", async () => {
  const res = await recordRoute.onRequestGet({
    request: new Request("https://askcerebrum.org/record/" + PAGE_RECORD.id + "?format=json"),
    env: { DB: routeDbWith({ record: JSON.stringify({ ...PAGE_RECORD, synthesisSkipReason: "all legs failed" }) }) },
    params: { id: PAGE_RECORD.id },
  });
  const json = await res.text();
  assert.ok(json.includes("synthesisSkipReason"), "the JSON form lost the stored reason");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
