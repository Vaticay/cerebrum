#!/usr/bin/env node
/**
 * Cerebrum comprehensive stress test — search, AI synthesis, and papers.
 *
 * Targets the PRODUCTION API (https://askcerebrum.org/api/search).
 * Sequential, rate-limit-respectful (configurable delay between requests),
 * saves detailed JSON results and prints a pass/fail summary.
 *
 * Usage:
 *   node stress-test.mjs                 # full suite
 *   node stress-test.mjs --quick          # a faster subset (edge cases + 2 full searches)
 *   node stress-test.mjs --delay 10000    # 10s between requests
 *   node stress-test.mjs --out results.json
 *
 * DO NOT run this against production during peak hours without telling Dusty.
 * It performs ~15 real searches; each one costs provider quota.
 */

const BASE = "https://askcerebrum.org";
const ORIGIN = "https://askcerebrum.org"; // passes the trusted-origin gate
const DEFAULT_DELAY_MS = 8000;            // ~7.5 req/min, well under the 20/min IP cap
const REQUEST_TIMEOUT_MS = 150000;        // server can take a while on throttled free models
const RETRY_AFTER_429_MS = 35000;

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const delayMs = Number(args[args.indexOf("--delay") + 1]) || DEFAULT_DELAY_MS;
const outIdx = args.indexOf("--out");
const OUT_PATH = outIdx >= 0 ? args[outIdx + 1]
  : `stress-results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── request ─────────────────────────────────────────────────────────── */

async function postSearch(body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    let res = await fetch(`${BASE}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    // One polite retry on 429, then accept the failure.
    if (res.status === 429) {
      console.log("    ↳ 429 hit — backing off 35s and retrying once…");
      await sleep(RETRY_AFTER_429_MS);
      res = await fetch(`${BASE}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    }
    const elapsedMs = Date.now() - started;
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, elapsedMs, data, ok: res.ok };
  } catch (e) {
    return { status: 0, elapsedMs: Date.now() - started, data: null, ok: false, transportError: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/* ── quality / paper checks (run on every successful full search) ────── */

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“\(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function checkRepeatedSentences(answer) {
  const seen = new Map();
  for (const s of splitSentences(answer)) {
    if (s.length < 40) continue; // skip short fragments / headings
    const k = norm(s);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k.slice(0, 80));
  return dups;
}

function checkDuplicatePapers(sources) {
  const byTitle = new Map();
  const byUrl = new Map();
  for (const p of sources) {
    const t = norm(p.title);
    const u = String(p.url || p.doi || "").toLowerCase().trim();
    if (t.length > 10) byTitle.set(t, (byTitle.get(t) || 0) + 1);
    if (u) byUrl.set(u, (byUrl.get(u) || 0) + 1);
  }
  return {
    dupTitles: [...byTitle.entries()].filter(([, n]) => n > 1).map(([k]) => k.slice(0, 80)),
    dupUrls: [...byUrl.entries()].filter(([, n]) => n > 1).map(([k]) => k.slice(0, 80)),
  };
}

function checkCitationIndices(answer, sources) {
  const idx = [...String(answer || "").matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
  const maxIdx = idx.length ? Math.max(...idx) : 0;
  return { maxCitationIndex: maxIdx, sourceCount: sources.length, dangling: maxIdx > sources.length };
}

function checkPaperFields(sources) {
  const bad = [];
  sources.forEach((p, i) => {
    if (!p.title || !String(p.title).trim()) bad.push(`#${i}: missing title`);
    else if (!p.url && !p.doi) bad.push(`#${i} "${String(p.title).slice(0, 50)}": no url/doi`);
  });
  return bad;
}

