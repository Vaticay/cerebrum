/**
 * Search fix wave 4 proofs (2026-11-05, collision aware
 * string fix).
 *
 * Spec: the collision diagnosis (~/workspace/cerebrum
 * -collision-diagnosis-nov05/report.md) and the build brief
 * (~/workspace/cerebrum-collision-fix-brief-nov05.md). Wave 3
 * shipped two string fixes that regressed FEV2 between them:
 * Lane A kept the bare bridged term in the plain strings,
 * and Lane B composed PubMed a short central string from the
 * rung's central terms. On the fever question both carried
 * the bare word "bug": PubMed's "temperature bug" probed at
 * count 346 with 11 entomology papers in its top 12, and all
 * 8 papers the live serve cited sit inside that top 12. The
 * diagnosis named the class: a rung word whose hand bridge
 * is a sense shift (bug the illness against bug the insect,
 * the dominant retrieval sense), where the question's other
 * central concept (temperature) is native vocabulary in the
 * wrong sense's domain.
 *
 * The fix is a small hand authored collision table
 * (COLLISION_TERMS, bug its only entry this wave). For a
 * tabled word, keywordPlainTerms and pubmedCentralString
 * withhold the bare form and let the bridge alternates carry
 * the sense: the diagnosis's candidate C1, probed clean on
 * every source it could reach (PubMed count 462, zero
 * insects in the top 12). Untabled bridged words keep the
 * wave 3 form byte for byte in behavior; salt and rice are
 * the proof specimens. The boolean is untouched (its bare
 * word is the group head by design), and the gate side
 * finding from the same diagnosis (the gate counts literal
 * engagement of a collision token as its bridged sense) is
 * filed, not built here.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  onRequest, createSubrequestLedger, keywordPlainTerms, pubmedCentralString,
  isCollisionTerm, collisionBridgeAlternates, COLLISION_TERMS,
} = await import(join(root, "functions/api/search.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  PASS", name);
  } catch (e) {
    failures.push(name + ": " + String(e && e.message || e).split("\n").slice(0, 3).join(" | "));
    console.log("  FAIL", name, "-", String(e && e.message || e).split("\n")[0]);
  }
}
function group(label) { console.log("\n== " + label); }

/* Harness identical in shape to the wave 3 suite: the real
 * handler, a Europe PMC fixture pool, the model fleet mock
 * answering with no concept groups, and every outbound URL
 * captured. */
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realRandom = Math.random;
globalThis.caches = { default: { match: async () => undefined, put: async () => undefined } };
function rgDb() {
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
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});
const chatRes = (text) => jsonRes({
  choices: [{ message: { role: "assistant", content: text } }],
});

let capturedUrls = [];
let scenPapers = [];
let scenAnswer = "## Short answer\n\nA recorded answer [1].";

async function runScenario(query, opts = {}) {
  capturedUrls = [];
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai") || u.includes("api.groq.com")) {
      if (body.includes("rigorous scientific fact-checker")) {
        return chatRes("no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenAnswer);
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
      }
      return chatRes("I cannot group those terms today.");
    }
    if (u.includes("api.crossref.org") ||
        u.includes("ebi.ac.uk/europepmc") || u.includes("api.openalex.org") ||
        u.includes("api.semanticscholar.org") || u.includes("eutils.ncbi.nlm.nih.gov") ||
        u.includes("doaj.org") || u.includes("api.core.ac.uk") || u.includes("base-search.net")) {
      capturedUrls.push(u);
      if (u.includes("ebi.ac.uk/europepmc")) {
        if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
        return jsonRes({ resultList: { result: scenPapers } });
      }
      if (u.includes("api.openalex.org")) return jsonRes({ results: [] });
      if (u.includes("api.semanticscholar.org")) return jsonRes({ data: [] });
      if (u.includes("eutils.ncbi.nlm.nih.gov")) {
        if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
        if (u.includes("esummary")) return jsonRes({ result: {} });
        return new Response("", { status: 200 });
      }
      return jsonRes({});
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  Math.random = () => 0.99;
  try {
    const ledger = createSubrequestLedger(undefined);
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "fix4-nov05-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, settings: opts.settings || {} }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, captured: capturedUrls.slice() };
  } finally {
    globalThis.fetch = realFetch;
    Math.random = realRandom;
  }
}

const epmcFix = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/fix4nov05-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});
const GENERIC_POOL = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => epmcFix("g" + i,
  "A recorded field study part " + i,
  "Measurements were recorded across the study sites and tabulated by site and season, with every reading reported in full for each condition in the survey.",
  40, 2021));

function pubmedTerms(captured) {
  const out = [];
  for (const u of captured) {
    if (!u.includes("eutils.ncbi.nlm.nih.gov") || !u.includes("esearch")) continue;
    try { out.push(new URL(u).searchParams.get("term") || ""); } catch { /* skip */ }
  }
  return out;
}
function coreQuery(captured) {
  for (const u of captured) {
    if (u.includes("api.core.ac.uk")) {
      try { return decodeURIComponent(new URL(u).searchParams.get("q") || ""); } catch { /* next */ }
    }
  }
  return "";
}
function bareFormReceived(captured) {
  const c = coreQuery(captured);
  if (c) return c;
  for (const u of captured) {
    if (u.includes("api.openalex.org")) {
      try { return decodeURIComponent(new URL(u).searchParams.get("search") || ""); } catch { /* next */ }
    }
  }
  return "";
}

