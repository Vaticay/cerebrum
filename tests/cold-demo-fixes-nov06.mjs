/**
 * Cold demo fix lane regressions (2026-11-06).
 *
 * The Cold Demo Path audit lane walked askcerebrum.org the way a
 * stranger would in a first demo and proved five defects. This
 * suite pins their fixes:
 *
 * 1. The static boot layer had no failure exit. public/boot-watchdog.js
 *    now replaces the silent layer with plain words and a Reload
 *    button when the app has not mounted in 15 seconds, and stands
 *    down the moment it mounts. The watchdog's behavior runs here
 *    under node:vm with a stub DOM; the wiring is pinned by source.
 * 2. Vendor failure text printed raw on the public record page (a
 *    live record quoted a provider's daily quota message and its
 *    paid plan upsell, subrequest totals, and refused grants). The
 *    record page, the in app panel, the Markdown export, and the
 *    answer diagnostics now map every internal failure string to
 *    plain honest language; unknown strings fall back to a generic
 *    honest line and never print raw. The hostile record below
 *    carries the live record's failure strings verbatim.
 * 3. Documents invited a paste without saying analysis needs an
 *    account, and the first Inspect tap opened the sign in modal
 *    in silence. The invitation says a free account is needed, and
 *    every sign in route out of Documents carries one line of
 *    explanation into the modal.
 * 4. Share sent a rerun link instead of the permanent record. It
 *    shares the record URL when the answer has one; the rerun link
 *    is the fallback, and its copy says the answer may differ.
 * 5. The Public Beta 2 announcement stacked on the consent gate
 *    before the first question. Its effect now waits for consent
 *    and for the first rendered answer. Sequencing only: the
 *    consent gate itself is untouched.
 *
 * Run with: node tests/cold-demo-fixes-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recordRoute = await import(join(root, "functions/record/[id].js"));
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const recordRouteSrc = readFileSync(join(root, "functions/record/[id].js"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const prerenderSrc = readFileSync(join(root, "scripts/prerender.mjs"), "utf8");
const watchdogSrc = readFileSync(join(root, "public/boot-watchdog.js"), "utf8");

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

/* The slice of a source between two markers, for renderer pins. */
function between(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after start: ${endMarker}`);
  return src.slice(a, b);
}

/* ── Defect 1: the boot watchdog ───────────────────────────────── */

group("boot watchdog: wiring");

await test("the shell loads the watchdog and marks its boot layer", () => {
  assert.ok(indexHtml.includes('<script src="/boot-watchdog.js"></script>'),
    "index.html does not load the watchdog");
  assert.ok(indexHtml.includes('id="cb-boot"'), "the shell boot layer carries no watchdog marker");
  assert.ok(prerenderSrc.includes('id="cb-boot"'), "the prerendered door carries no watchdog marker");
});

await test("the bundle stands the watchdog down when it executes", () => {
  assert.ok(mainSrc.includes("window.__cbAppMounted = true"),
    "main.jsx never sets the mounted flag the watchdog watches for");
});

await test("the watchdog window is the stated 15 seconds", () => {
  assert.match(watchdogSrc, /BOOT_WATCHDOG_MS = 15000/, "the watchdog window is not 15000 ms");
});

/* A stub DOM with exactly the surface the watchdog touches. */
function watchdogHarness({ withMarker = true } = {}) {
  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.style = {};
      this.attrs = {};
      this.listeners = {};
      this._text = "";
    }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
    set textContent(v) { this._text = String(v); if (v === "") this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
  }
  const rootEl = new El("div");
  const bootEl = new El("div");
  if (withMarker) rootEl.appendChild(bootEl);
  const byId = new Map([["root", rootEl]]);
  if (withMarker) byId.set("cb-boot", bootEl);
  let timerCb = null;
  let timerMs = null;
  let timerCleared = false;
  let reloads = 0;
  const observers = [];
  class FakeObserver {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const sandbox = {
    console,
    MutationObserver: FakeObserver,
    document: {
      getElementById: (id) => byId.get(id) || null,
      createElement: (tag) => new El(tag),
    },
    setTimeout: (cb, ms) => { timerCb = cb; timerMs = ms; return 1; },
    clearTimeout: () => { timerCleared = true; },
  };
  sandbox.window = sandbox;
  sandbox.location = { reload: () => { reloads += 1; } };
  vm.createContext(sandbox);
  vm.runInContext(watchdogSrc, sandbox);
  return {
    rootEl, sandbox, observers,
    get timerCb() { return timerCb; },
    get timerMs() { return timerMs; },
    get timerCleared() { return timerCleared; },
    get reloads() { return reloads; },
    removeMarker() { byId.delete("cb-boot"); },
    notifyObservers() { for (const o of observers) if (!o.disconnected) o.cb(); },
    findButton() {
      const walk = (el) => {
        if (el.tagName === "button") return el;
        for (const c of el.children) { const b = walk(c); if (b) return b; }
        return null;
      };
      return walk(rootEl);
    },
  };
}

group("boot watchdog: behavior with the bundle blocked");

await test("a bundle that never mounts gets plain failure words and a working Reload", () => {
  const h = watchdogHarness();
  assert.equal(h.timerMs, 15000, "the watchdog did not arm for 15 seconds");
  assert.equal(typeof h.timerCb, "function", "the watchdog set no timer");
  h.timerCb();
  const text = h.rootEl.textContent;
  assert.ok(text.includes("Cerebrum did not load"), "the failure state names what happened");
  assert.ok(text.includes("Your connection may have dropped"), "the failure state does not name the likely cause");
  const button = h.findButton();
  assert.ok(button, "the failure state has no button");
  assert.equal(button.textContent, "Reload", "the failure button is not labelled Reload");
  button.listeners.click();
  assert.equal(h.reloads, 1, "the Reload button does not reload");
});

await test("a mounted app stands the watchdog down before the deadline", () => {
  const h = watchdogHarness();
  h.sandbox.__cbAppMounted = true;
  h.notifyObservers();
  assert.equal(h.timerCleared, true, "mounting did not clear the watchdog timer");
  h.timerCb();
  assert.ok(!h.rootEl.textContent.includes("Cerebrum did not load"),
    "the failure words appeared over a mounted app");
});

await test("a boot layer replaced by React stands the watchdog down", () => {
  const h = watchdogHarness();
  h.removeMarker();
  h.notifyObservers();
  assert.equal(h.timerCleared, true, "the layer leaving the page did not clear the timer");
  h.timerCb();
  assert.ok(!h.rootEl.textContent.includes("Cerebrum did not load"),
    "the failure words appeared after React replaced the layer");
});

await test("a mount signalled only by the flag still wins at the deadline", () => {
  const h = watchdogHarness();
  h.sandbox.__cbAppMounted = true;
  h.timerCb();
  assert.ok(!h.rootEl.textContent.includes("Cerebrum did not load"),
    "the failure words appeared even though the bundle had executed");
});

await test("a page with no boot marker never arms", () => {
  const h = watchdogHarness({ withMarker: false });
  assert.equal(h.timerCb, null, "the watchdog armed on a complete static page");
});

/* ── Defect 2: vendor failure text ─────────────────────────────── */

/* The hostile record: the live cold demo record's failure strings
   verbatim (the provider quota message and plan upsell lived in a
   trace detail), plus an unknown tier and outcome carrying a
   secret string, an unknown failed stage name, and a ledger at
   its ceiling with refused grants. */
const HOSTILE_RECORD = {
  version: 2,
  id: "r_0123456789abcdef0123456789abcdef",
  url: "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef",
  askedAt: "2026-11-06T15:00:00.000Z",
  question: "can wood frogs survive being frozen",
  databases: [{ source: "europePMC", ok: true, count: 40 }],
  funnel: { gathered: 88, deduped: 61, cited: 1 },
  synthesisModel: "groq:openai/gpt-oss-120b",
  sources: [
    { n: 1, title: "Freeze tolerance in the wood frog", authors: "Storey KB", journal: "Journal of Experimental Biology", year: 2021, doi: "10.1000/frog1", url: "https://doi.org/10.1000/frog1", cited: true },
  ],
  degraded: true,
  failedStages: ["synthesis", "fact-check", "mystery-stage"],
  ledger: { used: 50, limit: 50, remaining: 0, refused: 4, byStage: { retrieval: 20, synthesis: 12 } },
  factCheckTrace: [
    { tier: "stage", outcome: "ok" },
    { tier: "terms", outcome: "ok" },
    { tier: "workers-ai", outcome: "error", detail: "Workers AI daily neuron allocation exhausted. Upgrade to Workers Paid to continue." },
    { tier: "openrouter", outcome: "http-429" },
    { tier: "gemini", outcome: "timeout" },
    { tier: "zzz-vendor", outcome: "mysterious-token", detail: "SECRET INTERNAL STRING" },
  ],
};
const routeDbWith = (row) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
const routeCall = (id, env, suffix = "") => recordRoute.onRequestGet({
  request: new Request("https://askcerebrum.org/record/" + id + suffix),
  env,
  params: { id },
});

group("record page: internal failure strings never print raw");

await test("the hostile record page prints plain words and none of the raw strings", async () => {
  const res = await routeCall(HOSTILE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(HOSTILE_RECORD) }) });
  const html = await res.text();
  for (const raw of ["neuron", "Workers Paid", "Workers AI", "workers-ai", "openrouter", "gemini",
    "http-429", "SECRET INTERNAL", "mysterious-token", "Subrequests", "grants were refused",
    "Largest spends", "mystery-stage", "budget ceiling"]) {
    assert.ok(!html.includes(raw), `the public page printed the raw internal string: ${raw}`);
  }
  assert.ok(html.includes("failed stages: writing the answer, checking the claims"),
    "the health banner does not name the failed stages in plain words");
  assert.ok(html.includes("This search reached its working limit, so some of its planned lookups never ran. The answer rests on the sources that were gathered."),
    "the budget section does not say plainly that the search was partial");
  assert.ok(html.includes("A claim check ran on this answer."), "the fact check section lost the ran line");
  assert.ok(html.includes("A light check of the scientific terms in the answer ran."), "the fact check section lost the terms line");
  assert.ok(html.includes("One checker was at its usage limit, so it could not run."), "the 429 outcome has no plain line");
  assert.ok(html.includes("One checker did not answer in time, so it was not counted."), "the timeout outcome has no plain line");
  assert.ok(html.includes("2 checkers did not complete, so they were not counted."),
    "the raw error and the unknown outcome do not share the generic honest line");
});

await test("a record whose search stayed within its limit says so, and nothing about refusals", async () => {
  const calm = { ...HOSTILE_RECORD, degraded: false, failedStages: [], factCheckTrace: [{ tier: "gemini", outcome: "ok" }],
    ledger: { used: 12, limit: 50, remaining: 38, refused: 0, byStage: { retrieval: 5 } } };
  const html = await (await routeCall(calm.id, { DB: routeDbWith({ record: JSON.stringify(calm) }) })).text();
  assert.ok(html.includes("This search stayed within its working limit."), "the calm budget sentence is missing");
  assert.ok(!html.includes("reached its working limit"), "a calm search was described as limited");
});

await test("the mapping helpers never read the stored detail, on either renderer", () => {
  const clientMap = between(appSrc, "function factCheckOutcomeCategory", "function recordBudgetLine");
  assert.ok(!clientMap.includes(".detail"), "the client mapping reads the stored detail");
  const pageMap = between(recordRouteSrc, "function factCheckOutcomeCategory", "function recordHealthNote");
  assert.ok(!pageMap.includes(".detail"), "the record page mapping reads the stored detail");
  const pageBudget = between(recordRouteSrc, "function recordBudgetSection", "function recordPage(record");
  assert.ok(!pageBudget.includes("Subrequests") && !pageBudget.includes("grant"),
    "the record page budget section still prints ledger machinery");
});

await test("the Markdown export phrases fact check and budget through the same plain helpers", () => {
  const md = between(appSrc, "function searchRecordMarkdown", "function SearchRecordPanel");
  assert.ok(md.includes("factCheckPlainLines(record.factCheckTrace)"),
    "the Markdown fact check list does not use the plain lines helper");
  assert.ok(md.includes("recordBudgetLine(record)"), "the Markdown budget section does not use the plain budget helper");
  assert.ok(!md.includes("split(\", \")"), "the Markdown still splits a raw trace line");
});

await test("the answer diagnostics rows name stages and reasons in plain words only", () => {
  const diagAt = appSrc.indexOf("function AnswerDiagnostics");
  const diag = appSrc.slice(diagAt, diagAt + 14000);
  assert.ok(diag.includes("stagePlain(s.name)"), "the diagnostics rows do not map the stage name");
  assert.ok(diag.includes("stageReasonPlain(s.skipReason)"), "the diagnostics rows do not screen the reason");
  assert.ok(!diag.includes("unnamed"), "the diagnostics rows still print the raw stage name fallback");
  assert.ok(appSrc.includes('"subrequest budget exhausted": "the search reached its working limit"'),
    "the budget exhaustion reason has no plain mapping");
  assert.match(appSrc, /workers\|openrouter\|gemini/, "the reason screen carries no vendor name filter");
});

/* ── Defect 3: the Documents sign in trap ──────────────────────── */

group("documents: the account need is stated before the modal");

await test("the paste invitation says reading needs a free account, signed out only", () => {
  assert.ok(appSrc.includes('Paste a paper, report, or any long document. You can also upload a file or drop one here.{!user ? " Reading it needs a free account." : ""}'),
    "the invitation does not carry the account sentence for a signed out visitor");
});

await test("every sign in route out of Documents carries the explanation line", () => {
  const nb = between(appSrc, "function NotebookMode", "\nfunction ");
  assert.ok(nb.includes('const DOC_AUTH_NOTE = "Documents need a free account. Sign in to continue. Your document stays on this page while you do."'),
    "the Documents auth note is missing or reworded");
  assert.ok(!nb.includes('onOpenAuth("signin")'), "a NotebookMode route still opens the modal with no note");
  const routes = nb.split("openDocAuth()").length - 1;
  assert.ok(routes >= 5, `only ${routes} Documents routes carry the note, expected the gate plus the backend routes`);
});

await test("the note rides into the modal and clears when it closes", () => {
  assert.ok(appSrc.includes("const [authNote, setAuthNote] = useState(null)"), "the app holds no auth note state");
  assert.ok(appSrc.includes("setAuthNote(note || null)"), "the Documents open route does not set the note");
  assert.ok(appSrc.includes("note={authNote}"), "the modal mount does not pass the note");
  assert.ok(appSrc.includes("setAuthNote(null)"), "nothing clears the note");
  assert.ok(appSrc.includes('intent = "login", note'), "AuthModal does not accept the note prop");
  assert.ok(appSrc.includes("{note && step === \"email\" ? ("), "AuthModal does not render the note on the email step");
});

/* ── Defect 4: Share sends the record ──────────────────────────── */

group("share: the permanent record, or an honest rerun");

await test("the share dialog prefers the record URL and labels the fallback honestly", () => {
  assert.ok(appSrc.includes("function shareRecordUrl(t)"), "no share record URL helper");
  assert.ok(appSrc.includes('"/record/" + rec.id'), "the helper does not build the record path");
  const dlgAt = appSrc.indexOf("const recordUrl = shareRecordUrl(t);");
  assert.ok(dlgAt > 0, "the share dialog does not consult the record helper");
  const dlg = appSrc.slice(dlgAt, dlgAt + 700);
  assert.ok(dlg.includes('window.location.origin + "/?q=" + encodeURIComponent(t.q)'),
    "the rerun link is gone instead of kept as the fallback");
  assert.ok(dlg.includes('"\\nThis link runs the question again, so the answer may differ from this one."'),
    "the shared text does not warn that a rerun can answer differently");
  assert.ok(appSrc.includes('"This link opens the permanent record of this exact search."'),
    "the dialog does not say the record link is permanent");
  assert.ok(appSrc.includes('"This answer has no saved record, so this link runs the question again. The answer may differ."'),
    "the dialog does not explain the rerun fallback");
});

/* ── Defect 5: announcement sequencing ─────────────────────────── */

group("announcement: after consent and after the first answer");

await test("the beta announcement waits for consent and a rendered first answer", () => {
  const fxAt = appSrc.indexOf("const firstAnswerRendered");
  assert.ok(fxAt > 0, "the announcement effect never tests for a first answer");
  const fx = appSrc.slice(fxAt - 500, fxAt + 700);
  assert.ok(fx.includes("!entered || beta2Open || !legalOk || busy"), "the effect does not gate on consent and idle state");
  assert.ok(fx.includes('typeof t.answer === "string" && t.answer.length > 0'), "the first answer test does not read rendered answers");
  assert.ok(fx.includes("[entered, beta2Open, legalOk, busy, turns]"), "the effect does not re run when consent, search state, or turns change");
  /* The dependency array is evaluated during render, so the
     effect must sit below the declarations it reads, or the
     first render throws. */
  assert.ok(fxAt > appSrc.indexOf("const [legalOk, setLegalOk]"), "the announcement effect sits above the legalOk declaration its deps read");
  assert.ok(fxAt > appSrc.indexOf("const [turns, setTurns]"), "the announcement effect sits above the turns declaration its deps read");
  assert.ok(appSrc.includes("{beta2Open && legalOk && ("), "the announcement render lost its consent gate");
});

// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