/** Run the full battery of AI/paper checks on a 200 response. Returns {passed, failures[], info}. */
function auditResponse(data, elapsedMs) {
  const failures = [];
  const info = {};
  const answer = data.answer || "";
  const sources = Array.isArray(data.sources) ? data.sources : (Array.isArray(data.papers) ? data.papers : []);

  info.synthesisMode = data.synthesisMode || data.synthesis_mode || "unknown";
  info.sourceCount = sources.length;
  info.elapsedSec = +(elapsedMs / 1000).toFixed(1);
  info.sourceLabel = data.source || null;

  if (!answer || answer.length < 100) failures.push(`answer too short/empty (${answer.length} chars)`);
  if (/unable to synthesize/i.test(answer)) failures.push("answer contains 'Unable To Synthesize' fallback");
  if (/degraded/i.test(answer) && info.synthesisMode === "none") failures.push("synthesis failed (mode=none, degraded text)");
  if (info.synthesisMode === "none") failures.push("synthesisMode is 'none' — no AI and no extractive fallback");

  const dups = checkRepeatedSentences(answer);
  if (dups.length) failures.push(`repeated sentences (${dups.length}): ${dups.slice(0, 2).join(" | ")}`);

  const { dupTitles, dupUrls } = checkDuplicatePapers(sources);
  if (dupTitles.length) failures.push(`duplicate paper titles (${dupTitles.length}): ${dupTitles.slice(0, 2).join(" | ")}`);
  if (dupUrls.length) failures.push(`duplicate paper urls (${dupUrls.length}): ${dupUrls.slice(0, 2).join(" | ")}`);

  const cites = checkCitationIndices(answer, sources);
  info.maxCitationIndex = cites.maxCitationIndex;
  if (cites.dangling) failures.push(`citation [${cites.maxCitationIndex}] exceeds source count (${cites.sourceCount})`);

  const badFields = checkPaperFields(sources);
  if (badFields.length) failures.push(`paper field problems: ${badFields.slice(0, 3).join("; ")}`);

  if (sources.length === 0 && info.synthesisMode !== "none") {
    failures.push("zero papers returned for a real science query");
  }
  if (elapsedMs > 90000) failures.push(`slow response (${info.elapsedSec}s > 90s)`);

  return { passed: failures.length === 0, failures, info };
}

/* ── test definitions ────────────────────────────────────────────────── */

const FULL_SEARCHES = [
  { id: "S1-physics", name: "Physics: soil cracking patterns", body: { query: "Why does soil crack into patterns as it dries?", mode: "explain" } },
  { id: "S2-biology", name: "Biology: mitochondria ATP", body: { query: "How do mitochondria produce ATP?", mode: "explain" } },
  { id: "S3-chemistry", name: "Chemistry: Belousov-Zhabotinsky", body: { query: "What causes the oscillating color change in the Belousov-Zhabotinsky reaction?", mode: "explain" } },
  { id: "S4-cs", name: "CS: transformer attention", body: { query: "How do transformer attention mechanisms work in large language models?", mode: "explain" } },
  { id: "S5-medicine", name: "Medicine: statins evidence", body: { query: "What is the evidence that statins prevent heart disease?", mode: "explain" } },
  { id: "S6-verify", name: "Mode verify: coffee dehydration claim", body: { query: "Is it true that drinking coffee dehydrates you?", mode: "verify" } },
  { id: "S7-compare", name: "Mode compare: mRNA vs inactivated vaccines", body: { query: "Compare mRNA vaccines with traditional inactivated vaccines", mode: "compare" } },
  { id: "S8-map", name: "Mode map: CRISPR field", body: { query: "Map the field of CRISPR gene editing research", mode: "map" } },
  { id: "S9-readinglist", name: "Mode readinglist: quantum computing", body: { query: "Give me a reading list on quantum computing", mode: "readinglist" } },
  { id: "S10-doi", name: "DOI query", body: { query: "10.1038/nature12373", mode: "explain" }, audit: false },
];

const EDGE_CASES = [
  {
    id: "E1-empty", name: "Empty query → 400",
    body: { query: "" }, expectStatus: 400, expectError: /no query/i,
  },
  {
    id: "E2-whitespace", name: "Whitespace query → 400",
    body: { query: "   \n  " }, expectStatus: 400, expectError: /no query/i,
  },
  {
    id: "E3-long", name: "2500-char query → 200 (truncated, not rejected)",
    body: { query: "What is quantum entanglement? ".repeat(90) }, expectStatus: 200, audit: false,
  },
  {
    id: "E4-special", name: "Special characters don't break it",
    body: { query: `CRISPR-Cas9: what is <em> & "it" — really? (test #1)`, mode: "explain" }, expectStatus: 200, audit: false,
  },
  {
    id: "E5-nonen", name: "Non-English query (Spanish) → 200",
    body: { query: "¿Por qué el cielo es azul?", mode: "explain" }, expectStatus: 200, audit: false,
  },
  {
    id: "E6-badmode", name: "Invalid mode falls back to explain → 200",
    body: { query: "What is photosynthesis?", mode: "nonsense" }, expectStatus: 200, audit: false,
  },
];

/* ── runner ──────────────────────────────────────────────────────────── */

const results = [];
let passCount = 0, failCount = 0;

