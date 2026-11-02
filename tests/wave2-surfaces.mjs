/**
 * Wave 2 surface pins (2026-11-02).
 *
 * The cross surface contract of the fix program's second wave: each
 * Instrument surface takes its ground from ONE named local
 * expression the Wave 0 resolver can replace at merge time, the
 * Library exports diagrams through the one shared register colour
 * path, Settings has seven groups with choice lines and no chevron,
 * and the Inbox is correspondence with a trust letterhead. The
 * Reader's own pins live in docmode-reader.mjs; the trust call
 * sites live in e2ee-messaging.mjs. This file pins the seams
 * between the surfaces.
 *
 * Run with: node tests/wave2-surfaces.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const settingsSrc = await readFile(join(root, "src/settings.jsx"), "utf8");
const inboxSrc = await readFile(join(root, "src/inbox.jsx"), "utf8");
const flowSrc = await readFile(join(root, "src/flowcharts.jsx"), "utf8");
const ledgerSrc = await readFile(join(root, "src/ledger.jsx"), "utf8");
const tokens = await import(join(root, "src/registerTokens.js"));

// ═══════════════════════════════════════════════════════════════════
group("resolver swap spots — one named ground expression per surface");

await test("the three Instrument grounds are the register ground today", () => {
  assert.equal(tokens.REGISTER_GROUND, "#060606");
  // Coordinator merge note (2026-11-02): the lane specified the
  // resolver swap at merge time, so the three expressions now read
  // through the Wave 0 resolver, which is the stronger form of the
  // same pin: one named expression per surface, resolving to the
  // register ground because all three views are Instrument class.
  assert.ok(appSrc.includes("const LIBRARY_SURFACE_GROUND = resolveSurface(\"library\").ground;"), "Library ground expression missing");
  assert.ok(settingsSrc.includes("export const SETTINGS_SURFACE_GROUND = resolveSurface(\"settings\").ground;"), "Settings ground expression missing");
  assert.ok(inboxSrc.includes("export const INBOX_SURFACE_GROUND = resolveSurface(\"inbox\").ground;"), "Inbox ground expression missing");
  assert.equal(tokens.resolveSurface("library").ground, tokens.REGISTER_GROUND);
  assert.equal(tokens.resolveSurface("settings").ground, tokens.REGISTER_GROUND);
  assert.equal(tokens.resolveSurface("inbox").ground, tokens.REGISTER_GROUND);
  assert.ok(appSrc.includes("background: LIBRARY_SURFACE_GROUND"), "the Library does not render on its ground expression");
  assert.ok(settingsSrc.includes("background: SETTINGS_SURFACE_GROUND"), "Settings does not render on its ground expression");
  assert.ok(inboxSrc.includes("background: INBOX_SURFACE_GROUND"), "the Inbox does not render on its ground expression");
});

await test("the ledger components exist and carry the register forms", () => {
  for (const name of ["LedgerHead", "LedgerSection", "LedgerRow", "LedgerWordAction", "LedgerSearch"]) {
    assert.ok(ledgerSrc.includes(`export function ${name}`), "ledger component missing: " + name);
  }
  assert.ok(ledgerSrc.includes("fontSize: 96"), "the ledger head numeral is not display size");
  assert.ok(ledgerSrc.includes("fontSize: 26"), "ledger section titles are not at 26");
  assert.ok(ledgerSrc.includes("fontSize: 18"), "ledger row titles are not at 18");
});

// ═══════════════════════════════════════════════════════════════════
group("Library — one export colour path");

await test("the duplicate export renderer is gone and the shared path is used", () => {
  assert.ok(!appSrc.includes("FC_EXPORT_COLORS"), "the duplicate export colour set is back in the app");
  assert.ok(!flowSrc.includes("fcPaletteColors"), "the palette derived export colours are back in the Studio");
  assert.ok(flowSrc.includes("export function diagramExportColors()"), "the shared export helper is missing");
  assert.ok(flowSrc.includes("accent: REGISTER_GOLD"), "the export accent is not the register gold");
  assert.ok(appSrc.includes("sharedFcSvgString(fc.nodes || [], fc.edges || [], fc.title, diagramExportColors())"), "the Library does not export through the shared path");
});

await test("the Library search matches the five named fields", () => {
  assert.ok(appSrc.includes("[sv.title, sv.authors, sv.journal, sv.abstract, collName, sv.year, sv.doi]"), "the unified field set is not what the Library matches");
});

// ═══════════════════════════════════════════════════════════════════
group("Settings — seven groups, choice lines, no chevron");

await test("the seven groups are the tabs, and the old ids are gone", () => {
  for (const id of ["account", "reading", "appearance", "privacy", "notifications", "membership", "diagnostics"]) {
    assert.ok(settingsSrc.includes(`{tab === "${id}"`), "settings group missing: " + id);
  }
  assert.ok(!settingsSrc.includes('{tab === "answers"'), "the answers group is back");
  assert.ok(!settingsSrc.includes('{tab === "sound"'), "the sound group is back");
  assert.ok(!settingsSrc.includes('{tab === "about"'), "the about group is back");
});

await test("rows demonstrate themselves and choices are words", () => {
  assert.ok(settingsSrc.includes('role="radiogroup"'), "the Picker is not an inline choice line");
  assert.ok(settingsSrc.includes("textDecorationColor: REGISTER_GOLD"), "the chosen word is not underlined in gold");
  assert.ok(!settingsSrc.includes("}}>›</span>"), "the row chevron is back");
  assert.ok(settingsSrc.includes("READ_BODY_FONT_PX[fontSize]"), "the text size sample does not use the Reader numbers");
  assert.ok(settingsSrc.includes("Reading preview"), "the palette reading preview is missing");
  assert.ok(settingsSrc.includes("Palettes change reading surfaces"), "the Option B palette copy is missing");
  assert.ok(settingsSrc.includes("scrollIntoView"), "the search jump does not scroll to the row");
  assert.ok(settingsSrc.includes("borderTop: `2px solid ${REGISTER_GOLD}`"), "the jump mark is not a gold rule");
});

// ═══════════════════════════════════════════════════════════════════
group("Inbox — correspondence form");

await test("letters and ledger rows carry no chat furniture", () => {
  assert.ok(inboxSrc.includes('className="cb-inbox-letterhead"'), "letterhead missing");
  assert.ok(inboxSrc.includes("maxWidth: 680"), "letters are not on the measure");
  assert.ok(!inboxSrc.includes("New messages ↓"), "the arrow pill is back");
  assert.ok(inboxSrc.includes(">Send</button>") || inboxSrc.includes("Send\n"), "the send action is not the word Send");
  assert.ok(appSrc.includes('{ label: "Open inbox"'), "the command palette has no Open inbox command");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
