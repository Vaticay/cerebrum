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
const { MAX_PROMPT_CHARS, messagesChars } = await import(join(root, "functions/lib/inputGuard.js"));
import { readFile } from "node:fs/promises";

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
  assert.ok(result.answer.includes("## Summary"), "missing section header");
  assert.ok(result.answer.includes("## Key Findings"), "missing section header");
  assert.ok(result.answer.includes("## Limitations"), "missing section header");
  assert.equal(result.model, "extractive", "fallback not labeled honestly in its model field");
  assert.ok(!result.answer.includes("[Best-effort"), "operator note leaked into the prose");
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
    return { answer: "## Summary\nSynthesized.\n\n## Methodology\nSynthesized.\n\n## Key Findings\nSynthesized.\n\n## Limitations\nSynthesized.", model: "test-model" };
  };
  const result = await document.runSummary({}, paper, { digest, generateFn });
  assert.equal(result.path, "mapreduce");
  assert.equal(result.partial, true);
  assert.deepEqual(result.missingSections, [failAt + 1]);
  assert.ok(!result.answer.includes("could not be read"), "missing-section note leaked into the answer prose");
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
  assert.equal(result.model, "extractive", "fallback not labeled in its model field");
});

await test("happy path still returns the model answer untouched", async () => {
  const paper = makePaper(60);
  const digest = async (env, chunkText, i) => ({ answer: "Digest " + (i + 1) + ". " + "u".repeat(80) });
  const generateFn = async () => ({ answer: "## Summary\nFull AI summary.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fast-model" });
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

// ── runQA prompt fitting (2026-10-13) ───────────────────────────────────
// The audit defect: runQA put the whole document first in one message and
// let generate()'s choke-point clamp slice the message at
// MAX_PROMPT_CHARS, so at accepted document lengths the question (and, in
// a comparison, the second document's tail) fell off the end while the
// answer shipped as a normal result. These pins prove the new contract:
// the control text is reserved in full, the document absorbs the cut from
// its middle, and the loss is reported structurally.
group("runQA prompt fitting — the question can never be clamped away");

// A document of exactly `total` characters whose opening is `head` and
// whose closing is `tail`, padded between with neutral filler.
function makeLongDoc(total, head, tail) {
  const unit = " Ordinary filler sentence about routine laboratory methods and seasonal observations.";
  let body = String(head);
  while (body.length + tail.length + 1 < total) body += unit;
  return body.slice(0, total - tail.length - 1) + " " + tail;
}
// A generateFn that records the messages it was handed and answers well.
function captureGen(seen) {
  return async (env, messages) => {
    seen.messages = messages;
    return { answer: "A complete answer of ample length drawn from the document.", model: "fake-model" };
  };
}

await test("150000 character document: question survives, document absorbs the cut, flag is structural", async () => {
  const head = "HEADFINDING: ATP production occurs in the mitochondria of every sampled cell.";
  const tail = "TAILFINDING: The closing section reports that ATP production doubled after treatment.";
  const doc = makeLongDoc(150000, head, tail);
  assert.equal(doc.length, 150000);
  const seen = {};
  const result = await document.runQA({}, doc, "Where does ATP production occur?", "", { generateFn: captureGen(seen) });
  assert.equal(result.model, "fake-model");
  assert.equal(result.partial, false);
  const total = messagesChars(seen.messages);
  assert.ok(total <= MAX_PROMPT_CHARS, "assembled prompt exceeds the budget: " + total);
  const user = seen.messages[1].content;
  assert.ok(user.endsWith("QUESTION: Where does ATP production occur?"), "the question fell off the end of the prompt");
  assert.ok(user.includes("HEADFINDING"), "the document opening was cut");
  assert.ok(user.includes("TAILFINDING"), "the document closing was cut");
  assert.ok(user.includes("characters from the middle are missing"), "the in-text omission note is missing");
  assert.ok(result.promptTruncation, "no structural promptTruncation on the result");
  assert.equal(result.promptTruncation.documentShortened, true);
  assert.equal(result.promptTruncation.documentChars, 150000);
  assert.ok(result.promptTruncation.omittedChars > 40000, "omittedChars implausibly small: " + result.promptTruncation.omittedChars);
  assert.equal(result.promptTruncation.promptChars, total, "promptChars must name the prompt actually assembled");
});

await test("240000 character comparison: the instruction survives and both documents keep an end", async () => {
  const docA = makeLongDoc(120000, "DOCUMENT A OPENING: The first study reports ATP production in the mitochondria.", "Document A closing section wraps up the first study.");
  const docB = makeLongDoc(120000, "Document B opening section introduces the second study.", "DOCUMENT B CLOSING: The second study reports ATP production in the cytoplasm instead.");
  const combined = docA + "\n\n" + docB;
  const query = "Compare the two documents above: where do they agree and where do they disagree about ATP production?";
  const seen = {};
  const result = await document.runQA({}, combined, query, "", { generateFn: captureGen(seen) });
  const user = seen.messages[1].content;
  assert.ok(messagesChars(seen.messages) <= MAX_PROMPT_CHARS, "assembled prompt exceeds the budget");
  assert.ok(user.endsWith("QUESTION: " + query), "the comparison instruction fell off the end of the prompt");
  assert.ok(user.includes("DOCUMENT A OPENING"), "Document A's opening was cut");
  assert.ok(user.includes("DOCUMENT B CLOSING"), "Document B's closing was cut");
  assert.ok(result.promptTruncation, "no structural promptTruncation on the result");
  assert.equal(result.promptTruncation.documentShortened, true);
  assert.equal(result.promptTruncation.documentChars, combined.length);
});

await test("short document: prompt carries it verbatim and no promptTruncation is reported", async () => {
  const doc = "ATP production occurs in the mitochondria. The trial enrolled 40 quokkas and measured ATP output weekly.";
  const seen = {};
  const result = await document.runQA({}, doc, "Where does ATP production occur?", "", { generateFn: captureGen(seen) });
  assert.ok(seen.messages[1].content.includes(doc), "a short document was altered");
  assert.equal(result.promptTruncation, undefined, "nothing was cut, so nothing may be reported");
});

await test("provider failure on a long document: the extractive fallback still reads the middle the prompt had to drop", async () => {
  const head = "HEADFINDING: This report opens with routine background on cellular respiration.";
  const tail = "TAILFINDING: The report closes with acknowledgements and funding notes.";
  let doc = makeLongDoc(150000, head, tail);
  // Plant the only answer-bearing sentence in the exact middle, inside
  // the span the prompt fitting cut removes.
  const needle = "The zebrafish enzyme kynurenine monooxygenase peaked at 42 units during the trial.";
  const midAt = Math.floor(doc.length / 2);
  doc = doc.slice(0, midAt) + " " + needle + " " + doc.slice(midAt + needle.length + 2);
  assert.equal(doc.length, 150000);
  const result = await document.runQA({}, doc, "How much kynurenine monooxygenase activity was measured in zebrafish?", "", { generateFn: alwaysFail });
  assert.equal(result.model, "extractive");
  assert.ok(result.answer.includes("42 units"), "the extractive fallback missed the middle finding");
  assert.equal(result.promptTruncation, undefined, "a purely extractive answer covers the whole document and must not claim a shortened prompt");
});

await test("every response surface carries promptTruncation, Q&A and summary (source pin)", async () => {
  const src = await readFile(join(root, "functions/api/document.js"), "utf8");
  const hits = src.split("promptTruncation: result.promptTruncation || null").length - 1;
  // Was 3 (Q&A surfaces only) until the 2026-10-13 rescore fix: the pin
  // counted only the Q&A payloads because summaries never disclosed a
  // prompt clamp at all. The corrected contract is both modes on all
  // three surfaces — sync, streamed, and async — so the count is 6.
  assert.equal(hits, 6, "sync, streamed, and async payloads of BOTH modes must surface promptTruncation; found " + hits);
});

// ── shortenDocumentForPrompt units ──────────────────────────────────────
group("shortenDocumentForPrompt — middle cut, explicit loss");

await test("a document that fits is returned untouched", () => {
  const out = document.shortenDocumentForPrompt("short text", 1000);
  assert.equal(out.text, "short text");
  assert.equal(out.omittedChars, 0);
});

await test("the cut fits the allowance, keeps both ends, and counts the loss honestly", () => {
  const doc = makeLongDoc(50000, "OPENING SENTINEL alpha. This report opens with background.", "CLOSING SENTINEL omega. This report closes with acknowledgements.");
  const out = document.shortenDocumentForPrompt(doc, 10000);
  assert.ok(out.text.length <= 10000, "output exceeds the allowance: " + out.text.length);
  assert.ok(out.text.includes("OPENING SENTINEL"), "the opening was lost");
  assert.ok(out.text.includes("CLOSING SENTINEL"), "the closing was lost");
  const m = out.text.match(/About (\d+) characters from the middle are missing/);
  assert.ok(m, "the in-text omission note is missing");
  assert.ok(Math.abs(Number(m[1]) - out.omittedChars) <= 5, "the in-text figure disagrees with the reported omission");
  assert.ok(out.omittedChars > 39000, "omittedChars implausibly small: " + out.omittedChars);
  // Kept text plus omitted text rebuilds the original, apart from the
  // omission note itself (a few hundred characters).
  assert.ok(Math.abs(out.text.length + out.omittedChars - 50000) <= 300, "kept plus omitted does not rebuild the document");
});

// ── prompt fencing: the document is untrusted data ──────────────────────
group("document prompts — the document is fenced as untrusted data");

await test("the Q&A system prompt fences the document as data, never instructions", async () => {
  const seen = {};
  await document.runQA({}, "Some document text about mitochondria and cellular energy production pathways.", "What does it say?", "", { generateFn: captureGen(seen) });
  const sys = seen.messages[0].content;
  assert.match(sys, /purely as data/, "Q&A prompt does not call the document data");
  assert.match(sys, /never something to obey/, "Q&A prompt does not forbid obeying document text");
});

await test("the summary system prompt fences the document as data, never instructions", async () => {
  const seen = {};
  const generateFn = async (env, messages) => {
    seen.messages = messages;
    return { answer: "## Summary\nS.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fake-model" };
  };
  await document.runSummary({}, "A short document about mitochondria and cellular energy production pathways in cells.", { generateFn });
  const sys = seen.messages[0].content;
  assert.match(sys, /never a source of instructions/, "summary prompt does not fence the document");
  assert.match(sys, /never follow it/, "summary prompt does not forbid following document text");
});

await test("the chunk digest prompt fences section text as data (source pin)", async () => {
  const src = await readFile(join(root, "functions/api/document.js"), "utf8");
  const at = src.indexOf("CHUNK_SYSTEM_PROMPT");
  assert.ok(at >= 0, "chunk prompt not found");
  assert.match(src.slice(at, at + 1600), /never instructions to follow/, "chunk prompt does not fence section text");
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
  for (const h of ["## Summary", "## Methodology", "## Key Findings", "## Limitations"]) {
    assert.ok(out.includes(h), `missing ${h}`);
  }
  assert.ok(!out.includes("[Best-effort"), "operator note leaked into the extract");
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
      'data: {"type":"done","mode":"summary","raw":"## Summary\\nHi"}\n\n',
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

// ── evidence trail: quoted passages are located, or flagged ─────────────
// The third rescore defect: the Q&A prompt asked the model to quote, and
// nothing anywhere checked the quotes. These pins prove the trail is
// computed by actually locating each passage in the document text.
group("evidence trail — quotes verified against the document");

await test("locatePassage finds exact, normalized, and missing passages", () => {
  const doc = "The trial  enrolled\n\n200 quokkas in total. Nap duration rose by 12 percent overall.";
  const exact = document.locatePassage(doc, "Nap duration rose by 12 percent overall.");
  assert.equal(exact.match, "exact");
  assert.equal(doc.slice(exact.start, exact.end), "Nap duration rose by 12 percent overall.");
  const norm = document.locatePassage(doc, "The trial enrolled 200 quokkas in total.");
  assert.equal(norm.match, "normalized");
  // Offsets index the ORIGINAL text, original whitespace included.
  assert.equal(doc.slice(norm.start, norm.end), "The trial  enrolled\n\n200 quokkas in total.");
  const missing = document.locatePassage(doc, "The trial enrolled 900 quokkas in total.");
  assert.equal(missing.match, null);
  assert.equal(missing.start, -1);
  assert.equal(missing.end, -1);
});

await test("extractAnswerQuotes pulls straight and curly quoted passages", () => {
  const quotes = document.extractAnswerQuotes('The paper says "mortality fell by 37 percent" and also “nap duration rose sharply”. Tiny "no" is ignored.');
  assert.deepEqual(quotes, ["mortality fell by 37 percent", "nap duration rose sharply"]);
});

await test("an AI answer's real quote verifies with offsets into the document", async () => {
  const doc = "ATP production occurs in the mitochondria through oxidative phosphorylation. The quokka study measured ATP production across 50 specimens.";
  const gen = async () => ({
    answer: 'ATP is made in the mitochondria: "ATP production occurs in the mitochondria through oxidative phosphorylation." That is the site.',
    model: "fake-model",
  });
  const result = await document.runQA({}, doc, "Where does ATP production occur?", "", { generateFn: gen });
  assert.equal(result.evidence.length, 1);
  const ev = result.evidence[0];
  assert.equal(ev.verified, true);
  assert.equal(ev.match, "exact");
  assert.equal(doc.slice(ev.start, ev.end), ev.quote);
});

await test("a quote the model reflowed across whitespace still verifies as normalized", async () => {
  const doc = "The trial enrolled 200 quokkas\nand measured nap duration weekly.";
  const gen = async () => ({
    answer: 'It states "The trial enrolled 200 quokkas and measured nap duration weekly." in the methods.',
    model: "fake-model",
  });
  const result = await document.runQA({}, doc, "How many quokkas?", "", { generateFn: gen });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].verified, true);
  assert.equal(result.evidence[0].match, "normalized");
});

await test("a fabricated quote is flagged unverified, never presented as grounded", async () => {
  const doc = "ATP production occurs in the mitochondria. The trial enrolled 40 quokkas.";
  const gen = async () => ({
    answer: 'The document reports that "mortality fell by 91 percent in the treatment arm" during the trial.',
    model: "fake-model",
  });
  const result = await document.runQA({}, doc, "What happened to mortality?", "", { generateFn: gen });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].verified, false);
  assert.equal(result.evidence[0].match, null);
  assert.equal(result.evidence[0].start, -1);
});

