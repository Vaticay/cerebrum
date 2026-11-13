/**
 * Deep read tests (2026-11-12).
 *
 * The defect: PaperDrawer was removed on 2026-10-09 and its state and
 * setters on 2026-10-16, but CitationPeek's Deep read buttons and every
 * other paper opener kept calling onOpenPaper. The App never passed an
 * opener to TurnRow, so TurnInner's default no op swallowed every click
 * on every record in every state. Proven live on 2026-11-12: two named
 * papers from a "why do we dream" answer (Siclari et al. 2017, DOI
 * 10.1038/nn.4545, and the galantamine PLOS ONE 2018 paper) clicked to
 * nothing, no error, dialog stayed open.
 *
 * This suite pins the restore: a real opener exists in the App and is
 * passed to the turns, the drawer renders from that state, and the peek
 * only offers the button when the record holds something fuller,
 * saying so plainly when it does not.
 *
 * No network, no DOM. Run with: node tests/deep-read-nov12.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

let passed = 0;
const failures = [];
async function test(name, f) {
  try { await f(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push({ name, error: e }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function group(name) { console.log(`\n${name}`); }

group("The opener exists and is wired");
await test("the App defines a real paper opener over the turn sources", () => {
  assert.ok(appSrc.includes("const handleOpenPaper = useCallback((t, n) => {"), "no App level opener defined");
  assert.ok(appSrc.includes("const s = t && t.sources && t.sources[n - 1];"), "opener does not read the turn source by number");
  assert.ok(appSrc.includes("if (s) setDrawerSource(s);"), "opener does not set the drawer source");
});
await test("the App passes the opener to the turns", () => {
  assert.ok(appSrc.includes("onOpenPaper={handleOpenPaper}"), "TurnRow never receives onOpenPaper, the Nov 12 defect shape");
});
await test("the drawer renders from App state and locks scroll with the other overlays", () => {
  assert.ok(appSrc.includes("const [drawerSource, setDrawerSource] = useState(null);"), "drawer state missing");
  assert.ok(appSrc.includes("<PaperDrawer P={P} accent={accent} source={drawerSource}"), "drawer render missing");
  assert.ok(appSrc.includes("|| !!drawerSource"), "drawer missing from anyOverlayOpen");
});
await test("the drawer component is restored with its Deep Read eyebrow", () => {
  assert.ok(appSrc.includes("function PaperDrawer({ P, accent, source, close })"), "PaperDrawer component missing");
  assert.ok(appSrc.includes('eyebrow="Deep Read"'), "drawer lost its Deep Read eyebrow");
});

group("Honest states, no silent button");
await test("the peek computes whether a fuller view exists", () => {
  assert.ok(appSrc.includes("const hasFuller = !!(snippet || fullText);"), "peek does not compute hasFuller");
});
await test("both peek forms gate the Deep read button on that state", () => {
  const gates = appSrc.match(/hasFuller \? \(/g) || [];
  assert.equal(gates.length, 2, "expected the mobile sheet and the desktop popover to both gate the button, found " + gates.length);
  const buttons = appSrc.match(/Deep read <Icon/g) || [];
  assert.equal(buttons.length, 2, "expected exactly the two gated Deep read buttons, found " + buttons.length);
});
await test("a record with nothing fuller gets the plain sentence, in both forms", () => {
  const lines = appSrc.match(/No fuller text for this record\./g) || [];
  assert.ok(lines.length >= 3, "plain sentence missing from a peek form or the drawer, found " + lines.length);
});
await test("the drawer states the full text case plainly instead of faking a reading view", () => {
  assert.ok(appSrc.includes("The full text itself is not kept with the record"), "drawer full text honesty line missing");
});
await test("no new user visible string carries a dash character", () => {
  for (const s of ["No fuller text for this record.", "This paper was read in full when the answer was built. The full text itself is not kept with the record, so the place to read it is the paper itself, linked above.", "No fuller text for this record. The search returned no abstract for it, and no full text was read."]) {
    assert.ok(!/[-–—]/.test(s), "dash character in: " + s);
  }
});

group("The pill agrees with the body (2026-11-12 follow up)");
await test("the peek pill is three state, driven by the same fields the body uses", () => {
  assert.ok(appSrc.includes('const pillLabel = fullText ? "Full text read" : snippet ? "Abstract only" : "No abstract returned";'), "peek pill does not read the snippet for its middle state");
});
await test("both peek forms render that shared pill label", () => {
  const peeks = appSrc.match(/\}>{pillLabel}<\/span>/g) || [];
  assert.equal(peeks.length, 3, "expected the mobile peek, the desktop peek, and the drawer to all render pillLabel, found " + peeks.length);
});
await test("the drawer pill is three state, driven by its own body text", () => {
  assert.ok(appSrc.includes('const pillLabel = fullText ? "Full text read" : body ? "Abstract only" : "No abstract returned";'), "drawer pill does not read its body for its middle state");
});
await test("no pill anywhere asserts an abstract from the full text flags alone", () => {
  const twoState = appSrc.match(/fullText \? "Full text read" : "Abstract only"/g) || [];
  assert.equal(twoState.length, 0, "a two state pill render survived, found " + twoState.length);
});
await test("the no text pill state carries no dash character", () => {
  assert.ok(!/[-–—]/.test("No abstract returned"), "dash character in the no text pill state");
});

group("The Compare replay is wired too (2026-11-13 residual)");
await test("CompareModal accepts a paper opener, defaulting to the no op only when unwired", () => {
  assert.ok(appSrc.includes("function CompareModal({ P, accent, at, S, history, close, onOpenPaper = () => {} })"), "CompareModal takes no opener");
});
await test("the App render passes the real opener into CompareModal", () => {
  assert.ok(appSrc.includes("<CompareModal P={P} accent={accent} at={at} S={S} history={history} close={() => setCompareOpen(false)} onOpenPaper={handleOpenPaper} />"), "CompareModal render site never receives handleOpenPaper, the residual defect shape");
});
await test("the Compare Turn render forwards the opener to its rows", () => {
  assert.ok(appSrc.includes("interactive={false} onOpenPaper={onOpenPaper} />"), "the non interactive Turn render in CompareModal does not forward onOpenPaper");
});
await test("no Turn render is left without an opener", () => {
  const turns = appSrc.match(/<Turn key=\{t\.id \?\? ti\}/g) || [];
  assert.equal(turns.length, 1, "expected exactly the one raw Turn render, in CompareModal, found " + turns.length);
  assert.ok(appSrc.includes("onOpenPaper={handleOpenPaper}"), "the answer view opener wiring is gone");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
