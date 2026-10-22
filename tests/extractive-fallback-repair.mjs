/**
 * Extractive fallback repair (2026-10-22) — the three baseline
 * probes from the efd9dc0 diagnosis batch whose answers degraded
 * to the extractive tier:
 *
 *   probe 8 (honey on a cut): the one surviving draft leg
 *     (groq gpt-oss-20b) was discarded for "missing required
 *     **bold** formatting" after the rest of the fleet died on
 *     HTTP 429s and timeouts. A draft that fails only the bold
 *     bar is now repaired deterministically (the first word of
 *     prose sentences gets bold markers; no words change and no
 *     phrase past a sentence's second word is split) instead of
 *     discarded, and ships as an AI answer when it otherwise
 *     passes citation binding. Two earlier repair forms failed
 *     the trust-binding end to end suite: wrapping repeated key
 *     terms wherever they fell split claim phrases ("did not
 *     increase **hair** shedding"), and wrapping whole sentences
 *     broke the sentence boundaries claim removal segments on.
 *   probe 17 (honey myth): a complete uncited draft degraded
 *     with no citation repair attempt: the retry's synthesis
 *     window condition stood it down while over 11 seconds of
 *     request budget remained (the ledger's synthesis spend was
 *     exactly the fired wave legs). The citation retry is now
 *     gated on the request budget for this shape, and it also
 *     fires after the citation strips, for a draft that arrived
 *     cited but whose markers all failed to bind.
 *   probe 13 (wood enzyme test): a winning draft degraded on a
 *     zero support verdict. The degrade rule itself is NOT
 *     changed here; the synthesis stage record now names which
 *     check mode produced the zero (deep, terms, or flags) via
 *     zeroSupportCheckMode, so a later verification can tell a
 *     checker failure from a draft failure. (That probe's own
 *     fact check trace shows the deep stage never fired and the
 *     zero came from the light terms tier.)
 *
 * Run with: node tests/extractive-fallback-repair.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");
const {
  zeroSupportCheckMode, publicStageHealth, onRequest, createSubrequestLedger,
} = await import(join(root, "functions/api/search.js"));

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

// ── probe 13 instrumentation: the check mode behind a zero ──

await test("zeroSupportCheckMode names deep, terms, and flags panels", () => {
  assert.equal(
    zeroSupportCheckMode({ mode: "claims", claims: [{ claim: "a checked claim", status: "unsupported" }] }),
    "deep",
    "a claims panel with countable verdicts is the deep check"
  );
  assert.equal(
    zeroSupportCheckMode({ mode: "terms", claims: [{ claim: "MnP", status: "unsupported" }] }),
    "terms",
    "a terms panel is the zero network terms check"
  );
  assert.equal(
    zeroSupportCheckMode({
      mode: "claims",
      claims: [
        { claim: "an aligned claim", status: "unsupported", kind: "alignment" },
        { claim: "a stripped claim", status: "unsupported", kind: "stripped" },
      ],
    }),
    "flags",
    "a panel whose claims are all mechanical flags is a flags zero"
  );
  assert.equal(zeroSupportCheckMode(null), null);
  assert.equal(zeroSupportCheckMode({ mode: "extractive", claims: [] }), null,
    "a provenance trace never names a zero support mode");
});

await test("the synthesis stage record carries the mode through the public serialization", () => {
  const out = publicStageHealth([
    {
      name: "synthesis", ok: false, ms: 3851,
      skipReason: "the claim check supported none of the checked claims",
      zeroSupportCheckMode: "terms",
      winner: null, winnerMs: null, legs: 8, failedLegs: [],
    },
    { name: "retrieval", ok: true, ms: 4474 },
  ]);
  const synth = out.find((s) => s.name === "synthesis");
  assert.equal(synth.zeroSupportCheckMode, "terms",
    "the public record dropped the check mode behind the zero");
  const plain = publicStageHealth([
    { name: "synthesis", ok: true, ms: 10, winner: "groq:openai/gpt-oss-20b", winnerMs: 9, legs: 3, failedLegs: [] },
  ]);
  assert.ok(!("zeroSupportCheckMode" in plain[0]),
    "a run with no zero support degrade gained the field");
});

await test("the degrade closure captures the mode before rebuilding the panel (source pins)", () => {
  assert.ok(searchSrc.includes("zeroSupportCheckMode(factCheckResult)"),
    "the degrade path never asks which check produced the panel");
  assert.ok(searchSrc.includes("synthEntry.zeroSupportCheckMode = degradeCheckMode"),
    "the synthesis stage record is not amended with the check mode");
  assert.ok(
    searchSrc.indexOf("zeroSupportCheckMode(factCheckResult)") <
      searchSrc.indexOf("const degradeAnswerToExtractiveOrNoEvidence") + 4000 &&
    searchSrc.indexOf("zeroSupportCheckMode(factCheckResult)") >
      searchSrc.indexOf("const degradeAnswerToExtractiveOrNoEvidence"),
    "the mode is not captured inside the degrade closure, before its panel rebuild"
  );
});

// ── probe 8: bold repair wiring ──

await test("the bold bar repairs before it rejects (source pins)", () => {
  assert.ok(searchSrc.includes("repairMissingBoldFormatting"),
    "no deterministic bold repair exists");
  assert.ok(searchSrc.includes("enforceBoldFormatting(cleaned, model)") ||
            searchSrc.includes("enforceBoldFormatting(cleaned, tag)"),
    "the provider adapters do not run drafts through the repair");
  assert.ok(!searchSrc.includes("!hasMinimumFormatting(cleaned, 2)) throw"),
    "an adapter still throws a draft away on the bold bar without repairing it first");
});

// ── probe 17: citation retry gating ──

await test("the citation retry is gated on the request budget, and fires after the strips (source pins)", () => {
  assert.ok(searchSrc.includes("if (!hasCitations && msLeft() > 9000)"),
    "the pre strip citation retry still carries the synthesis window condition that stood probe 17 down");
  assert.ok(searchSrc.includes("POST STRIP CITATION REPAIR"),
    "no post strip citation repair exists for a draft whose markers all failed to bind");
  assert.ok(searchSrc.includes("!citationRetryAttempted && msLeft() > 9000"),
    "the post strip repair is not a single, budget gated attempt");
});

// ── end to end harness (the answer package suite's shape) ──

const E2E_QUERY = "Do the germs in a baby belly change how well the baby grows";
const e2eWords = E2E_QUERY.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
const e2eAbstract = (n) =>
  ("Study " + n + " on " + e2eWords.join(" ") + ". " +
   "This paper examines " + e2eWords.join(", ") + " in detail. " +
   "The findings show clear effects for " + e2eWords.slice(0, 4).join(" and ") + " across the first year of life. ").repeat(2);

const NO_BOLD_CITED =
  "## The short answer\n\n" +
  "Germs in a baby belly change how well the baby grows across the first year of life [1][2]. " +
  "The germs change as feeding changes, and the germs in the belly change how the baby grows across the first year [1].\n\n" +
  "## What the research shows\n\n" +
  "The findings show clear effects for germs and baby grows across the first year, and this paper examines germs, baby, belly and grows in detail [2]. " +
  "Germs change across the first year and the baby grows as the germs change, with clear effects for belly germs in every study [1][2].";

const BAD_CITED =
  "## The short answer\n\n" +
  "**Volcanic ash** drifts over harbours and slows ferry traffic while crews repaint hulls and replace heavy ropes [1]. " +
  "**Ferry crews** scrub decks, coil ropes, and count passengers while ash settles over quiet harbour water [2].\n\n" +
  "## What the research shows\n\n" +
  "Harbour masters close piers when ash drifts low, and ferry crews wait beside moored boats until the harbour bell rings twice [1][2]. " +
  "Bakers, painters, and rope makers watch the harbour timetable shift while ash covers market stalls near the ferry steps [2].";

const GOOD_CITED =
  "## The short answer\n\n" +
  "**Germs** in a baby belly change how well the baby grows across the first year [1][2]. " +
  "The findings show clear effects for germs, baby grows, and belly change in detail [1].\n\n" +
  "## What the research shows\n\n" +
  "This paper examines germs, baby, belly and grows in detail, and the findings show clear effects across the first year of life [2]. " +
  "Study findings on germs and baby belly change show how well the baby grows across the first year [1][2].";

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
function e2eDb() {
  const st = (sql) => {
    const s = {
      bind: () => s,
      first: async () => {
        if (/CASE WHEN search_slots\.expires_at/.test(sql || "")) return { n: 1 };
        return null;
      },
      all: async () => {
        if (/sqlite_master/.test(sql || "")) {
          return { results: [
            { name: "pro_usage", sql: "CREATE TABLE pro_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, ai_answers INTEGER NOT NULL DEFAULT 0, doc_reads INTEGER NOT NULL DEFAULT 0, flowcharts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))" },
            { name: "stripe_events", sql: "CREATE TABLE stripe_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)" },
            { name: "student_verifications", sql: "CREATE TABLE student_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)" },
          ] };
        }
        return { results: [] };
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return s;
  };
  return {
    prepare: (sql) => st(sql),
    batch: async (arr) => (arr || []).map(() => ({ success: true })),
    exec: async () => ({ results: [] }),
  };
}

async function runScenario({ waveDraft, retryDraft }) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  const fetchCalls = [];
  let aiCalls = 0;
  let epmcCalls = 0;
  const draftFor = (joined) => {
    if (joined.includes("carried no citations at all")) return retryDraft;
    return waveDraft;
  };
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    fetchCalls.push({ u, body });
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(draftFor(body));
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      const mk = (n) => ({
        title: "Gut germs and infant growth patterns study " + n,
        doi: "10.1000/rpr" + n,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Infant Studies",
        abstractText: e2eAbstract(n),
      });
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: [mk(epmcCalls * 2 - 1), mk(epmcCalls * 2)] } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  const env = {
    DB: e2eDb(),
    AI: {
      run: async (model, input) => {
        aiCalls++;
        if (model === "@cf/baai/bge-small-en-v1.5") {
          const texts = (input && input.text) || [];
          return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
        }
        const msgs = (input && input.messages) || [];
        const joined = msgs.map((mm) => String(mm.content || "")).join("\n");
        if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
        return { response: draftFor(joined) };
      },
    },
    GROQ_KEY: "rpr-test-groq-key-123456",
    GEMINI_KEY: "rpr-test-gemini-key-123456",
    MISTRAL_KEY: "rpr-test-mistral-key-123456",
    NVIDIA_KEY: "rpr-test-nvidia-key-123456",
    OPENROUTER_KEY: "rpr-test-openrouter-key-123456",
  };
  try {
    const ledger = createSubrequestLedger();
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: E2E_QUERY }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, fetchCalls, aiCalls };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("probe 8 shape: a cited draft failing only the bold bar is repaired and ships as AI", async () => {
  const { data } = await runScenario({ waveDraft: NO_BOLD_CITED, retryDraft: NO_BOLD_CITED });
  assert.equal(data.synthesisMode, "ai",
    "the no bold draft degraded instead of shipping as AI: " + JSON.stringify((data.stageHealth || []).find((s) => s.name === "synthesis")));
  const spans = data.answer.match(/\*\*[^*\n]+\*\*/g) || [];
  assert.ok(spans.length >= 2, "the shipped answer carries fewer than two bold spans: " + spans.length);
  assert.ok(data.answer.includes("change how well the baby grows across the first year of life"),
    "the repaired draft's own text did not ship");
  assert.ok(spans.every((s) => !/\s/.test(s.slice(2, -2))),
    "the bold markers wrap more than a single word: " + JSON.stringify(spans));
});

await test("probe 17 shape: a draft stripped to zero citations gets the repair retry before degrading", async () => {
  const { data, fetchCalls } = await runScenario({ waveDraft: BAD_CITED, retryDraft: GOOD_CITED });
  const retryFired = fetchCalls.some((c) => c.body.includes("carried no citations at all"));
  assert.ok(retryFired, "the citation repair retry never fired for the stripped draft");
  assert.equal(data.synthesisMode, "ai",
    "the repaired draft did not ship as AI: " + JSON.stringify((data.stageHealth || []).find((s) => s.name === "synthesis")));
  assert.ok(data.answer.includes("This paper examines germs, baby, belly and grows in detail"),
    "the retry draft's text did not ship");
  assert.ok(!data.answer.includes("Volcanic ash"),
    "the stripped draft shipped instead of the repaired one");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