await test("the extractive fallback's passages verify against the document", async () => {
  const doc = "ATP production occurs in the mitochondria through oxidative phosphorylation. The quokka study measured ATP production across 50 specimens. Unrelated filler about weather patterns and cloud formations.";
  const result = await document.runQA({}, doc, "Where does ATP production occur?", "", { generateFn: alwaysFail });
  assert.equal(result.model, "extractive");
  assert.ok(result.evidence.length >= 1, "no evidence entries for the extractive answer");
  assert.ok(result.evidence.every((e) => e.verified), "extractive passages must all verify: " + JSON.stringify(result.evidence));
});

// ── evidence accounting: no quoted passage is silently dropped ──────────
// The fourth panel found the two silent holes in the trail: a quote over
// the 600 char verification bound vanished entirely (the extraction regex
// could not even see it), and every quote past the 12 entry cap vanished
// with it. Both exclusions are now entries — verified: false with a note
// naming the reason — so the trail accounts for every quoted passage.
group("evidence trail — exclusions are accounted, never silent");

await test("a quote over the verification bound is accounted as too-long, not dropped", async () => {
  const longQuote = "The longitudinal cohort followed 412 quokkas across nine field seasons and recorded nap duration, foraging range, and body mass at every capture, finding that " + "seasonal variation in nap duration tracked rainfall more closely than temperature, ".repeat(6) + "a pattern that held in every subpopulation studied.";
  assert.ok(longQuote.length > 600, "fixture quote must exceed the verification bound");
  const doc = "Introductory material about the reserve. " + longQuote + " Closing remarks about future work.";
  const gen = async () => ({
    answer: 'The study reports: "' + longQuote + '" That is the central finding.',
    model: "fake-model",
  });
  const result = await document.runQA({}, doc, "What did the cohort find?", "", { generateFn: gen });
  assert.equal(result.evidence.length, 1, "the over-long quote vanished from the trail");
  const ev = result.evidence[0];
  assert.equal(ev.quote, longQuote);
  assert.equal(ev.verified, false);
  assert.equal(ev.match, null);
  assert.equal(ev.start, -1);
  assert.equal(ev.end, -1);
  assert.equal(ev.note, "too-long");
});

