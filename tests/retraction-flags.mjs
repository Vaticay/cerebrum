/**
 * Retraction flags (2026-11-06, Scite audit wave 1).
 *
 * The data layer contract: a paper is presented as retracted only
 * when two of the three channels (Crossref updated-by, Europe PMC
 * plus PubMed types, OpenAlex) independently report a retraction
 * class event. One channel alone is "reported", an expression of
 * concern is shown as itself with its source named, a correction
 * alone is the quiet "corrected", and no channel answering is
 * "unknown", never clean.
 *
 * Fixtures mirror the live payloads probed on 2026-11-06: the
 * Wakefield Lancet paper (10.1016/S0140-6736(97)11096-0, Crossref
 * updated-by carrying a Retraction Watch retraction dated
 * 2010-02-06, PubMed type "Retracted Publication", OpenAlex
 * is_retracted true) and the PLOS FOS paper
 * (10.1371/journal.pone.0061107, expression of concern asserted by
 * both Retraction Watch and the publisher).
 */
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}

const {
  normalizeRetractionDoi,
  crossrefNotices,
  pubmedSignal,
  openAlexSignal,
  combineRetractionSignals,
  resolveRetractionStatuses,
} = await import(join(root, "functions/lib/retraction.js"));

const WAKEFIELD = "10.1016/s0140-6736(97)11096-0";
const WAKEFIELD_CROSSREF = {
  message: {
    DOI: WAKEFIELD,
    "updated-by": [
      { DOI: "10.1016/s0140-6736(04)15715-2", type: "correction", label: "Correction", source: "retraction-watch", updated: { "date-parts": [[2004, 3, 6]] } },
      { DOI: "10.1016/s0140-6736(10)60175-4", type: "retraction", label: "Retraction", source: "retraction-watch", updated: { "date-parts": [[2010, 2, 6]] } },
    ],
  },
};
const FOS = "10.1371/journal.pone.0061107";
const FOS_CROSSREF = {
  message: {
    DOI: FOS,
    "updated-by": [
      { DOI: "10.1371/journal.pone.0278805", type: "expression_of_concern", label: "Expression of concern", source: "retraction-watch", updated: { "date-parts": [[2023, 1, 11]] } },
      { DOI: "10.1371/journal.pone.0278805", type: "expression_of_concern", label: "Expression of concern", source: "publisher", updated: { "date-parts": [[2023, 1, 11]] } },
    ],
  },
};

await test("DOI normalization matches the tallies rules", () => {
  assert.equal(normalizeRetractionDoi("https://doi.org/10.1016/S0140-6736(97)11096-0"), WAKEFIELD);
  assert.equal(normalizeRetractionDoi("10.1371/journal.pone.0061107."), FOS);
  assert.equal(normalizeRetractionDoi("not a doi"), null);
  assert.equal(normalizeRetractionDoi(""), null);
});

await test("Crossref parser reads updated-by, not update-to", () => {
  const notices = crossrefNotices(WAKEFIELD_CROSSREF.message);
  assert.equal(notices.length, 2);
  const r = notices.find((n) => n.kind === "retraction");
  assert.equal(r.noticeDoi, "10.1016/s0140-6736(10)60175-4");
  assert.equal(r.date, "2010-02-06");
  assert.equal(r.via, "Retraction Watch");
  // A message carrying only update-to (a notice record pointing at
  // another work) yields no notices for the work itself.
  assert.deepEqual(crossrefNotices({ "update-to": [{ DOI: "10.1/x", type: "retraction" }] }), []);
  assert.deepEqual(crossrefNotices({}), []);
  assert.deepEqual(crossrefNotices(null), []);
});

await test("PubMed and OpenAlex signal parsers", () => {
  assert.deepEqual(pubmedSignal({ pubtype: ["Journal Article", "Retracted Publication"] }), { retracted: true, concern: false });
  assert.deepEqual(pubmedSignal({ pubtype: ["Journal Article"] }), { retracted: false, concern: false });
  assert.equal(pubmedSignal({ error: "not found" }), null);
  assert.equal(pubmedSignal(null), null);
  assert.deepEqual(openAlexSignal({ is_retracted: true }), { retracted: true });
  assert.deepEqual(openAlexSignal({ is_retracted: false }), { retracted: false });
  assert.equal(openAlexSignal({}), null);
});