const FEV2_Q = "what makes your temperature go up when you have a bug";
const FEV2_RUNG = ["temperature", "bug", "have", "viral infection", "bacterial infection"];
const WLK4_Q = "my glucose monitor spikes after rice, is moving around right after eating a real fix or just health advice people repeat";
const WLK4_RUNG = ["glucose", "spikes", "around", "rice", "real", "right", "moving"];
const SLT4_Q = "people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general";
const SLT4_RUNG = ["white", "bad", "stuff", "but", "heart", "chips", "salt", "sodium chloride", "dietary sodium"];

const tokens = (s) => String(s || "").split(/[,\s]+/).filter(Boolean);

/* ── The table ───────────────────────────────────────────── */
group("Collision table — bug in, the same sense specimens out");

await test("the table holds bug as its only entry this wave", () => {
  assert.deepEqual(COLLISION_TERMS.map((e) => e.term), ["bug"]);
  assert.equal(isCollisionTerm("bug"), true);
});

await test("salt, rice and temperature are not tabled (same sense expansions)", () => {
  assert.equal(isCollisionTerm("salt"), false);
  assert.equal(isCollisionTerm("rice"), false);
  assert.equal(isCollisionTerm("temperature"), false);
});

await test("the alternates carry the bridged sense with no bare token inside them", () => {
  const alts = collisionBridgeAlternates("bug", null);
  assert.deepEqual(alts.slice(0, 3), ["viral infection", "bacterial infection", "pathogen"]);
  assert.ok(!alts.includes("stomach bug"), "the idiom carries the bare token with it: " + alts.join(", "));
  assert.ok(!alts.some((a) => tokens(a).includes("bug")), "an alternate carries the token: " + alts.join(", "));
});

/* ── keywordPlainTerms ───────────────────────────────────── */
group("keywordPlainTerms — the bare form is withheld for a tabled word");

await test("FEV2: the plain terms carry no bare bug and no stomach bug; the alternates ride", () => {
  const plain = keywordPlainTerms(FEV2_RUNG);
  assert.ok(!plain.includes("bug"), "the bare form rides: " + plain.join(" "));
  assert.ok(!plain.includes("stomach bug"), "the idiom rides: " + plain.join(" "));
  assert.ok(plain.includes("viral infection") && plain.includes("bacterial infection")
    && plain.includes("pathogen"), "the bridge alternates are missing: " + plain.join(" "));
});

await test("FEV2: temperature keeps the wave 3 form (untabled, term first with its group)", () => {
  const plain = keywordPlainTerms(FEV2_RUNG);
  assert.equal(plain[0], "temperature");
  assert.ok(plain.includes("climate"), "the climate alternates should still ride: " + plain.join(" "));
});

await test("SLT4: salt keeps the wave 3 form, term first beside its sodium forms", () => {
  const plain = keywordPlainTerms(SLT4_RUNG);
  const toks = tokens(plain);
  assert.ok(toks.includes("salt"), "salt missing: " + plain.join(" "));
  assert.ok(/sodium/.test(plain.join(" ")), "the sodium forms should still ride: " + plain.join(" "));
});

await test("WLK4: rice keeps the wave 3 form, term itself beside oryza sativa", () => {
  const plain = keywordPlainTerms(WLK4_RUNG);
  const toks = tokens(plain);
  assert.ok(toks.includes("rice"), "rice missing: " + plain.join(" "));
  assert.ok(plain.includes("oryza sativa"), "the alternate should still ride: " + plain.join(" "));
});

/* ── pubmedCentralString ─────────────────────────────────── */
group("pubmedCentralString — the C1 shape on FEV2, the wave 3 forms elsewhere");

await test("FEV2: the central string is the probed C1 form, no bare bug", () => {
  const central = pubmedCentralString(FEV2_RUNG, FEV2_Q, null);
  assert.equal(central, "temperature viral infection bacterial infection pathogen");
  assert.ok(!tokens(central).includes("bug"), "the bare form rides: " + central);
});

await test("SLT4 and WLK4: the central strings are the wave 3 forms, unchanged", () => {
  assert.equal(pubmedCentralString(SLT4_RUNG, SLT4_Q, null), "heart salt");
  assert.equal(pubmedCentralString(WLK4_RUNG, WLK4_Q, null), "moving glucose rice");
});

/* ── Handler level ───────────────────────────────────────── */
group("Handler — what the sources actually receive on FEV2");

await test("FEV2 handler: PubMed's terms carry the bridge vocabulary and no bare bug token", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(FEV2_Q, { settings: {} });
  const terms = pubmedTerms(captured);
  assert.ok(terms.length > 0, "no PubMed term captured");
  for (const t of terms) {
    assert.ok(!tokens(t).includes("bug"), "a PubMed term carries the bare token: " + t);
  }
  assert.ok(/viral infection/.test(terms[0]), "the first PubMed term lacks the bridge: " + terms[0]);
});

await test("FEV2 handler: the bare form a plain keyword source receives has no bug token", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(FEV2_Q, { settings: {} });
  const q = bareFormReceived(captured);
  assert.ok(q, "no plain keyword form captured");
  assert.ok(!tokens(q).includes("bug"), "the bare form carries the token: " + q);
  assert.ok(/viral infection/.test(q), "the bare form lacks the bridge vocabulary: " + q);
  assert.ok(tokens(q).includes("temperature"), "the bare form lacks temperature: " + q);
});

console.log("\nsearch-fix4-nov05: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f);
  process.exitCode = 1;
}