await test("an over-long quote does not corrupt the quotes that follow it", () => {
  const longQuote = "word ".repeat(150).trim();
  const answer = 'First "' + longQuote + '" and then "nap duration rose sharply in spring" as well.';
  const quotes = document.extractAnswerQuotes(answer);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0], longQuote);
  assert.equal(quotes[1], "nap duration rose sharply in spring");
  const doc = "Field notes: nap duration rose sharply in spring across all sites.";
  const trail = document.buildDocumentEvidence(doc, answer);
  assert.equal(trail.length, 2);
  assert.equal(trail[0].note, "too-long");
  assert.equal(trail[1].verified, true);
  assert.equal(trail[1].match, "exact");
});

await test("quotes past the checked cap are accounted as over-cap, not dropped", () => {
  const passages = [];
  const docParts = [];
  for (let i = 1; i <= 14; i++) {
    const p = "Finding number " + i + " states that nap duration changed measurably.";
    passages.push(p);
    docParts.push(p);
  }
  const doc = docParts.join(" ");
  const trail = document.verifyDocumentPassages(doc, passages);
  assert.equal(trail.length, 14, "quotes past the cap vanished from the trail");
  for (let i = 0; i < 12; i++) {
    assert.equal(trail[i].verified, true, "entry " + (i + 1) + " should have been checked and verified");
    assert.equal(trail[i].note, undefined, "a checked entry carries no exclusion note");
  }
  for (let i = 12; i < 14; i++) {
    assert.equal(trail[i].verified, false);
    assert.equal(trail[i].note, "over-cap");
    assert.equal(trail[i].start, -1);
    assert.equal(trail[i].match, null);
  }
});