await test("three channels agreeing reads as retracted, all named", () => {
  const v = combineRetractionSignals({
    crossref: { notices: crossrefNotices(WAKEFIELD_CROSSREF.message) },
    europepmc: { retracted: true, concern: false },
    openalex: { retracted: true },
  });
  assert.equal(v.status, "retracted");
  assert.deepEqual(v.namedBy, ["Retraction Watch", "Europe PMC", "OpenAlex"]);
  assert.deepEqual(v.channels, ["Crossref", "Europe PMC", "OpenAlex"]);
});

await test("one channel alone is reported, never settled", () => {
  const onlyCrossref = combineRetractionSignals({
    crossref: { notices: crossrefNotices(WAKEFIELD_CROSSREF.message) },
    europepmc: { retracted: false, concern: false },
    openalex: { retracted: false },
  });
  assert.equal(onlyCrossref.status, "reported");
  assert.deepEqual(onlyCrossref.namedBy, ["Retraction Watch"]);
  const onlyOpenAlex = combineRetractionSignals({ openalex: { retracted: true } });
  assert.equal(onlyOpenAlex.status, "reported");
  assert.deepEqual(onlyOpenAlex.namedBy, ["OpenAlex"]);
});

await test("expression of concern shows as itself, correction alone is quiet", () => {
  const eoc = combineRetractionSignals({
    crossref: { notices: crossrefNotices(FOS_CROSSREF.message) },
    europepmc: { retracted: false, concern: false },
    openalex: { retracted: false },
  });
  assert.equal(eoc.status, "concern");
  assert.deepEqual(eoc.namedBy, ["Retraction Watch"]);
  const corrected = combineRetractionSignals({
    crossref: { notices: [{ kind: "correction", date: "2024-01-01", noticeDoi: "10.1/c", via: "Crossref" }] },
    europepmc: { retracted: false, concern: false },
  });
  assert.equal(corrected.status, "corrected");
});

await test("checked and silent is none; unanswered is unknown, not clean", () => {
  const none = combineRetractionSignals({
    crossref: { notices: [] },
    europepmc: { retracted: false, concern: false },
    openalex: { retracted: false },
  });
  assert.equal(none.status, "none");
  assert.equal(combineRetractionSignals({}).status, "unknown");
  assert.equal(combineRetractionSignals({ crossref: null, europepmc: null, openalex: null }).status, "unknown");
});

await test("resolver batches Europe PMC, PubMed and OpenAlex, Crossref per DOI", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("api.crossref.org/works/")) {
      if (url.includes(encodeURIComponent(WAKEFIELD))) return WAKEFIELD_CROSSREF;
      if (url.includes(encodeURIComponent(FOS))) return FOS_CROSSREF;
      return { message: { DOI: "x" } };
    }
    if (url.includes("api.openalex.org")) {
      return { results: [{ doi: "https://doi.org/" + WAKEFIELD, is_retracted: true }, { doi: "https://doi.org/" + FOS, is_retracted: false }] };
    }
    if (url.includes("europepmc")) {
      return { resultList: { result: [{ doi: WAKEFIELD, pmid: "9500320" }, { doi: FOS, pmid: "23593403" }] } };
    }
    if (url.includes("esummary")) {
      return { result: { "9500320": { pubtype: ["Journal Article", "Retracted Publication"] }, "23593403": { pubtype: ["Journal Article"] } } };
    }
    return null;
  };
  const out = await resolveRetractionStatuses([WAKEFIELD, FOS, "10.1000/clean-1"], fetchJson);
  assert.equal(out[WAKEFIELD].status, "retracted");
  assert.equal(out[FOS].status, "concern");
  assert.equal(out["10.1000/clean-1"].status, "none");
  // Exactly one Europe PMC call, one esummary call, one OpenAlex call
  // for the whole batch; Crossref is the only per DOI channel.
  assert.equal(calls.filter((u) => u.includes("europepmc")).length, 1);
  assert.equal(calls.filter((u) => u.includes("esummary")).length, 1);
  assert.equal(calls.filter((u) => u.includes("api.openalex.org")).length, 1);
  assert.equal(calls.filter((u) => u.includes("api.crossref.org")).length, 3);
});

