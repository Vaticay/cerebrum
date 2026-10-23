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
  // Pin updated 2026-10-14 (MCP structured output wave): the
  // server identity now also carries the icon and the documentation
  // address, so a directory scanner reads the same identity the
  // listing package submits. Name, version, protocol, and
  // capabilities are unchanged.
  // Pin updated again 2026-10-14 (wave six): the icon is the 512 by
  // 512 mark served from the site root, not the 180 by 180 touch
  // icon, because directory scanners read the live server identity
  // and the touch icon is below the size some of them ask for.
  const res = await handleRpcMessage(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } }, 7), fakeRunners);
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.id, 7);
  assert.deepEqual(res.result, {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: {
      name: "cerebrum",
      version: "1.0.0",
      icon: "https://askcerebrum.org/icon-512.png",
      documentationUrl: "https://askcerebrum.org/features",
    },
  });
});

await test("the server icon URL names a real 512 by 512 asset in public/", async () => {
  // The icon address in the server identity is only honest if the
  // site actually serves that file. public/ is copied verbatim into
  // the build output, so the file's presence and dimensions here are
  // what the deployed site serves at the same path.
  const { readFile } = await import("node:fs/promises");
  const png = await readFile(join(root, "public/icon-512.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "public/icon-512.png is not a PNG");
  assert.equal(png.readUInt32BE(16), 512, "public/icon-512.png width is not 512");
  assert.equal(png.readUInt32BE(20), 512, "public/icon-512.png height is not 512");
  assert.equal(mcp.MCP_ICON_URL, "https://askcerebrum.org/icon-512.png");
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

await test("tools/list carries a title and the full annotation set for both tools", async () => {
  // Directory requirement: Anthropic requires a title and the
  // applicable hints on every tool, and OpenAI's scan imports them
  // from this response. The values are the ones drafted in
  // docs/mcp-listing/claude-listing.json, and they are true of the
  // tools: both only read, neither is destructive, and both reach
  // the open scholarly web rather than a closed data set.
  const res = await handleRpcMessage(rpc("tools/list"), fakeRunners);
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  assert.equal(byName.search_literature.title, "Search the literature");
  assert.equal(byName.get_trending.title, "Today in Science");
  const expected = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
  for (const t of res.result.tools) {
    assert.deepEqual(t.annotations, expected, `annotations wrong on ${t.name}`);
    for (const hint of Object.values(t.annotations)) assert.equal(typeof hint, "boolean", "hints are explicit booleans");
    assert.ok(!/[-—–]/.test(t.title), `dash in title of ${t.name}`);
  }
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

await test("an extractive answer carries a plain quality line", () => {
  const out = formatSearchToolResult({
    answer: "An answer assembled from excerpts [1].",
    sources: [{ title: "Cited paper", year: 2024 }],
    synthesisMode: "extractive",
    degraded: true,
  });
  const text = out.content[0].text;
  assert.ok(text.includes("Note on quality: this answer was assembled from source excerpts"),
    "extractive state not named");
  assert.ok(text.indexOf("Note on quality") < text.indexOf("Sources"), "quality line should sit with the answer, before the source list");
});

await test("a degraded AI answer carries a plain quality line", () => {
  const out = formatSearchToolResult({
    answer: "An AI answer written while a stage was down [1].",
    sources: [{ title: "Cited paper", year: 2024 }],
    synthesisMode: "ai",
    degraded: true,
  });
  assert.ok(out.content[0].text.includes("Note on quality: this answer is degraded"),
    "degraded state not named");
});

await test("a full AI answer carries no quality line", () => {
  const out = formatSearchToolResult({
    answer: "A full AI answer [1].",
    sources: [{ title: "Cited paper", year: 2024 }],
    synthesisMode: "ai",
    degraded: false,
  });
  assert.ok(!out.content[0].text.includes("Note on quality"), "full answer must not be labelled");
  const bare = formatSearchToolResult(SEARCH_PAYLOAD);
  assert.ok(!bare.content[0].text.includes("Note on quality"), "a payload without quality fields stays unlabelled");
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
group("tools/call search_literature: the Search record block");

// The record finishes travelling here: a search result whose payload
// carries a record with a permanent id names the record's page, so
// an assistant can cite the run itself. Counts come from the record
// as stored, never from the answer's source list.
const RECORD_PAYLOAD = {
  ...SEARCH_PAYLOAD,
  _record: {
    id: "r_0123456789abcdef0123456789abcdef",
    url: "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef",
    question: "how do wood frogs survive freezing",
    askedAt: "2026-10-13T14:00:00.000Z",
    sources: [
      { n: 1, title: "Freeze tolerance in the wood frog", cited: true },
      { n: 2, title: "Cryoprotectants in amphibians", cited: false },
      { n: 3, title: "Winter ecology of northern amphibians", cited: true },
    ],
    databases: [
      { source: "europePMC", ok: true, count: 40 },
      { source: "pubmed", ok: true, count: 31 },
      { source: "openAlex", ok: false, count: 0 },
    ],
  },
};

await test("a record with an id appends its permalink, question, time, and counts", () => {
  const text = formatSearchToolResult(RECORD_PAYLOAD).content[0].text;
  assert.ok(text.includes("Search record: https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef"),
    "record permalink missing");
  assert.ok(text.includes("Question: how do wood frogs survive freezing"), "record question missing");
  assert.ok(text.includes("Asked: 2026-10-13T14:00:00.000Z"), "record askedAt missing");
  assert.ok(text.includes("Sources: 3 in the record, 2 cited in the answer."),
    "record source counts must come from the record's own flags, not the answer's two source list");
  assert.ok(text.includes("Databases queried: 3."), "record database count missing");
  assert.ok(text.indexOf("Search record:") > text.indexOf("Sources\n"),
    "the record block belongs after the answer and its sources");
});

await test("a record id without a stored url still derives the permalink", () => {
  const { url, ...recordNoUrl } = RECORD_PAYLOAD._record;
  const text = formatSearchToolResult({ ...SEARCH_PAYLOAD, _record: recordNoUrl }).content[0].text;
  assert.ok(text.includes("Search record: https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef"),
    "the permalink is not derived from the id");
});

await test("a record without an id adds nothing: byte stable with no record at all", () => {
  // A recomputed cache serve's record carries no id because nothing
  // was stored under one. Pointing at a page that does not exist
  // would be worse than saying nothing, so the output must be
  // identical to a payload with no record.
  const idLess = { ...SEARCH_PAYLOAD, _record: { question: "how do wood frogs survive freezing", sources: [] } };
  assert.deepEqual(formatSearchToolResult(idLess), formatSearchToolResult(SEARCH_PAYLOAD));
  assert.ok(!formatSearchToolResult(idLess).content[0].text.includes("Search record:"),
    "an id less record leaked a record block");
});

await test("an unstored record adds no block: the permalink claim was withdrawn at the source", () => {
  // Third rescore fix (2026-10-13): when the record store fails, the
  // search response stamps stored false and withdraws the id and
  // url, so the record that reaches this formatter is the unstored
  // shape below. The block keys off the id, so no permalink can be
  // rebuilt here for a page that was never stored.
  const unstored = {
    ...SEARCH_PAYLOAD,
    _record: {
      stored: false,
      question: "how do wood frogs survive freezing",
      askedAt: "2026-10-13T14:00:00.000Z",
      sources: [{ n: 1, title: "Freeze tolerance in the wood frog", cited: true }],
      databases: [{ source: "europePMC", ok: true, count: 40 }],
    },
  };
  const text = formatSearchToolResult(unstored).content[0].text;
  assert.ok(!text.includes("Search record:"), "an unstored record leaked a record block");
  assert.ok(!text.includes("askcerebrum.org/record/"), "an unstored record leaked a record page address");
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
group("structuredContent: the data twin of each text result");

// A small validator for the subset of JSON Schema the two
// outputSchema declarations use (type as a string or a list,
// properties, required, items, additionalProperties false). It
// exists so the shipped structured content is held to the schema
// the server advertises in tools/list, not just eyeballed.
function schemaProblems(schema, value, path = "$") {
  const problems = [];
  if (!schema || typeof schema !== "object") return problems;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (types.length && !types.includes(typeOf(value))) {
    problems.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
    return problems;
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required || []) {
      if (!(key in value)) problems.push(`${path}: missing required ${key}`);
    }
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      if (key in props) problems.push(...schemaProblems(props[key], v, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: unexpected property ${key}`);
    }
  }
  if (typeOf(value) === "array" && schema.items) {
    value.forEach((v, i) => problems.push(...schemaProblems(schema.items, v, `${path}[${i}]`)));
  }
  return problems;
}

const toolByName = (name) => TOOLS.find((t) => t.name === name);

await test("both tools declare an outputSchema in tools/list", async () => {
  const res = await handleRpcMessage(rpc("tools/list"), fakeRunners);
  for (const t of res.result.tools) {
    assert.ok(t.outputSchema && t.outputSchema.type === "object", `${t.name} declares no outputSchema`);
    assert.ok(Array.isArray(t.outputSchema.required) && t.outputSchema.required.length > 0,
      `${t.name} outputSchema names no required fields`);
  }
});

await test("a search result ships structuredContent that conforms to its declared schema", async () => {
  const res = await handleRpcMessage(rpc("tools/call", { name: "search_literature", arguments: { query: "how do wood frogs survive freezing" } }, 21), fakeRunners);
  const sc = res.result.structuredContent;
  assert.ok(sc, "structuredContent missing from the search result");
  assert.deepEqual(schemaProblems(toolByName("search_literature").outputSchema, sc), []);
  assert.equal(sc.answer, SEARCH_PAYLOAD.answer);
  assert.equal(sc.sourceCount, 2);
  assert.equal(sc.citedCount, 1, "the uncited source must not count as cited in the data twin either");
  assert.deepEqual(sc.coverage, { gathered: 88, cited: 1 });
  assert.deepEqual(sc.sources[0], {
    title: "Freeze tolerance in the wood frog",
    authors: "Storey KB et al.",
    year: 2017,
    doi: "10.1000/example.1",
    url: "https://doi.org/10.1000/example.1",
    cited: true,
  });
  assert.equal(sc.sources[1].cited, false, "further reading must carry cited false as data");
  assert.equal(sc.sources[1].doi, null);
  assert.equal(sc.sources[1].url, "https://example.org/cryo");
  assert.equal(sc.record, null, "a payload without a record ships record null, not an invention");
  assert.equal(sc.recordUrl, null);
});

await test("structuredContent leaves the text result byte stable", () => {
  // The text block is the contract current clients read; adding the
  // data twin must not move a byte of it. The formatter's text for
  // the pinned payload is compared against a fresh format of the
  // same payload with the structured field stripped back off.
  const withStructured = formatSearchToolResult(RECORD_PAYLOAD);
  const { structuredContent, ...textOnly } = withStructured;
  assert.ok(structuredContent, "structuredContent missing");
  assert.equal(textOnly.content[0].text, withStructured.content[0].text);
  assert.ok(textOnly.content[0].text.includes("Search record: https://askcerebrum.org/record/"),
    "the text block changed under the structured addition");
});

await test("a stored record arrives in structuredContent with its counts and address", () => {
  const sc = formatSearchToolResult(RECORD_PAYLOAD).structuredContent;
  assert.equal(sc.recordUrl, "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef");
  assert.deepEqual(sc.record, {
    id: "r_0123456789abcdef0123456789abcdef",
    url: "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef",
    question: "how do wood frogs survive freezing",
    askedAt: "2026-10-13T14:00:00.000Z",
    sourceCount: 3,
    citedCount: 2,
    databaseCount: 3,
  });
  const unstored = formatSearchToolResult({ ...SEARCH_PAYLOAD, _record: { stored: false, sources: [] } }).structuredContent;
  assert.equal(unstored.record, null, "an id less record must not surface in the data twin either");
  assert.equal(unstored.recordUrl, null);
});

await test("quality state ships as data: extractive mode and the degraded flag", () => {
  const sc = formatSearchToolResult({
    answer: "An answer assembled from excerpts [1].",
    sources: [{ title: "Cited paper", year: 2024 }],
    synthesisMode: "extractive",
    degraded: true,
  }).structuredContent;
  assert.equal(sc.synthesisMode, "extractive");
  assert.equal(sc.degraded, true);
  const bare = formatSearchToolResult(SEARCH_PAYLOAD).structuredContent;
  assert.equal(bare.synthesisMode, null, "an unrecorded mode ships null, not a guess");
  assert.equal(bare.degraded, null, "an unrecorded degraded state ships null, not false");
  assert.deepEqual(schemaProblems(toolByName("search_literature").outputSchema, sc), []);
});

await test("a trending result ships structuredContent mirroring its text grouping", async () => {
  const res = await handleRpcMessage(rpc("tools/call", { name: "get_trending", arguments: {} }, 22), fakeRunners);
  const sc = res.result.structuredContent;
  assert.ok(sc, "structuredContent missing from the trending result");
  assert.deepEqual(schemaProblems(toolByName("get_trending").outputSchema, sc), []);
  assert.equal(sc.edition, "2026-10-13");
  assert.equal(sc.itemCount, 3);
  assert.deepEqual(sc.sections.map((s) => s.name), ["Biology & Medicine", "Space"]);
  assert.deepEqual(sc.sections[0].items[0], { title: "New frog species found", source: "Europe PMC", url: "https://example.org/frog" });
  const empty = formatTrendingToolResult({ generatedAt: Date.UTC(2026, 0, 2), items: [] }).structuredContent;
  assert.deepEqual(empty, { edition: "2026-01-02", sections: [], itemCount: 0 });
  assert.deepEqual(schemaProblems(toolByName("get_trending").outputSchema, empty), []);
});

// ═══════════════════════════════════════════════════════════════════
group("Protocol errors and notifications");

await test("unknown method yields -32601", async () => {
  const res = await handleRpcMessage(rpc("resources/list"), fakeRunners);
  assert.equal(res.error.code, -32601);
});

await test("a message missing the jsonrpc member is an Invalid Request", async () => {
  const noMember = await handleRpcMessage({ id: 5, method: "ping" }, fakeRunners);
  assert.equal(noMember.error.code, -32600);
  assert.equal(noMember.id, 5);
  const wrongVersion = await handleRpcMessage({ jsonrpc: "1.0", id: 6, method: "ping" }, fakeRunners);
  assert.equal(wrongVersion.error.code, -32600);
  const inBatch = await handleRpcMessage([
    rpc("ping", undefined, 1),
    { id: 2, method: "ping" },
  ], fakeRunners);
  assert.deepEqual(inBatch[0].result, {});
  assert.equal(inBatch[1].error.code, -32600);
  assert.equal(inBatch[1].id, 2);
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
  assert.equal(body.icon, "https://askcerebrum.org/icon-512.png", "GET description lost the server icon");
  assert.equal(body.documentationUrl, "https://askcerebrum.org/features", "GET description lost the documentation address");
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
  assert.ok((await call.json()).result.content[0].text.includes("Today in Science"));
});

await test("a throwing rate limit store fails bounded, not open: the memory limiter still refuses past the limit", async () => {
  // The durable store stubbed to throw on any access — the shape
  // that used to sail through the endpoint's catch with no limit
  // applied at all. The endpoint must fall back to the per isolate
  // in memory limiter: MCP_RATE_LIMIT requests pass, the next is a
  // 429, and a different client is unaffected (per key bounding,
  // so legitimate low volume traffic is untouched).
  const throwingDb = {};
  Object.defineProperty(throwingDb, "prepare", {
    get() { throw new Error("store unavailable"); },
  });
  const env = { DB: throwingDb };
  const post = (ip) => onRequest({
    request: new Request("https://askcerebrum.org/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(rpc("initialize", {}, 9)),
    }),
    env,
    runners: fakeRunners,
  });
  for (let i = 0; i < mcp.MCP_RATE_LIMIT; i++) {
    const res = await post("203.0.113.77");
    assert.equal(res.status, 200, `request ${i + 1} within the limit was refused`);
  }
  const over = await post("203.0.113.77");
  assert.equal(over.status, 429, "the request past the limit was allowed through with the store down");
  assert.equal((await over.json()).error.code, -32000);
  const other = await post("203.0.113.78");
  assert.equal(other.status, 200, "a different client was caught by the first client's fallback bucket");
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

// ═══════════════════════════════════════════════════════════════════
group("Batch cap, per entry charging, and the body ceiling (2026-10-16)");

await test("a batch at the cap still executes every entry", async () => {
  let calls = 0;
  const runners = {
    searchRunner: async () => { calls++; return SEARCH_PAYLOAD; },
    trendingRunner: fakeRunners.trendingRunner,
  };
  const batch = Array.from({ length: mcp.MCP_MAX_BATCH }, (_, i) =>
    rpc("tools/call", { name: "search_literature", arguments: { query: "q" + i } }, i + 1));
  const out = await handleRpcMessage(batch, runners);
  assert.equal(out.length, mcp.MCP_MAX_BATCH);
  assert.equal(calls, mcp.MCP_MAX_BATCH, "batch execution under the cap must keep working");
});

await test("a batch over the cap is rejected whole and runs nothing", async () => {
  let calls = 0;
  const runners = {
    searchRunner: async () => { calls++; return SEARCH_PAYLOAD; },
    trendingRunner: fakeRunners.trendingRunner,
  };
  const batch = Array.from({ length: mcp.MCP_MAX_BATCH + 1 }, (_, i) =>
    rpc("tools/call", { name: "search_literature", arguments: { query: "q" + i } }, i + 1));
  const out = await handleRpcMessage(batch, runners);
  assert.equal(out.error.code, -32600);
  assert.equal(calls, 0, "an over cap batch dispatched entries");

  const res = await onRequest({
    request: new Request("https://askcerebrum.org/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.201" },
      body: JSON.stringify(batch),
    }),
    env: {},
    runners,
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32600);
  assert.equal(calls, 0, "an over cap batch dispatched entries over HTTP");
});

await test("tool calls in a batch are charged once per entry against the rate limit", async () => {
  let calls = 0;
  const runners = {
    searchRunner: async () => { calls++; return SEARCH_PAYLOAD; },
    trendingRunner: fakeRunners.trendingRunner,
  };
  const post = (payload) => onRequest({
    request: new Request("https://askcerebrum.org/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.202" },
      body: JSON.stringify(payload),
    }),
    env: {},
    runners,
  });
  const batch = Array.from({ length: mcp.MCP_MAX_BATCH }, (_, i) =>
    rpc("tools/call", { name: "search_literature", arguments: { query: "q" + i } }, i + 1));
  // Each batch spends MCP_MAX_BATCH charges of the MCP_RATE_LIMIT
  // budget, so exactly limit / cap batches fit in the window.
  const batchesThatFit = mcp.MCP_RATE_LIMIT / mcp.MCP_MAX_BATCH;
  for (let i = 0; i < batchesThatFit; i++) {
    const res = await post(batch);
    assert.equal(res.status, 200, `batch ${i + 1} within the per entry budget was refused`);
  }
  assert.equal(calls, mcp.MCP_RATE_LIMIT, "tool calls executed does not match the charged budget");
  const over = await post(rpc("tools/call", { name: "search_literature", arguments: { query: "one more" } }, 99));
  assert.equal(over.status, 429, "a tool call past the per entry budget was allowed through");
  assert.equal(calls, mcp.MCP_RATE_LIMIT, "the refused tool call still executed");
});

await test("a body over the ceiling is refused with 413 before dispatch", async () => {
  let calls = 0;
  const runners = {
    searchRunner: async () => { calls++; return SEARCH_PAYLOAD; },
    trendingRunner: fakeRunners.trendingRunner,
  };
  const big = rpc("tools/call", { name: "search_literature", arguments: { query: "x".repeat(mcp.MCP_MAX_BODY_BYTES) } }, 5);
  const res = await onRequest({
    request: new Request("https://askcerebrum.org/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.203" },
      body: JSON.stringify(big),
    }),
    env: {},
    runners,
  });
  assert.equal(res.status, 413);
  assert.equal(calls, 0, "an oversized body still dispatched a tool call");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