await test("excluded passages dedupe like checked ones and do not consume checked slots", () => {
  const longQuote = "filler ".repeat(100).trim();
  const passages = [longQuote, longQuote];
  for (let i = 1; i <= 12; i++) passages.push("Checked passage " + i + " with enough length to count.");
  const doc = passages.slice(2).join(" ");
  const trail = document.verifyDocumentPassages(doc, passages);
  assert.equal(trail.length, 13, "the duplicated over-long quote must earn exactly one entry");
  assert.equal(trail[0].note, "too-long");
  assert.ok(trail.slice(1).every((e) => e.verified), "all 12 checked slots must still be used after an exclusion");
});

// ── finish_reason: a cut off answer says so ─────────────────────────────
group("finish_reason — answerTruncated on every path");

await test("a Q&A call ending at its token cap sets answerTruncated", async () => {
  const doc = "ATP production occurs in the mitochondria. The trial enrolled 40 quokkas.";
  const gen = async () => ({ answer: "A long answer that was cut off mid sentence and", model: "fake-model", finishReason: "length" });
  const result = await document.runQA({}, doc, "Where?", "", { generateFn: gen });
  assert.equal(result.answerTruncated, true);
  const genStop = async () => ({ answer: "A complete answer of ample length drawn from the document.", model: "fake-model", finishReason: "stop" });
  const result2 = await document.runQA({}, doc, "Where?", "", { generateFn: genStop });
  assert.equal(result2.answerTruncated, false);
});