// ── The endpoint itself, driven with a stubbed global fetch ────────
const { onRequest } = await import(join(root, "functions/api/retractions.js"));

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = handler(String(url));
    if (body == null) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return () => { globalThis.fetch = original; };
}
const liveLike = (url) => {
  if (url.includes("api.crossref.org/works/")) {
    if (url.includes(encodeURIComponent(WAKEFIELD))) return WAKEFIELD_CROSSREF;
    if (url.includes(encodeURIComponent(FOS))) return FOS_CROSSREF;
    return { message: { DOI: "x" } };
  }
  if (url.includes("api.openalex.org")) return { results: [{ doi: "https://doi.org/" + WAKEFIELD, is_retracted: true }] };
  if (url.includes("europepmc")) return { resultList: { result: [{ doi: WAKEFIELD, pmid: "9500320" }] } };
  if (url.includes("esummary")) return { result: { "9500320": { pubtype: ["Retracted Publication"] } } };
  return null;
};

await test("endpoint returns the multi signal verdict per DOI", async () => {
  const restore = stubFetch(liveLike);
  try {
    const res = await onRequest({
      request: new Request(`http://localhost/api/retractions?dois=${encodeURIComponent(WAKEFIELD)},${encodeURIComponent(FOS)}`),
      env: {},
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.retractions[WAKEFIELD].status, "retracted");
    assert.equal(j.retractions[FOS].status, "concern");
    assert.ok(j.retractions[WAKEFIELD].checkedAt > 0);
  } finally { restore(); }
});

await test("endpoint serves the second identical ask from cache with the network down", async () => {
  const restore = stubFetch(() => null);
  try {
    const res = await onRequest({
      request: new Request(`http://localhost/api/retractions?dois=${encodeURIComponent(WAKEFIELD)}`),
      env: {},
    });
    const j = await res.json();
    assert.equal(j.retractions[WAKEFIELD].status, "retracted");
  } finally { restore(); }
});

await test("endpoint degrades to unknown, never a 500, when every channel fails", async () => {
  const restore = stubFetch(() => null);
  try {
    const res = await onRequest({
      request: new Request(`http://localhost/api/retractions?dois=${encodeURIComponent("10.1000/never-seen-9")}`),
      env: {},
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.retractions["10.1000/never-seen-9"].status, "unknown");
  } finally { restore(); }
});

function fakeDb() {
  const store = new Map();
  const db = {
    exec: async () => ({}),
    prepare: (sql) => ({
      bind: (...args) => ({
        _sql: sql, _args: args,
        all: async () => ({
          results: args.filter((a) => store.has(a)).map((doi) => {
            const v = store.get(doi);
            return { doi, payload: v.payload, expires_at: v.expires_at };
          }),
        }),
        first: async () => null,
        run: async () => ({}),
      }),
    }),
    batch: async (stmts) => {
      for (const s of stmts) {
        if (s._sql && s._sql.includes("INSERT")) {
          store.set(s._args[0], { payload: s._args[1], expires_at: s._args[2] });
        }
      }
      return [];
    },
  };
  return { db, store };
}

await test("endpoint persists verdicts to the D1 cache and reads them back", async () => {
  const { db, store } = fakeDb();
  const doi = "10.1000/d1-backed-1";
  const handler = (url) => {
    if (url.includes("api.crossref.org")) return { message: { DOI: doi, "updated-by": [{ DOI: "10.1000/n1", type: "retraction", source: "publisher", updated: { "date-parts": [[2021, 5, 4]] } }] } };
    if (url.includes("api.openalex.org")) return { results: [{ doi: "https://doi.org/" + doi, is_retracted: true }] };
    if (url.includes("europepmc")) return { resultList: { result: [] } };
    return null;
  };
  const restore = stubFetch(handler);
  try {
    const res = await onRequest({ request: new Request(`http://localhost/api/retractions?dois=${doi}`), env: { DB: db } });
    const j = await res.json();
    assert.equal(j.retractions[doi].status, "retracted");
    assert.ok(store.has(doi), "verdict written to D1");
  } finally { restore(); }
  // A fresh isolate memory would miss; the D1 row must carry it. The
  // in-process memory cache cannot be cleared from here, so assert on
  // the stored row's payload directly.
  const row = JSON.parse(store.get(doi).payload);
  assert.equal(row.status, "retracted");
  assert.deepEqual(row.namedBy, ["Crossref", "OpenAlex"]);
});

console.log(`\nretraction-flags: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
