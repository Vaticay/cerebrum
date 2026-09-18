/**
 * Document Mode v2 rewrite regressions (2026-09-17).
 *
 * The backend was rewritten for speed (small fast chunks, 10-way
 * parallelism, sliding-timeout streaming) and a hard never-fail guarantee:
 * runSummary/runQA cannot throw — every provider failure degrades to a
 * deterministic extractive fallback built from the document's own text.
 *
 * These tests cover the rewrite's load-bearing behaviors with injected
 * fakes (no network):
 *   - chunking correctness: paragraph boundaries, no lost content
 *   - partial chunk failure still yields an honest summary
 *   - progress events fire in order (1..N, constant total)
 *   - the no-dead-end guarantee: all providers failing still returns a
 *     best-effort result, never throws to the user
 *   - resumability: priorSections reuses digests, only missing chunks
 *     are re-digested
 *   - the SSE protocol additions (start event, phase on progress)
 *
 * Run with: node tests/document-rewrite.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const document = await import(join(root, "functions/api/document.js"));
const docReader = await import(join(root, "src/docReader.js"));

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
function group(name) {
  console.log(`\n${name}`);
}

// A realistic-ish paper: N paragraphs with findings, methods, numbers.
function makePaper(paragraphs = 30, paraLen = 320) {
  const topics = [
    "mitochondrial ATP production in murine hepatocytes",
    "CRISPR off-target rates in primary T cells",
    "soil microbiome diversity under drought stress",
    "graphene oxide filtration of microplastics",
  ];
  const paras = [];
  for (let i = 0; i < paragraphs; i++) {
    const t = topics[i % topics.length];
    paras.push(
      `Paragraph ${i + 1} examines ${t}. The study recruited a sample of ${120 + i * 7} participants and measured outcomes over ${6 + (i % 5)} weeks. ` +
        `Results showed a ${12 + (i % 20)}% improvement (p < 0.0${1 + (i % 8)}) compared with the control arm. ` +
        `However, the authors note that longer follow-up is needed before these findings can be generalized. ` +
        "Additional filler text to reach the target paragraph length for chunking tests. ".repeat(4)
    );
  }
  return paras.join("\n\n").slice(0, paragraphs * paraLen);
}

// ── chunking correctness ────────────────────────────────────────────────
group("chunkDocument — paragraph boundaries, no lost content");

await test("splits on paragraph boundaries, never mid-paragraph", () => {
  const p1 = "a".repeat(400);
  const p2 = "b".repeat(400);
  const p3 = "c".repeat(400);
  const text = [p1, p2, p3].join("\n\n");
  const chunks = document.chunkDocument(text, 850);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length <= 850), "chunk exceeds limit");
  assert.ok(chunks[0].includes(p1) && chunks[0].includes(p2), "paragraphs split mid-thought");
  assert.ok(chunks[1].includes(p3), "third paragraph lost");
  assert.equal(chunks.join("\n\n"), text);
});

await test("no content is lost on a realistic paper", () => {
  const paper = makePaper(30);
  const chunks = document.chunkDocument(paper, document.MAP_CHUNK_CHARS);
  assert.ok(chunks.length > 1, "expected multiple chunks");
  assert.ok(chunks.every((c) => c.length <= document.MAP_CHUNK_CHARS), "chunk exceeds limit");
  // Every paragraph of the original appears verbatim in exactly one chunk
  // (the chunker trims paragraph edges, so compare trimmed).
  const paras = paper.split("\n\n").map((p) => p.trim()).filter(Boolean);
  for (const p of paras) {
    const hits = chunks.filter((c) => c.includes(p)).length;
    assert.equal(hits, 1, `paragraph lost or duplicated: ${p.slice(0, 40)}…`);
  }
  // Order preserved: concatenation in chunk order rebuilds the document,
  // up to paragraph-edge whitespace, which the chunker intentionally trims.
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  assert.equal(norm(chunks.join("\n\n")), norm(paper));
});

await test("hard-splits a single giant paragraph", () => {
  const wall = "x".repeat(2500);
  const chunks = document.chunkDocument(wall, 1000);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 1000));
  assert.equal(chunks.join(""), wall);
});

await test("empty input yields no chunks", () => {
  assert.deepEqual(document.chunkDocument("", 1000), []);
  assert.deepEqual(document.chunkDocument("  \n\n ", 1000), []);
});

// ── summarizeChunks: progress order + partial failure ───────────────────
group("summarizeChunks — ordered progress, partial failure, resume");

await test("progress events fire in order 1..N with a constant total", async () => {
  const paper = makePaper(60);
  const chunks = document.chunkDocument(paper, document.MAP_CHUNK_CHARS);
  assert.ok(chunks.length >= 3, `need several chunks, got ${chunks.length}`);
  const seen = [];
  const digest = async (env, chunkText, i, n) => ({ answer: "Digest " + (i + 1) + " of " + n + ". " + "x".repeat(60) });
  const { sections, failed } = await document.summarizeChunks({}, chunks, (done, total) => seen.push([done, total]), { digest });
  assert.deepEqual(failed, []);
  assert.equal(sections.length, chunks.length);
  assert.ok(sections.every((s, i) => s.startsWith("Digest " + (i + 1))), "digests misaligned");
  assert.equal(seen.length, chunks.length);
  seen.forEach(([done, total], k) => {
    assert.equal(done, k + 1, `progress out of order at tick ${k}`);
    assert.equal(total, chunks.length, "total changed mid-stream");
  });
});

await test("one failed chunk leaves a null + failed index; the rest survive", async () => {
  const paper = makePaper(60);
  const chunks = document.chunkDocument(paper, document.MAP_CHUNK_CHARS);
  assert.ok(chunks.length >= 3, `need several chunks, got ${chunks.length}`);
  const failAt = 1;
  const digest = async (env, chunkText, i) => {
    if (i === failAt) throw new Error("deepseek: timed out");
    return { answer: "Good digest " + (i + 1) + ". " + "y".repeat(60) };
  };
  const seen = [];
  const { sections, failed } = await document.summarizeChunks({}, chunks, (d, t) => seen.push([d, t]), { digest });
  assert.deepEqual(failed, [failAt + 1], "failed index wrong");
  assert.equal(sections[failAt], null, "failed chunk should be null, not a placeholder string");
  sections.forEach((s, i) => {
    if (i !== failAt) assert.ok(s && s.startsWith("Good digest " + (i + 1)), `chunk ${i} lost`);
  });
  // Progress still completes 1..N even with a failure in the middle.
  assert.equal(seen.length, chunks.length);
  assert.equal(seen[seen.length - 1][0], chunks.length);
});

await test("short/garbage digests count as failed, not as content", async () => {
  const chunks = ["para one " + "a".repeat(100), "para two " + "b".repeat(100)];
  const digest = async () => ({ answer: "too short" });
  const { sections, failed } = await document.summarizeChunks({}, chunks, null, { digest });
  assert.deepEqual(failed, [1, 2]);
  assert.deepEqual(sections, [null, null]);
});

await test("priorSections resumes: seeded chunks are not re-digested", async () => {
  const paper = makePaper(60);
  const chunks = document.chunkDocument(paper, document.MAP_CHUNK_CHARS);
  assert.ok(chunks.length >= 3, `need several chunks, got ${chunks.length}`);
  let calls = 0;
  const digest = async (env, chunkText, i) => {
    calls++;
    return { answer: "Fresh digest " + (i + 1) + ". " + "z".repeat(60) };
  };
  const prior = chunks.map((_, i) => (i === 1 ? null : "Seeded digest " + (i + 1) + ". " + "s".repeat(60)));
  const seen = [];
  const { sections, failed } = await document.summarizeChunks({}, chunks, (d, t) => seen.push([d, t]), { digest, priorSections: prior });
  assert.equal(calls, 1, `expected exactly 1 digest call, got ${calls}`);
  assert.deepEqual(failed, []);
  assert.ok(sections[0].startsWith("Seeded digest 1"), "seeded digest lost");
  assert.ok(sections[1].startsWith("Fresh digest 2"), "missing chunk not re-digested");
  assert.equal(seen[seen.length - 1][0], chunks.length, "progress did not complete");
});

await test("misaligned priorSections is ignored, not merged", async () => {
  const chunks = ["aaa " + "a".repeat(100), "bbb " + "b".repeat(100), "ccc " + "c".repeat(100)];
  let calls = 0;
  const digest = async (env, chunkText, i) => {
    calls++;
    return { answer: "Digest " + (i + 1) + ". " + "q".repeat(60) };
  };
  const { sections } = await document.summarizeChunks({}, chunks, null, { digest, priorSections: ["only-one"] });
  assert.equal(calls, 3, "misaligned priors must trigger a full digest");
  assert.ok(sections.every((s, i) => s.startsWith("Digest " + (i + 1))));
});

// ── runSummary: the no-dead-end guarantee ───────────────────────────────
group("runSummary — never throws; degrades honestly");

const alwaysFail = async () => {
  throw new Error("All providers failed: a: timed out | b: HTTP 429");
};

await test("all providers failing on a long doc still returns a best-effort summary", async () => {
  const paper = "The quokka-driven quantum flux capacitor trial found mortality fell by 37% (p < 0.001).\n\n" + makePaper(30);
  assert.ok(paper.length > document.MAP_REDUCE_THRESHOLD, "test doc must take the map/reduce path");
  const result = await document.runSummary({}, paper, { generateFn: alwaysFail, digest: alwaysFail });
  assert.equal(result.path, "extractive");
  assert.equal(result.model, "extractive");
  assert.equal(result.partial, true);
  assert.ok(result.answer.includes("quokka"), "extractive summary lost document content");
  assert.ok(result.answer.includes("37%"), "extractive summary lost the key number");
  assert.ok(result.answer.includes("## Executive Summary"), "missing section header");
  assert.ok(result.answer.includes("## Key Findings"), "missing section header");
  assert.ok(result.answer.includes("## Limitations"), "missing section header");
  assert.ok(result.answer.includes("Best-effort"), "fallback not labeled honestly");
});

await test("all providers failing on a short doc still returns a best-effort summary", async () => {
  const doc = "A short paper about quokka metabolism. The trial enrolled 200 quokkas and found a 12% increase in nap duration (p < 0.01).";
  const result = await document.runSummary({}, doc, { generateFn: alwaysFail });
  assert.equal(result.path, "extractive");
  assert.equal(result.partial, true);
  assert.ok(result.answer.includes("quokka"), "document content lost");
  assert.ok(result.answer.includes("12%"), "number lost");
});

await test("one failed chunk + working synthesis = honest partial summary", async () => {
  const paper = makePaper(60);
  assert.ok(paper.length > document.MAP_REDUCE_THRESHOLD, "test doc must take the map/reduce path");
  const failAt = 1;
  const digest = async (env, chunkText, i) => {
    if (i === failAt) throw new Error("chunk blew up");
    return { answer: "Digest " + (i + 1) + " reports quokka outcomes. " + "w".repeat(80) };
  };
  const generateFn = async (env, messages) => {
    const userMsg = messages.find((m) => m.role === "user").content;
    assert.ok(userMsg.includes("[This section could not be read.]"), "synthesis not told about the unread section");
    return { answer: "## Executive Summary\nSynthesized.\n\n## Methodology\nSynthesized.\n\n## Key Findings\nSynthesized.\n\n## Limitations\nSynthesized.", model: "test-model" };
  };
  const result = await document.runSummary({}, paper, { digest, generateFn });
  assert.equal(result.path, "mapreduce");
  assert.equal(result.partial, true);
  assert.deepEqual(result.missingSections, [failAt + 1]);
  assert.ok(result.answer.includes("could not be read"), "missing-section note absent from the answer");
  assert.ok(result.sections[failAt] === null, "sections should carry null for resume");
  assert.ok(result.sections[0] && result.sections[0].length > 0, "good digest missing from resume payload");
});

await test("synthesis failing with good digests extracts from the digests", async () => {
  const paper = makePaper(60);
  const digest = async (env, chunkText, i) => ({ answer: "Digest " + (i + 1) + " found a 22% quokka improvement. " + "v".repeat(80) });
  const result = await document.runSummary({}, paper, { digest, generateFn: alwaysFail });
  assert.equal(result.path, "extractive");
  assert.equal(result.partial, true);
  assert.ok(result.answer.includes("22%"), "digest content lost in fallback");
  assert.ok(result.answer.includes("Best-effort"), "fallback not labeled");
});

await test("happy path still returns the model answer untouched", async () => {
  const paper = makePaper(60);
  const digest = async (env, chunkText, i) => ({ answer: "Digest " + (i + 1) + ". " + "u".repeat(80) });
  const generateFn = async () => ({ answer: "## Executive Summary\nFull AI summary.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fast-model" });
  const result = await document.runSummary({}, paper, { digest, generateFn });
  assert.equal(result.path, "mapreduce");
  assert.equal(result.partial, false);
  assert.equal(result.model, "fast-model");
  assert.deepEqual(result.missingSections, []);
  assert.ok(result.answer.includes("Full AI summary"));
});

// ── runQA: never throws ─────────────────────────────────────────────────
group("runQA — never throws; degrades honestly");

await test("provider failure returns extractive passages, never throws", async () => {
  const doc = "ATP production occurs in the mitochondria through oxidative phosphorylation. The quokka study measured ATP production across 50 specimens. Unrelated filler about weather patterns and cloud formations.";
  const result = await document.runQA({}, doc, "Where does ATP production occur?", "", { generateFn: alwaysFail });
  assert.equal(result.model, "extractive");
  assert.equal(result.partial, true);
  assert.ok(result.answer.includes("mitochondria"), "relevant passage missing");
  assert.ok(!result.answer.includes("weather patterns"), "irrelevant passage included");
});

await test("mid-stream provider failure hands off gracefully after streamed tokens", async () => {
  const doc = "ATP production occurs in the mitochondria. The trial enrolled 40 quokkas.";
  const seen = [];
  const flaky = async (env, messages, maxTokens, opts) => {
    opts.onToken("Partial AI text… ");
    throw new Error("provider died mid-stream");
  };
  const result = await document.runQA({}, doc, "Where does ATP production occur?", "", { onToken: (t) => seen.push(t), generateFn: flaky });
  assert.equal(result.partial, true);
  assert.ok(result.answer.startsWith("Partial AI text… "), "streamed prefix lost");
  assert.ok(result.answer.includes("cut short"), "handoff line missing");
  assert.ok(result.answer.includes("mitochondria"), "extractive continuation missing");
  assert.equal(seen.join(""), result.answer, "done answer must equal exactly what was streamed");
});

await test("a question the document cannot answer says so honestly", async () => {
  const doc = "This paper is entirely about quokka nap schedules and eucalyptus consumption rates across seasons.";
  const result = await document.runQA({}, doc, "What is the capital of Assyria?", "", { generateFn: alwaysFail });
  assert.equal(result.partial, true);
  assert.ok(result.answer.includes("does not appear to address"), "no honest no-answer line");
});

// ── extractive fallback units ───────────────────────────────────────────
group("extractiveSummary / extractiveQA — pure, honest, document-grounded");

await test("extractiveSummary carries numbers and names the honest limits", () => {
  const doc = [
    "We investigated quokka-driven quantum flux capacitors for mortality reduction.",
    "The randomized trial enrolled 1,240 participants across three centers.",
    "Mortality fell by 37% in the treatment arm (p < 0.001, 95% CI 29–44%).",
    "The device was well tolerated, with mild nausea in 4% of recipients.",
  ].join(" ");
  const out = document.extractiveSummary(doc);
  assert.ok(out.includes("37%"), "key number dropped");
  assert.ok(out.includes("1,240"), "sample size dropped");
  for (const h of ["## Executive Summary", "## Methodology", "## Key Findings", "## Limitations"]) {
    assert.ok(out.includes(h), `missing ${h}`);
  }
  assert.ok(out.includes("Best-effort"), "not labeled as best-effort");
});

await test("extractiveSummary never invents limitations", () => {
  const doc = "Quokkas are marsupials. They eat leaves. They sleep often. ".repeat(20);
  const out = document.extractiveSummary(doc);
  const limits = out.split("## Limitations")[1];
  assert.ok(/does not state/i.test(limits), "limitations section invents content: " + limits.slice(0, 120));
});

await test("sentence splitter does not cut at genus abbreviations", () => {
  const doc = "We previously demonstrated effects in An. stephensi populations. The compound reduced prevalence significantly. Control groups showed no change.";
  const out = document.extractiveQA(doc, "What reduced prevalence in An. stephensi?", "");
  // The full sentence must survive intact — the historic defect was a
  // dangling fragment ending on the bare abbreviation ("…in An.").
  assert.ok(out.includes("in An. stephensi populations."), "sentence was split at the abbreviation");
  assert.ok(!/\bAn\.\s*$|\bAn\.\s*\n/.test(out.replace("An. stephensi", "")), "dangling abbreviation fragment leaked");
});

// ── docReader protocol additions ────────────────────────────────────────
group("docReader — start event seeds progress; phase is forwarded");

function sseResponse(chunks) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
const realFetch = globalThis.fetch;

await test("start event seeds onProgress(0, total, phase)", async () => {
  globalThis.fetch = async () =>
    sseResponse([
      'data: {"type":"start","mode":"summary","chunks":7,"phase":"map"}\n\n',
      'data: {"type":"progress","phase":"map","done":3,"total":7}\n\n',
      'data: {"type":"done","mode":"summary","raw":"## Executive Summary\\nHi"}\n\n',
    ]);
  try {
    const progress = [];
    const done = await docReader.streamDocumentApi(
      { documentText: "doc", stream: true },
      { onProgress: (d, t, phase) => progress.push([d, t, phase]) }
    );
    assert.deepEqual(progress[0], [0, 7, "map"], "start did not seed progress");
    assert.deepEqual(progress[1], [3, 7, "map"], "phase not forwarded on progress");
    assert.equal(done.mode, "summary");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("reduce-phase progress reaches the client", async () => {
  globalThis.fetch = async () =>
    sseResponse([
      'data: {"type":"start","mode":"summary","chunks":0,"phase":"single"}\n\n',
      'data: {"type":"progress","phase":"reduce","done":0,"total":1}\n\n',
      'data: {"type":"progress","phase":"reduce","done":1,"total":1}\n\n',
      'data: {"type":"done","mode":"summary","raw":"done"}\n\n',
    ]);
  try {
    const progress = [];
    await docReader.streamDocumentApi(
      { documentText: "doc", stream: true },
      { onProgress: (d, t, phase) => progress.push([d, t, phase]) }
    );
    assert.deepEqual(progress, [[0, 1, "reduce"], [1, 1, "reduce"]]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("heartbeats and unknown event types are ignored, not fatal", async () => {
  globalThis.fetch = async () =>
    sseResponse([
      ": keep-alive\n\n",
      'data: {"type":"mystery","foo":1}\n\n',
      'data: {"type":"done","mode":"qa","answer":"ok"}\n\n',
    ]);
  try {
    const done = await docReader.streamDocumentApi({ documentText: "doc", query: "q", stream: true });
    assert.equal(done.answer, "ok");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── Document Mode lead media (media contract wiring, 2026-09-17) ──────────
// The summary response always carries a top-level `media` key built from
// firstDocumentHeading/attachDocumentMedia: honest nulls mean "resolved:
// nothing", never "not attempted". These helpers are pure — no network.

await test("firstDocumentHeading picks the first heading-like line", () => {
  assert.equal(document.firstDocumentHeading("# Effects of sleep on memory\n\nBody text."), "Effects of sleep on memory");
  assert.equal(document.firstDocumentHeading("\n\n  Brief exposure to urban green space restores attention\n\nMore."), "Brief exposure to urban green space restores attention");
});

await test("firstDocumentHeading skips bare numbers and boilerplate-ish lines", () => {
  assert.equal(document.firstDocumentHeading("28\n\nA real title of decent length here\n\nBody."), "A real title of decent length here");
  assert.equal(document.firstDocumentHeading(""), "");
  assert.equal(document.firstDocumentHeading("x".repeat(200)), ""); // too long to be a heading
});

await test("attachDocumentMedia shapes image and video candidates", () => {
  const img = document.attachDocumentMedia({ url: "https://u/w.png", credit: "A", creditUrl: "https://c", license: "CC", source: "commons" });
  assert.equal(img.media.image.url, "https://u/w.png");
  assert.equal(img.media.image.verified, true);
  assert.equal(img.media.video, null);
  assert.ok(typeof img.media.resolvedAt === "number");

  const vid = document.attachDocumentMedia({ url: "https://u/v.mp4", type: "video", poster: "https://u/p.jpg", source: "nasa" });
  assert.equal(vid.media.video.url, "https://u/v.mp4");
  assert.equal(vid.media.video.poster, "https://u/p.jpg");
  assert.equal(vid.media.image, null);
});

await test("attachDocumentMedia never omits the key: null candidate -> honest nulls", () => {
  const m = document.attachDocumentMedia(null);
  assert.equal(m.media.image, null);
  assert.equal(m.media.video, null);
  assert.ok(typeof m.media.resolvedAt === "number");
});

// ── done ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