await test("summary paths report answerTruncated from the winning call", async () => {
  const short = "A short paper about quokka metabolism. The trial enrolled 200 quokkas and found a 12% increase in nap duration (p < 0.01).";
  const genLen = async () => ({ answer: "## Summary\nCut off mid way through a very long summary that hit the cap", model: "fake-model", finishReason: "length" });
  const single = await document.runSummary({}, short, { generateFn: genLen });
  assert.equal(single.answerTruncated, true);
  const paper = makePaper(60);
  const digest = async (env, chunkText, i) => ({ answer: "Digest " + (i + 1) + ". " + "u".repeat(80) });
  const reduced = await document.runSummary({}, paper, { digest, generateFn: genLen });
  assert.equal(reduced.path, "mapreduce");
  assert.equal(reduced.answerTruncated, true);
  const extracted = await document.runSummary({}, short, { generateFn: alwaysFail });
  assert.equal(extracted.answerTruncated, false);
});

// ── Workers AI finish state: derived from usage, or honestly unknown ────
// The fourth panel: callCF returned finishReason null unconditionally,
// so a Workers AI win cut at its token cap reported answerTruncated
// false — a confident negative the leg never gave. Now usage derives
// the reason, and no usage surfaces the unknown in the stage detail.
group("finish_reason — the Workers AI leg derives or discloses");

await test("generate derives length from Workers AI usage at the sent cap", async () => {
  let sentMaxTokens = null;
  const env = {
    AI: {
      run: async (model, opts) => {
        sentMaxTokens = opts.max_tokens;
        return { response: "A complete sounding answer that in fact ran to the very end of its token allowance.", usage: { prompt_tokens: 120, completion_tokens: opts.max_tokens } };
      },
    },
  };
  const r = await document.generate(env, [{ role: "user", content: "Summarize this." }], 1000, {});
  assert.equal(sentMaxTokens, 1000, "the CF leg must be sent the caller's cap (under the 2400 ceiling)");
  assert.equal(r.finishReason, "length");
  assert.equal(r.finishReasonKnown, true);
});

await test("generate derives stop from Workers AI usage under the cap", async () => {
  const env = {
    AI: {
      run: async () => ({ response: "A short answer that finished well inside its token allowance, complete.", usage: { prompt_tokens: 90, completion_tokens: 25 } }),
    },
  };
  const r = await document.generate(env, [{ role: "user", content: "Summarize this." }], 1000, {});
  assert.equal(r.finishReason, "stop");
  assert.equal(r.finishReasonKnown, true);
});

await test("generate reports the finish state unknown when Workers AI gives no usage", async () => {
  const env = {
    AI: {
      run: async () => ({ response: "An answer of perfectly ordinary length with no usage block attached at all." }),
    },
  };
  const r = await document.generate(env, [{ role: "user", content: "Summarize this." }], 1000, {});
  assert.equal(r.finishReason, null);
  assert.equal(r.finishReasonKnown, false);
});

