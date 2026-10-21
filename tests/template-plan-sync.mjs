/**
 * Template checklist (templatePlan) server sync tests.
 *
 * Audit H3 / Lane 4 (2026-10-21): the investigation template checklist
 * persisted locally and in the vault, but plaintext server sync stripped
 * templatePlan in both directions — the history replace-all write in
 * functions/api/data.js serialized only { turns, allSources } into
 * turns_json, and the history GET return carried no templatePlan field,
 * so the client load map (h.templatePlan || null) always read null from
 * the server and a signed in non vault user lost the checklist on reload
 * or a second device.
 *
 * The functional block drives the REAL onRequest handler from
 * functions/api/data.js against a real in memory SQLite database, the
 * same pattern as the functional block in tests/inbox-redesign.mjs:
 * session 1 saves an investigation with a templatePlan through the real
 * replace-all write path, and a second session (a second session token
 * for the same account, the second device shape) loads it back through
 * the real history GET and must receive the plan intact.
 *
 * Run with: node tests/template-plan-sync.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// ── Static wiring pins ────────────────────────────────────────────────

const dataSrc = await readFile(join(root, "functions/api/data.js"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

await test("client load map reads templatePlan from the history response", () => {
  assert.ok(appSrc.includes("templatePlan: h.templatePlan || null"), "client load map no longer reads h.templatePlan");
});

await test("client push sends the full history array (templatePlan included) via replace-all", () => {
  assert.ok(appSrc.includes('apiDataPost("history", { action: "replace-all", items: history })'), "client history push missing or field filtered");
});

await test("server write and return both route templatePlan through cleanTemplatePlan", () => {
  assert.ok(dataSrc.includes("templatePlan: cleanTemplatePlan(item?.templatePlan)"), "replace-all write does not store a cleaned templatePlan");
  assert.ok(dataSrc.includes("templatePlan: cleanTemplatePlan(blob.templatePlan)"), "history GET does not return a cleaned templatePlan");
});

// ── cleanTemplatePlan unit behaviour ──────────────────────────────────

const { cleanTemplatePlan } = await import(join(root, "functions/api/data.js"));

const PLAN = {
  templateId: "lit-review",
  templateTitle: "Literature Review",
  topic: "black soldier fly larvae",
  questions: [
    "What is the current state of research on black soldier fly larvae?",
    "What are the main disagreements or controversies in black soldier fly larvae research?",
    "What are the biggest unanswered questions about black soldier fly larvae?",
    "Which recent papers have most influenced the field of black soldier fly larvae?",
  ],
  doneQuestions: ["What is the current state of research on black soldier fly larvae?"],
};

await test("cleanTemplatePlan passes a real plan through intact", () => {
  assert.deepEqual(cleanTemplatePlan(PLAN), PLAN);
});

await test("cleanTemplatePlan returns null for non plans", () => {
  assert.equal(cleanTemplatePlan(null), null);
  assert.equal(cleanTemplatePlan(undefined), null);
  assert.equal(cleanTemplatePlan("lit-review"), null);
  assert.equal(cleanTemplatePlan([]), null);
  assert.equal(cleanTemplatePlan({}), null);
  assert.equal(cleanTemplatePlan({ questions: [] }), null);
  assert.equal(cleanTemplatePlan({ questions: "not-an-array" }), null);
  assert.equal(cleanTemplatePlan({ questions: [42] }), null);
});

await test("cleanTemplatePlan drops the plan when a question is over long, never slices it", () => {
  const bad = { ...PLAN, questions: ["x".repeat(2001)] };
  assert.equal(cleanTemplatePlan(bad), null);
});

await test("cleanTemplatePlan caps the question count", () => {
  const many = { ...PLAN, questions: Array.from({ length: 51 }, (_, i) => `Question ${i}?`), doneQuestions: [] };
  assert.equal(cleanTemplatePlan(many), null);
});

await test("cleanTemplatePlan rebuilds doneQuestions as a deduped subset of questions", () => {
  const out = cleanTemplatePlan({
    ...PLAN,
    doneQuestions: [PLAN.questions[0], PLAN.questions[0], "a question that is not in the plan", 7],
  });
  assert.deepEqual(out.doneQuestions, [PLAN.questions[0]]);
});

await test("cleanTemplatePlan defaults a missing doneQuestions to an empty list", () => {
  const { doneQuestions, ...rest } = PLAN;
  assert.deepEqual(cleanTemplatePlan(rest).doneQuestions, []);
});

// ── Functional: the real handler against a real SQLite database ─────

{
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");
  const { onRequest } = await import(join(root, "functions/api/data.js"));

  const sqlite = new DatabaseSync(":memory:");
  const wrapStmt = (sql) => {
    let vals = [];
    const stmt = {
      bind: (...v) => { vals = v; return stmt; },
      first: async () => { const r = sqlite.prepare(sql).get(...vals); return r === undefined ? null : r; },
      all: async () => ({ results: sqlite.prepare(sql).all(...vals) }),
      run: async () => { const info = sqlite.prepare(sql).run(...vals); return { success: true, meta: { changes: Number(info.changes || 0) } }; },
    };
    return stmt;
  };
  const db = {
    prepare: (sql) => wrapStmt(sql),
    exec: async (sql) => { sqlite.exec(sql); return { results: [] }; },
    batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  const env = { DB: db };

  const TOKENS = {
    sessionOne: "token-session-one",
    sessionTwo: "token-session-two",
    otherUser: "token-other-user",
  };
  const call = async (token, method, path, body) => {
    const headers = { Cookie: "cb_sess=" + token };
    if (method === "POST") { headers["Content-Type"] = "application/json"; headers.Origin = "https://askcerebrum.org"; }
    const req = new Request("https://askcerebrum.org/api/data" + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const res = await onRequest({ request: req, env, waitUntil: () => {} });
    return { status: res.status, json: await res.json() };
  };

  // Seed: users and sessions are the two tables nothing self-creates.
  // user_history is declared in schema.sql and exists in production.
  sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, email_lower TEXT, username TEXT, name TEXT, affiliation TEXT, show_affiliation INTEGER, discoverable INTEGER, plan TEXT, created_at INTEGER)");
  sqlite.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER, expires_at INTEGER)");
  sqlite.exec("CREATE TABLE user_history (id TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, turns_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const now = Date.now();
  for (const [id, email, username, name] of [
    ["usr_a", "alice@example.com", "alice", "Alice"],
    ["usr_b", "bob@example.com", "bob", "Bob"],
  ]) {
    sqlite.prepare("INSERT INTO users (id, email, email_lower, username, name, show_affiliation) VALUES (?, ?, ?, ?, ?, 1)").run(id, email, email, username, name);
  }
  // Two session tokens for usr_a: session one saves, session two (the
  // second device / reload shape) loads. usr_b is a different account.
  for (const [uid, tok] of [["usr_a", TOKENS.sessionOne], ["usr_a", TOKENS.sessionTwo], ["usr_b", TOKENS.otherUser]]) {
    sqlite.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash(tok), uid, now, now + 3600000);
  }

  const TURNS = [{ id: 1, q: PLAN.questions[0], a: "A teaching answer." }];
  const SOURCES = [{ title: "A paper on larvae", url: "https://example.com/paper" }];

  await test("functional: a templatePlan saved in session one loads back intact in session two", async () => {
    const save = await call(TOKENS.sessionOne, "POST", "", {
      resource: "history",
      action: "replace-all",
      items: [
        { title: PLAN.questions[0], ts: now, turns: TURNS, allSources: SOURCES, templatePlan: PLAN },
        { title: "Plain investigation", ts: now, turns: [{ id: 2, q: "an unrelated question", a: "An answer." }], allSources: [] },
      ],
    });
    assert.equal(save.status, 200, `save failed: ${JSON.stringify(save.json)}`);
    assert.equal(save.json.count, 2);

    // The stored blob itself carries the plan (write direction).
    const row = sqlite.prepare("SELECT turns_json FROM user_history WHERE user_id = ? AND title = ?").get("usr_a", PLAN.questions[0]);
    assert.ok(row, "the templated investigation was not stored");
    assert.deepEqual(JSON.parse(row.turns_json).templatePlan, PLAN, "the stored blob lost the templatePlan on write");

    // Second session, same account: the history return carries it back.
    const load = await call(TOKENS.sessionTwo, "GET", "?resource=history");
    assert.equal(load.status, 200, `load failed: ${JSON.stringify(load.json)}`);
    assert.equal(load.json.items.length, 2);
    const templated = load.json.items.find((h) => h.title === PLAN.questions[0]);
    assert.ok(templated, "the templated investigation is missing from the second session history");
    assert.deepEqual(templated.templatePlan, PLAN, "templatePlan did not survive the server round trip");
    assert.deepEqual(templated.turns, TURNS, "turns changed on the round trip");
    assert.deepEqual(templated.allSources, SOURCES, "allSources changed on the round trip");

    // An investigation with no plan still loads, with templatePlan null
    // (the exact value the client load map falls back to).
    const plain = load.json.items.find((h) => h.title === "Plain investigation");
    assert.ok(plain, "the plain investigation is missing from the second session history");
    assert.equal(plain.templatePlan, null);
  });

  await test("functional: another account never sees the checklist", async () => {
    const load = await call(TOKENS.otherUser, "GET", "?resource=history");
    assert.equal(load.status, 200);
    assert.deepEqual(load.json.items, [], "history leaked across accounts");
  });

  await test("functional: a malformed plan syncs as null and the investigation still saves", async () => {
    const save = await call(TOKENS.sessionOne, "POST", "", {
      resource: "history",
      action: "replace-all",
      items: [
        { title: "Broken plan", ts: now, turns: TURNS, allSources: [], templatePlan: { questions: "not-an-array", doneQuestions: [] } },
        { title: "Stray done", ts: now, turns: TURNS, allSources: [], templatePlan: { ...PLAN, doneQuestions: [PLAN.questions[1], "not a plan question"] } },
      ],
    });
    assert.equal(save.status, 200, `save failed: ${JSON.stringify(save.json)}`);
    const load = await call(TOKENS.sessionTwo, "GET", "?resource=history");
    const broken = load.json.items.find((h) => h.title === "Broken plan");
    assert.ok(broken, "an investigation with a malformed plan was dropped instead of saved");
    assert.equal(broken.templatePlan, null);
    const stray = load.json.items.find((h) => h.title === "Stray done");
    assert.ok(stray && stray.templatePlan, "a valid plan was lost alongside a stray done entry");
    assert.deepEqual(stray.templatePlan.doneQuestions, [PLAN.questions[1]], "doneQuestions was not rebuilt as a subset of questions");
    assert.deepEqual(stray.templatePlan.questions, PLAN.questions, "questions changed on the round trip");
  });

  await test("functional: a legacy row stored without templatePlan loads as null", async () => {
    sqlite.prepare("INSERT INTO user_history (id, user_id, title, turns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("hist_legacy", "usr_a", "Legacy investigation", JSON.stringify({ turns: TURNS, allSources: SOURCES }), now, now);
    const load = await call(TOKENS.sessionTwo, "GET", "?resource=history");
    const legacy = load.json.items.find((h) => h.title === "Legacy investigation");
    assert.ok(legacy, "the legacy investigation is missing");
    assert.equal(legacy.templatePlan, null);
    assert.deepEqual(legacy.turns, TURNS);
  });

  await test("functional: signed out requests are still refused", async () => {
    const req = new Request("https://askcerebrum.org/api/data?resource=history", { method: "GET", headers: {} });
    const res = await onRequest({ request: req, env, waitUntil: () => {} });
    assert.equal(res.status, 401);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
