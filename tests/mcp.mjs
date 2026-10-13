/**
 * MCP endpoint tests (2026-10-13).
 *
 * Cerebrum now speaks the Model Context Protocol at /api/mcp and /mcp so
 * assistants can call its search as a tool. These tests pin the protocol
 * surface without any network: the JSON RPC handshake, the tool list,
 * tool results shaped from fake runners, and the error codes the spec
 * requires for bad input. The HTTP entry point is exercised with real
 * Request objects and injected runners.
 *
 * Run with: node tests/mcp.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = await import(join(root, "functions/api/mcp.js"));
const rootMcp = await import(join(root, "functions/mcp.js"));
const { handleRpcMessage, parseJsonRpcText, formatSearchToolResult, formatTrendingToolResult, TOOLS, onRequest } = mcp;

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

const SEARCH_PAYLOAD = {
  answer: "Wood frogs survive freezing by flooding their tissues with glucose, which protects cells as ice forms outside them [1].",
  sources: [
    {
      title: "Freeze tolerance in the wood frog",
      authors: "Storey KB et al.",
      year: 2017,
      doi: "10.1000/example.1",
      url: "https://doi.org/10.1000/example.1",
    },
    {
      title: "Cryoprotectants in amphibians",
      authors: [{ name: "Costanzo JP" }, { name: "Lee RE" }],
      year: "2013",
      url: "https://example.org/cryo",
      uncited: true,
    },
  ],
  _funnel: { gathered: 88, deduped: 77, cited: 1 },
};

const TRENDING_PAYLOAD = {
  edition: "2026-10-13",
  generatedAt: 1791895374820,
  items: [
    { title: "New frog species found", category: "Biology & Medicine", source: "Europe PMC", url: "https://example.org/frog" },
    { title: "Second biology story", category: "Biology & Medicine", source: "Europe PMC", url: "https://example.org/bio2" },
    { title: "Rocket launch window opens", category: "Space", source: "Spaceflight News", url: "https://example.org/rocket" },
  ],
};

const fakeRunners = {
  searchRunner: async () => SEARCH_PAYLOAD,
  trendingRunner: async () => TRENDING_PAYLOAD,
};

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });

// ═══════════════════════════════════════════════════════════════════
group("Handshake and discovery");

await test("initialize returns the pinned handshake shape", async () => {
  const res = await handleRpcMessage(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } }, 7), fakeRunners);
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.id, 7);
  assert.deepEqual(res.result, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "cerebrum", version: "1.0.0" },
  });
});

await test("ping returns an empty result", async () => {
  const res = await handleRpcMessage(rpc("ping", undefined, "abc"), fakeRunners);
  assert.deepEqual(res.result, {});
  assert.equal(res.id, "abc");
});

await test("tools/list contains both tools with input schemas", async () => {
  const res = await handleRpcMessage(rpc("tools/list"), fakeRunners);
  assert.equal(res.result.tools.length, 2);
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  assert.ok(byName.search_literature, "search_literature missing");
  assert.ok(byName.get_trending, "get_trending missing");
  const schema = byName.search_literature.inputSchema;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["query"]);
  assert.equal(schema.properties.query.type, "string");
  assert.equal(byName.get_trending.inputSchema.type, "object");
  for (const t of res.result.tools) assert.ok(t.description && t.description.length > 20, "tool needs a real description");
});

await test("authored tool descriptions contain no dashes", () => {
  for (const t of TOOLS) {
    assert.ok(!/[-—–]/.test(t.description), `dash in description of ${t.name}`);
    assert.ok(!/[-—–]/.test(t.inputSchema.properties.query?.description || ""), "dash in schema description");
  }
  const desc = mcp.mcpServerDescription();
  assert.ok(!/[-—–]/.test(desc.description), "dash in server description");
  assert.ok(!/[-—–]/.test(desc.usage), "dash in usage text");
});

// ═══════════════════════════════════════════════════════════════════
group("tools/call search_literature");

await test("a fake runner returns shaped content with a numbered source list", async () => {
  let seenQuery = "";
  const runners = {
    searchRunner: async (q) => { seenQuery = q; return SEARCH_PAYLOAD; },
    trendingRunner: fakeRunners.trendingRunner,
  };
  const res = await handleRpcMessage(rpc("tools/call", { name: "search_literature", arguments: { query: "how do wood frogs survive freezing" } }, 3), runners);
  assert.equal(seenQuery, "how do wood frogs survive freezing");
  assert.equal(res.result.isError, false);
  assert.equal(res.result.content.length, 1);
  assert.equal(res.result.content[0].type, "text");
  const text = res.result.content[0].text;
  assert.ok(text.startsWith("Wood frogs survive freezing"), "answer text is not first");
  assert.ok(text.includes("1. Freeze tolerance in the wood frog"), "first source missing");
  assert.ok(text.includes("Storey KB et al., 2017"), "first author and year missing");
  assert.ok(text.includes("DOI: 10.1000/example.1"), "DOI missing");
  assert.ok(text.includes("Cited in the answer."), "cited label missing");
  assert.ok(text.includes("2. Cryoprotectants in amphibians"), "second source missing");
  assert.ok(text.includes("Costanzo JP et al., 2013"), "array authors not shaped to first author plus et al.");
  assert.ok(text.includes("https://example.org/cryo"), "plain URL missing when no DOI exists");
  assert.ok(text.includes("Further reading."), "uncited source not labelled as further reading");
  assert.ok(text.includes("gathered 88 records"), "funnel gathered number missing");
  assert.ok(text.includes("cited 1 source"), "funnel cited number missing");
});

await test("coverage line derives cited from source flags when the funnel disagrees", () => {
  const out = formatSearchToolResult({
    answer: "A grounded answer [1].",
    sources: [
      { title: "Cited paper", year: 2024 },
      { title: "Further reading one", year: 2023, uncited: true },
      { title: "Further reading two", year: 2022, uncited: true },
    ],
    _funnel: { gathered: 95, deduped: 90, cited: 12 },
  });
  const text = out.content[0].text;
  assert.ok(text.includes("gathered 95 records"), "gathered count missing");
  assert.ok(text.includes("cited 1 source"), "flag derived cited count missing");
  assert.ok(!text.includes("cited 12"), "whole list count leaked into the coverage line");
});

await test("missing query yields -32602", async () => {
  for (const args of [{}, { query: "   " }, { query: 42 }, undefined]) {
    const params = args === undefined ? { name: "search_literature" } : { name: "search_literature", arguments: args };
    const res = await handleRpcMessage(rpc("tools/call", params), fakeRunners);
    assert.equal(res.error.code, -32602, `expected -32602 for ${JSON.stringify(args)}`);
    assert.equal(res.result, undefined);
  }
});

await test("an unknown tool yields -32602", async () => {
  const res = await handleRpcMessage(rpc("tools/call", { name: "delete_everything", arguments: {} }), fakeRunners);
  assert.equal(res.error.code, -32602);
});

await test("no sources is an honest note with isError false", async () => {
  const runners = { searchRunner: async () => ({ answer: "A short answer with nothing behind it.", sources: [] }) };
  const res = await handleRpcMessage(rpc("tools/call", { name: "search_literature", arguments: { query: "obscure question" } }), runners);
  assert.equal(res.result.isError, false);
  assert.ok(res.result.content[0].text.includes("No sources were returned"), "honest no sources note missing");
  assert.ok(res.result.content[0].text.includes("ungrounded"), "ungrounded warning missing");
});

await test("an empty payload still answers honestly with isError false", async () => {
  const out = formatSearchToolResult({});
  assert.equal(out.isError, false);
  assert.ok(out.content[0].text.includes("Cerebrum found no answer"), "empty payload fallback missing");
  assert.equal(formatSearchToolResult(null).isError, false);
  assert.equal(formatSearchToolResult(undefined).isError, false);
});

await test("a failing runner yields a tool error, not an RPC error", async () => {
  const runners = { searchRunner: async () => { throw new Error("network down"); } };
  const res = await handleRpcMessage(rpc("tools/call", { name: "search_literature", arguments: { query: "anything" } }), runners);
  assert.equal(res.error, undefined, "fetch failure should not become an RPC error");
  assert.equal(res.result.isError, true);
  assert.ok(res.result.content[0].text.includes("could not be reached"), "plain failure message missing");
});

await test("a bare function runner is accepted as the search runner", async () => {
  const res = await handleRpcMessage(rpc("tools/call", { name: "search_literature", arguments: { query: "q" } }), async () => SEARCH_PAYLOAD);
  assert.equal(res.result.isError, false);
  assert.ok(res.result.content[0].text.includes("Freeze tolerance"), "bare runner result not shaped");
});

// ═══════════════════════════════════════════════════════════════════
group("tools/call get_trending");

await test("headlines come back grouped by section with links and the edition", async () => {
  const res = await handleRpcMessage(rpc("tools/call", { name: "get_trending", arguments: {} }), fakeRunners);
  assert.equal(res.result.isError, false);
  const text = res.result.content[0].text;
  assert.ok(text.includes("edition 2026-10-13"), "edition date missing");
  assert.ok(text.includes("Biology & Medicine"), "first section heading missing");
  assert.ok(text.includes("Space"), "second section heading missing");
  assert.ok(text.includes("1. New frog species found"), "headline missing");
  assert.ok(text.includes("https://example.org/frog"), "headline link missing");
  assert.ok(text.indexOf("Biology & Medicine") < text.indexOf("Rocket launch window"), "sections not grouped in order");
});

await test("a failing trending runner yields a tool error", async () => {
  const runners = { trendingRunner: async () => { throw new Error("upstream 502"); } };
  const res = await handleRpcMessage(rpc("tools/call", { name: "get_trending", arguments: {} }), runners);
  assert.equal(res.result.isError, true);
});

await test("an edition can be derived from generatedAt and empty items stay honest", () => {
  const out = formatTrendingToolResult({ generatedAt: Date.UTC(2026, 0, 2), items: [] });
  assert.ok(out.content[0].text.includes("2026-01-02"), "generatedAt date not derived");
  assert.ok(out.content[0].text.includes("No headlines were returned"), "empty edition note missing");
  assert.equal(out.isError, false);
});

// ═══════════════════════════════════════════════════════════════════
group("Protocol errors and notifications");

await test("unknown method yields -32601", async () => {
  const res = await handleRpcMessage(rpc("resources/list"), fakeRunners);
  assert.equal(res.error.code, -32601);
});

await test("a notification yields no result body", async () => {
  assert.equal(await handleRpcMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, fakeRunners), null);
  assert.equal(await handleRpcMessage({ jsonrpc: "2.0", method: "ping" }, fakeRunners), null, "any id free message is a notification");
});

await test("malformed input is handled at every layer", async () => {
  const fromHelper = await handleRpcMessage("{not json at all", fakeRunners);
  assert.equal(fromHelper.error.code, -32700);
  assert.equal(fromHelper.id, null);
  const parsed = parseJsonRpcText("{{{");
  assert.equal(parsed.error.error.code, -32700);
  const invalid = await handleRpcMessage({ nope: true }, fakeRunners);
  assert.equal(invalid.error.code, -32600);
  assert.equal((await handleRpcMessage(null, fakeRunners)).error.code, -32600);
});

await test("a batch mixes responses and notifications correctly", async () => {
  const out = await handleRpcMessage([
    rpc("ping", undefined, 1),
    { jsonrpc: "2.0", method: "notifications/initialized" },
    rpc("tools/list", undefined, 2),
  ], fakeRunners);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.id), [1, 2]);
});

// ═══════════════════════════════════════════════════════════════════
group("HTTP entry point");

await test("the root wrapper re exports the same handler", () => {
  assert.equal(rootMcp.onRequest, onRequest);
});

await test("GET returns a human readable description naming both tools", async () => {
  const res = await onRequest({ request: new Request("https://askcerebrum.org/api/mcp", { method: "GET" }), env: {}, runners: fakeRunners });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "cerebrum");
  assert.equal(body.protocolVersion, "2025-03-26");
  assert.deepEqual(body.tools.map((t) => t.name), ["search_literature", "get_trending"]);
});

await test("POST round trips initialize and tools/call", async () => {
  const post = (payload) => onRequest({
    request: new Request("https://askcerebrum.org/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
    env: {},
    runners: fakeRunners,
  });
  const init = await post(rpc("initialize", {}, 9));
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, "cerebrum");
  const call = await post(rpc("tools/call", { name: "get_trending", arguments: {} }, 10));
  assert.equal(call.status, 200);
  assert.ok((await call.json()).result.content[0].text.includes("Trending in Science"));
});

await test("POST malformed JSON returns -32700 and a notification returns 202 with no body", async () => {
  const bad = await onRequest({
    request: new Request("https://askcerebrum.org/api/mcp", { method: "POST", body: "{oops" }),
    env: {},
    runners: fakeRunners,
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);

  const note = await onRequest({
    request: new Request("https://askcerebrum.org/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }),
    env: {},
    runners: fakeRunners,
  });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), "");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