await test("an unknown finish state surfaces in the Q&A stage detail, not as a confident negative", async () => {
  const doc = "ATP production occurs in the mitochondria. The trial enrolled 40 quokkas.";
  const genUnknown = async () => ({ answer: "A complete answer of ample length drawn from the document.", model: "fake-cf", finishReason: null, finishReasonKnown: false });
  const result = await document.runQA({}, doc, "Where?", "", { generateFn: genUnknown });
  assert.equal(result.answerTruncated, false);
  assert.match(result.stageHealth[0].detail || "", /does not report whether it stopped at its length limit/);
  const genKnown = async () => ({ answer: "A complete answer of ample length drawn from the document.", model: "fake-or", finishReason: "length", finishReasonKnown: true });
  const result2 = await document.runQA({}, doc, "Where?", "", { generateFn: genKnown });
  assert.equal(result2.answerTruncated, true);
  assert.equal(result2.stageHealth[0].detail, undefined, "a leg that reports its finish state needs no unknown disclaimer");
});

await test("an unknown finish state surfaces in the summary and digest stage details", async () => {
  const short = "A short paper about quokka metabolism. The trial enrolled 200 quokkas and found a 12% increase in nap duration (p < 0.01).";
  const genUnknown = async () => ({ answer: "## Summary\nS.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fake-cf", finishReason: null, finishReasonKnown: false });
  const single = await document.runSummary({}, short, { generateFn: genUnknown });
  assert.match(single.stageHealth[0].detail || "", /truncation is unknown/);
  const paper = makePaper(60);
  const digestUnknown = async (env, chunkText, i) => ({ answer: "Digest " + (i + 1) + ". " + "u".repeat(80), finishReason: null, finishReasonKnown: false });
  const reduced = await document.runSummary({}, paper, { digest: digestUnknown, generateFn: genUnknown });
  assert.equal(reduced.path, "mapreduce");
  const digestStage = reduced.stageHealth.find((s) => s.name === "digest");
  assert.match(digestStage.detail || "", /truncation is unknown/);
  const chunks = document.chunkDocument(paper, 6000);
  const agg = await document.summarizeChunks({}, chunks, null, { digest: digestUnknown });
  assert.equal(agg.unknownFinishChunks.length, chunks.length);
  assert.deepEqual(agg.lengthCutChunks, []);
});

// ── offset basis: the handler never trims the submitted text ────────────
// The fourth panel: evidence offsets were measured on handler trimmed
// text while the reader's highlights index the document as submitted,
// so the numbers disagreed whenever a paste carried leading or trailing
// whitespace. The handler now keeps the request body text exact, and
// judges emptiness on a trimmed copy only.
group("evidence trail — offsets index the submitted text");