async function runTest(t, { audit = true } = {}) {
  const wantAudit = t.audit !== false && audit;
  console.log(`\n[${t.id}] ${t.name}`);
  const r = await postSearch(t.body);
  const entry = { id: t.id, name: t.name, status: r.status, elapsedSec: +(r.elapsedMs / 1000).toFixed(1), passed: false, failures: [], info: {} };

  if (r.transportError) {
    entry.failures.push(`transport error: ${r.transportError}`);
  } else if (t.expectStatus && r.status !== t.expectStatus) {
    entry.failures.push(`expected status ${t.expectStatus}, got ${r.status}`);
  } else if (t.expectError && !(t.expectError.test(JSON.stringify(r.data || {})))) {
    entry.failures.push(`expected error matching ${t.expectError}, got: ${JSON.stringify(r.data).slice(0, 200)}`);
  } else if (r.status === 429) {
    entry.failures.push("rate limited (429) even after polite pacing + one backoff retry");
  } else if (!r.ok) {
    entry.failures.push(`HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  } else if (wantAudit) {
    const a = auditResponse(r.data, r.elapsedMs);
    entry.failures.push(...a.failures);
    entry.info = a.info;
  } else {
    entry.info.note = "status-only check (no quality audit)";
  }

  // Capture a fingerprint of the response for the JSON log (no full text).
  if (r.data && typeof r.data === "object") {
    entry.info.synthesisMode = entry.info.synthesisMode || r.data.synthesisMode || null;
    entry.info.answerChars = typeof r.data.answer === "string" ? r.data.answer.length : null;
    entry.info.sourceCount = Array.isArray(r.data.sources) ? r.data.sources.length
      : Array.isArray(r.data.papers) ? r.data.papers.length : entry.info.sourceCount ?? null;
    if (r.data.error) entry.info.error = String(r.data.error).slice(0, 200);
  }

  entry.passed = entry.failures.length === 0;
  entry.passed ? passCount++ : failCount++;
  console.log(`    → ${entry.passed ? "PASS" : "FAIL"} (${entry.elapsedSec}s, HTTP ${r.status})`);
  for (const f of entry.failures) console.log(`      ✗ ${f}`);
  if (entry.info.synthesisMode) console.log(`      synthesis: ${entry.info.synthesisMode}, sources: ${entry.info.sourceCount}`);
  results.push(entry);
  return entry;
}

async function main() {
  console.log("═".repeat(64));
  console.log("  CEREBRUM STRESS TEST — search · AI synthesis · papers");
  console.log(`  target: ${BASE}/api/search   delay: ${delayMs}ms   timeout: ${REQUEST_TIMEOUT_MS / 1000}s`);
  console.log(`  mode: ${QUICK ? "QUICK (subset)" : "FULL"}`);
  console.log("═".repeat(64));

  const searches = QUICK ? FULL_SEARCHES.slice(0, 2) : FULL_SEARCHES;

  // Phase 1: full searches with quality audits
  let firstAnswer = null;
  for (const t of searches) {
    const entry = await runTest(t);
    // Stash the first successful answer so the follow-up test can build real history.
    if (!firstAnswer && entry.passed && t.id === "S1-physics") {
      // Re-fetch is wasteful; instead the follow-up test below uses a synthetic
      // but realistic prior turn. (See F1.)
    }
    await sleep(delayMs);
  }

  // Phase 2: follow-up with conversation history (uses S1's topic as context)
  const followup = {
    id: "F1-followup",
    name: "Follow-up with history: 'What about in desert climates?'",
    body: {
      query: "What about in desert climates?",
      mode: "explain",
      history: [
        { role: "user", content: "Why does soil crack into patterns as it dries?" },
        { role: "assistant", content: "As soil dries, water evaporates from the surface and capillary forces pull particles together. The resulting tensile stress exceeds the soil's strength, so cracks form — typically in polygonal patterns that relieve stress in all directions, similar to columnar jointing in basalt." },
      ],
    },
  };
  await runTest(followup);
  await sleep(delayMs);

  // Phase 3: edge cases (cheap, status-level)
  const edges = QUICK ? EDGE_CASES.slice(0, 3) : EDGE_CASES;
  for (const t of edges) {
    await runTest(t, { audit: false });
    await sleep(Math.min(delayMs, 4000));
  }

  // Summary
  console.log("\n" + "═".repeat(64));
  console.log(`  RESULTS: ${passCount} passed · ${failCount} failed · ${results.length} total`);
  console.log("═".repeat(64));
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log("\nFailed tests:");
    for (const f of failed) {
      console.log(`  ✗ [${f.id}] ${f.name}`);
      for (const e of f.failures) console.log(`      - ${e}`);
    }
  } else {
    console.log("\nAll tests passed. 🎉");
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    target: `${BASE}/api/search`,
    delayMs, requestTimeoutMs: REQUEST_TIMEOUT_MS, quick: QUICK,
    summary: { passed: passCount, failed: failCount, total: results.length },
    results,
  };
  const fs = await import("node:fs");
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nDetailed results → ${OUT_PATH}`);
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