await test("the handler intake keeps body.documentText untrimmed and trims only for the empty check", async () => {
  const src = await readFile(join(root, "functions/api/document.js"), "utf8");
  assert.ok(!src.includes('body.documentText === "string" ? body.documentText.trim()'), "the handler trims the submitted document text again");
  assert.match(src, /body\.documentText === "string" \? body\.documentText : ""/, "the handler no longer keeps the submitted text exact");
  assert.match(src, /if \(!documentText\.trim\(\)\) \{\s*\n\s*return errRes\("No document text provided\."/, "the empty check no longer covers whitespace only submissions");
});

await test("evidence offsets index a whitespace padded document exactly as submitted", async () => {
  const padded = "\n\n   The trial enrolled 200 quokkas in total and measured nap duration weekly.   \n";
  const gen = async () => ({
    answer: 'It states "The trial enrolled 200 quokkas in total" in the methods.',
    model: "fake-model",
  });
  const result = await document.runQA({}, padded, "How many quokkas?", "", { generateFn: gen });
  assert.equal(result.evidence.length, 1);
  const ev = result.evidence[0];
  assert.equal(ev.verified, true);
  assert.equal(padded.slice(ev.start, ev.end), ev.quote, "offsets must index the padded text, lead whitespace included");
  assert.ok(ev.start > 0, "the offset must count the leading whitespace the old handler trimmed away");
});

// ── summary promptTruncation: the clamp is disclosed ────────────────────
group("runSummary prompt fitting — a clamped summary is disclosed");

await test("a clamped single call reports promptTruncation in the Q&A shape", async () => {
  const short = "A short paper about quokka metabolism. The trial enrolled 200 quokkas and found a 12% increase in nap duration (p < 0.01).";
  const gen = async () => ({
    answer: "## Summary\nS.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.",
    model: "fake-model",
    promptClamp: { truncated: true, originalChars: 120000, promptChars: 100000 },
  });
  const result = await document.runSummary({}, short, { generateFn: gen });
  assert.ok(result.promptTruncation, "no promptTruncation on a clamped summary");
  assert.equal(result.promptTruncation.documentShortened, true);
  assert.equal(result.promptTruncation.omittedChars, 20000);
  assert.equal(result.promptTruncation.documentChars, short.length);
});

await test("an unclamped summary reports no promptTruncation", async () => {
  const short = "A short paper about quokka metabolism. The trial enrolled 200 quokkas and found a 12% increase in nap duration (p < 0.01).";
  const gen = async () => ({ answer: "## Summary\nS.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fake-model" });
  const result = await document.runSummary({}, short, { generateFn: gen });
  assert.equal(result.promptTruncation, undefined, "nothing was cut, so nothing may be reported");
});

// ── stage health: every analysis names how its stages went ─────────────
group("stageHealth — ok, failed, and skipped with reasons");

await test("Q&A stage health: success, failure, and budget skip", async () => {
  const doc = "ATP production occurs in the mitochondria. The trial enrolled 40 quokkas.";
  const okGen = async () => ({ answer: "A complete answer of ample length drawn from the document.", model: "fake-model", skippedLegs: [{ model: "some:free", reason: "rate limit cooldown" }] });
  const ok = await document.runQA({}, doc, "Where?", "", { generateFn: okGen });
  assert.equal(ok.stageHealth.length, 1);
  assert.equal(ok.stageHealth[0].name, "answer");
  assert.equal(ok.stageHealth[0].ok, true);
  assert.deepEqual(ok.stageHealth[0].skippedLegs, [{ model: "some:free", reason: "rate limit cooldown" }]);
  const failed = await document.runQA({}, doc, "Where?", "", { generateFn: alwaysFail });
  assert.equal(failed.stageHealth[0].ok, false);
  const budgetGen = async () => {
    const e = new Error("token budget exhausted");
    e.code = "token_budget_exhausted";
    throw e;
  };
  const denied = await document.runQA({}, doc, "Where?", "", { generateFn: budgetGen });
  assert.equal(denied.stageHealth[0].ok, null);
  assert.equal(denied.stageHealth[0].skipReason, "token budget exhausted");
});

await test("summary stage health: digest and synthesis stages named separately", async () => {
  const short = "A short paper about quokka metabolism. The trial enrolled 200 quokkas and found a 12% increase in nap duration (p < 0.01).";
  const gen = async () => ({ answer: "## Summary\nS.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fake-model" });
  const single = await document.runSummary({}, short, { generateFn: gen });
  assert.deepEqual(single.stageHealth.map((s) => [s.name, s.ok]), [["summary", true]]);
  const paper = makePaper(60);
  const failAt = 1;
  const digest = async (env, chunkText, i) => {
    if (i === failAt) throw new Error("chunk blew up");
    return { answer: "Digest " + (i + 1) + " reports quokka outcomes. " + "w".repeat(80) };
  };
  const mr = await document.runSummary({}, paper, { digest, generateFn: gen });
  assert.deepEqual(mr.stageHealth.map((s) => [s.name, s.ok]), [["digest", false], ["synthesis", true]]);
  assert.ok(mr.stageHealth[0].detail.includes("could not be read"), "digest detail does not name the unread sections");
  const deniedDigest = async () => {
    const e = new Error("token budget exhausted");
    e.code = "token_budget_exhausted";
    throw e;
  };
  const denied = await document.runSummary({}, paper, { digest: deniedDigest, generateFn: gen });
  assert.equal(denied.stageHealth[0].name, "digest");
  assert.equal(denied.stageHealth[0].ok, null);
  assert.equal(denied.stageHealth[0].skipReason, "token budget exhausted");
});

// ── leg parking: the reader's roster learns from failures ──────────────
group("document leg health — classification, parking, and the race");

await test("classifyDocLegFailure reads the providers' own wording", () => {
  assert.equal(document.classifyDocLegFailure(new Error("m: HTTP 429 — {\"error\":{\"message\":\"You have hit the per-day free limit\"}}")), "daily-cap");
  assert.equal(document.classifyDocLegFailure(new Error("m: HTTP 429 — rate limit exceeded")), "rate-limit");
  assert.equal(document.classifyDocLegFailure(new Error("m: timed out")), "timeout");
  assert.equal(document.classifyDocLegFailure(new Error("m: response too short")), "other");
  assert.equal(document.classifyDocLegFailure(new Error("m: no OPENROUTER_KEY configured")), "other");
});

await test("a rate limit parks for a minute, a success clears, timeouts need a streak", () => {
  document.resetDocLegHealth();
  const t = 1000000;
  document.recordDocLegOutcome("leg-a", false, new Error("leg-a: HTTP 429 — slow down"), t);
  const park = document.docLegParkInfo("leg-a", t + 1000);
  assert.ok(park, "rate limited leg was not parked");
  assert.equal(park.parkClass, "rate-limit");
  assert.equal(park.untilMs, t + document.DOC_LEG_PARK_RATE_LIMIT_MS);
  assert.equal(document.docLegParkInfo("leg-a", t + document.DOC_LEG_PARK_RATE_LIMIT_MS + 1), null, "park outlives its window");
  document.recordDocLegOutcome("leg-a", true, null, t + 2000);
  assert.equal(document.docLegParkInfo("leg-a", t + 2000), null, "a success did not clear the park");
  document.recordDocLegOutcome("leg-b", false, new Error("leg-b: timed out"), t);
  assert.equal(document.docLegParkInfo("leg-b", t), null, "one timeout parked the leg");
  document.recordDocLegOutcome("leg-b", false, new Error("leg-b: timed out"), t + 1);
  assert.ok(document.docLegParkInfo("leg-b", t + 2), "two timeouts in a row did not park the leg");
  document.recordDocLegOutcome("leg-c", false, new Error("leg-c: response too short"), t);
  assert.equal(document.docLegParkInfo("leg-c", t), null, "a content failure parked the leg");
  document.resetDocLegHealth();
});

await test("generate skips a parked leg and names the skip", async () => {
  document.resetDocLegHealth();
  const realFetch = globalThis.fetch;
  const env = { OPENROUTER_KEY: "test-key" };
  const longAnswer = "A complete answer of ample length drawn from the document text itself.";
  globalThis.fetch = async (url, opts) => {
    const model = JSON.parse(opts.body).model;
    if (model === "park-me:free") {
      return { ok: false, status: 429, text: async () => "rate limit exceeded" };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: longAnswer }, finish_reason: "stop" }] }) };
  };
  try {
    // First call: park-me fires, 429s, and is parked by the outcome
    // recorder; the small-model retry carries the call.
    const first = await document.generate(env, [{ role: "user", content: "q" }], 100, { providers: ["park-me:free"] });
    assert.equal(first.model, "meta-llama/llama-3.2-3b-instruct:free");
    assert.deepEqual(first.skippedLegs, []);
    assert.ok(document.docLegParkInfo("park-me:free"), "the 429 did not park the leg");
    // Second call: the parked leg is not fired at all, and the skip is
    // named on the result.
    const second = await document.generate(env, [{ role: "user", content: "q" }], 100, { providers: ["park-me:free"] });
    assert.equal(second.model, "meta-llama/llama-3.2-3b-instruct:free");
    assert.deepEqual(second.skippedLegs, [{ model: "park-me:free", reason: "rate limit cooldown" }]);
    assert.equal(second.finishReason, "stop");
  } finally {
    globalThis.fetch = realFetch;
    document.resetDocLegHealth();
  }
});

await test("a streamed call carries its finish_reason out of generate", async () => {
  document.resetDocLegHealth();
  const realFetch = globalThis.fetch;
  const env = { OPENROUTER_KEY: "test-key" };
  const enc = new TextEncoder();
  const sse = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"A streamed answer that keeps going well past forty characters "}}]}\n\n'));
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"and then stops mid thought"},"finish_reason":"length"}]}\n\n'));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  try {
    const tokens = [];
    const r = await document.generate(env, [{ role: "user", content: "q" }], 100, { providers: ["stream-me:free"], onToken: (t) => tokens.push(t) });
    assert.equal(r.finishReason, "length");
    assert.ok(tokens.join("").includes("mid thought"), "streamed tokens were not forwarded");
  } finally {
    globalThis.fetch = realFetch;
    document.resetDocLegHealth();
  }
});

// ── prompt formatting bars ──────────────────────────────────────────────
group("document prompts — species italics, abbreviations, teaching voice, exact quotes");

await test("the Q&A prompt instructs the formatting bars and exact quotes", async () => {
  const seen = {};
  await document.runQA({}, "Some document text about mitochondria and cellular energy production pathways.", "What does it say?", "", { generateFn: captureGen(seen) });
  const sys = seen.messages[0].content;
  assert.match(sys, /quote it exactly, word for word/, "Q&A prompt does not demand exact quotes");
  assert.match(sys, /italicize species names/, "Q&A prompt does not instruct species italics");
  assert.match(sys, /abbreviation in parentheses/, "Q&A prompt does not instruct abbreviation expansion");
  assert.match(sys, /teach as you answer/, "Q&A prompt does not instruct the teaching voice");
});

await test("the summary prompt instructs the formatting bars", async () => {
  const seen = {};
  const generateFn = async (env, messages) => {
    seen.messages = messages;
    return { answer: "## Summary\nS.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.", model: "fake-model" };
  };
  await document.runSummary({}, "A short document about mitochondria and cellular energy production pathways in cells.", { generateFn });
  const sys = seen.messages[0].content;
  assert.match(sys, /italicize species names/, "summary prompt does not instruct species italics");
  assert.match(sys, /abbreviation in parentheses/, "summary prompt does not instruct abbreviation expansion");
  assert.match(sys, /teach as you summarize/, "summary prompt does not instruct the teaching voice");
});

// ── done ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
