/**
 * App tail fixes (2026-10-20, Lane C): the eighteen tail findings wave,
 * items 4, 5, 6, 7, 9, 14, 15, 16 and 18.
 *
 * Style follows the other source pin suites in this folder: the shipped
 * source is read and pinned, the phone arithmetic for items 14 and 15
 * is recomputed from numbers extracted out of that source, and the
 * toast queue in src/appUtils.js is executed for real by slicing its
 * self contained section into a vm with a fake window.
 *
 * Run with: node tests/app-tail-fixes.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const utils = readFileSync(join(root, "src/appUtils.js"), "utf8");
const flow = readFileSync(join(root, "src/flowcharts.jsx"), "utf8");

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
function group(name) { console.log(`\n${name}`); }
function slice(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `slice start not found: ${from}`);
  const b = src.indexOf(to, a);
  assert.ok(b > a, `slice end not found after start: ${to}`);
  return src.slice(a, b);
}

// ══════════════════════════════════════════════════════════════════
group("Item 4, toasts fired before entry are no longer dropped");

await test("the shipped toast layer queues while no host is mounted and drains on mount", () => {
  const section = slice(utils, "let cbToastId = 0;", "\nexport {");
  const dispatched = [];
  const ctx = {
    console,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    window: { dispatchEvent: (e) => { dispatched.push(e); return true; } },
  };
  vm.createContext(ctx);
  vm.runInContext(section + "\n;globalThis.__api = { toast, cbToastHostMount, cbToastHostUnmount };", ctx);
  const api = ctx.__api;
  api.toast("first, before any host");
  api.toast("second, before any host", { tone: "error" });
  assert.equal(dispatched.length, 0, "a toast with no host must not dispatch into the void");
  const queued = api.cbToastHostMount();
  assert.equal(queued.length, 2, "both early toasts must be queued for the first host");
  assert.equal(queued[0].message, "first, before any host");
  assert.equal(queued[1].tone, "error");
  api.toast("third, with a host mounted");
  assert.equal(dispatched.length, 1, "a toast with a host mounted dispatches at once");
  assert.equal(dispatched[0].detail.message, "third, with a host mounted");
  api.cbToastHostUnmount();
  api.toast("fourth, after the host left");
  assert.equal(dispatched.length, 1, "a toast after the last host leaves queues again");
  const drained = api.cbToastHostMount();
  assert.equal(drained.length, 1, "the queued toast drains to the next host");
  assert.equal(drained[0].message, "fourth, after the host left");
  api.cbToastHostUnmount();
});

await test("ToastHost claims and releases the host slot and drains the buffer", () => {
  const host = slice(app, "function ToastHost(", "function AccountMenu(");
  assert.ok(host.includes("cbToastHostMount()"), "ToastHost never claims the buffered queue");
  assert.ok(host.includes("cbToastHostUnmount()"), "ToastHost never releases the host slot");
  assert.ok(utils.includes("cbToastHostMount") && utils.includes("cbToastHostUnmount"), "appUtils does not export the host lifecycle");
});

await test("a ToastHost mounts in both the door state and the entered shell", () => {
  const mounts = app.match(/<ToastHost P=\{P\} accent=\{accent\} isMobile=\{isMobile\} \/>/g) || [];
  assert.equal(mounts.length, 2, `expected 2 ToastHost mounts, found ${mounts.length}`);
  const doorReturn = slice(app, "if (!entered) {", "const started = turns.length");
  assert.ok(doorReturn.includes("<ToastHost"), "the not entered door render has no ToastHost");
});

// ══════════════════════════════════════════════════════════════════
group("Item 9, the dead magic verify path is gone from the client");

await test("no call to the nonexistent magic verify action remains", () => {
  assert.ok(!app.includes("magic-verify"), "magic-verify is still called");
  assert.ok(!app.includes('apiAuth("magic'), "a magic auth action is still called");
});

await test("an arriving magic parameter is stripped, other params and the hash survive, session restore still runs", () => {
  const effect = slice(app, "const url = new URL(window.location.href);", "await handleAuthed(u, { checkImport: false });");
  assert.ok(effect.includes('url.searchParams.has("magic")'), "the strip does not look for the magic parameter");
  assert.ok(effect.includes('url.searchParams.delete("magic")'), "the magic parameter is not deleted");
  assert.ok(effect.includes("url.hash"), "the hash is not preserved by the strip");
  assert.ok(effect.includes("apiWhoAmI()"), "normal session restore no longer runs after the strip");
});

// ══════════════════════════════════════════════════════════════════
group("Item 5, Find people searches cannot land out of order");

await test("the debounced search carries a sequence guard on results and on the spinner", () => {
  const modal = slice(app, "function NetworkSearchModal(", "/* Commit 100 — the privacy panel.");
  assert.ok(modal.includes("const seq = ++searchSeq.current;"), "no sequence number is taken per query change");
  assert.ok(modal.includes("if (seq !== searchSeq.current) return;"), "a stale resolution is not dropped");
  assert.ok(modal.includes("if (seq === searchSeq.current) setLoading(false);"), "a stale resolution can still clear the spinner");
});

// ══════════════════════════════════════════════════════════════════
group("Item 6, Library bulk selection is pruned and select all is honest");

await test("a prune effect intersects the selection with the visible keys whenever the visible list changes", () => {
  const prune = slice(app, "tail item 6: prune the bulk selection", "const [sessions, setSessions]");
  assert.ok(prune.includes("}, [visibleSaved]);"), "the prune effect does not depend on visibleSaved");
  assert.ok(prune.includes("visibleKeys.has(k)"), "the prune effect does not intersect with the visible keys");
  assert.ok(prune.includes("sourceKey(s) || `idx-${i}`"), "the prune keys do not match the row keys");
});

await test("select all compares against the visible keys it actually selects, not the raw set size", () => {
  assert.ok(!app.includes("selectedSavedKeys.size === visibleSaved.length"), "the old size against length comparison is still present");
  const header = slice(app, 'aria-label={visibleSaved.length > 0 && visibleSaved.every', 'style={{ width: 18, height: 18, accentColor: accent, cursor: "pointer", flexShrink: 0 }} />');
  assert.ok(header.includes("visibleSaved.every((s, i) => selectedSavedKeys.has(sourceKey(s) || `idx-${i}`))"), "select all is not an every check over visible keys");
});

// ══════════════════════════════════════════════════════════════════
group("Item 7, a Trending load in flight cannot overwrite a past edition");

await test("the load completion paths check the edition generation captured at load start", () => {
  const load = slice(app, "const load = (isBackground) => {", "load(false);");
  assert.ok(load.includes("const editionAtStart = viewingEditionRef.current;"), "no generation is captured at load start");
  const guards = load.match(/viewingEditionRef\.current !== editionAtStart/g) || [];
  assert.ok(guards.length >= 2, `expected guards on both the success and failure paths, found ${guards.length}`);
});

// ══════════════════════════════════════════════════════════════════
group("Item 14, the sign in code row fits at 360 and at 390, recomputed");

await test("the recomputed panel inner widths leave the old row spilling and the new row fitting", () => {
  // Numbers extracted from the shipped chrome, not from the audit.
  assert.ok(flow.includes('padding: drawer ? 0 : "max(16px, env(safe-area-inset-top)) 16px'), "Dialog scrim padding pin moved");
  assert.ok(flow.includes('padding: "24px 22px 22px"'), "ModalChrome panel padding pin moved");
  const scrimSide = 16, panelSide = 22;
  const innerAt = (vw) => Math.min(440, vw - 2 * scrimSide) - 2 * panelSide;
  assert.equal(innerAt(360), 284, "panel inner width at 360");
  assert.equal(innerAt(390), 314, "panel inner width at 390");
  const oldRow = 6 * 44 + 5 * 8;
  assert.equal(oldRow, 304);
  assert.ok(oldRow > innerAt(360), "the old 44px row should spill at 360 for this test to mean anything");
  assert.ok(app.includes("const narrowOtp = winW <= 480;"), "the narrow code row switch is missing");
  assert.ok(app.includes("width: narrowOtp ? 40 : 44"), "the boxes do not shrink on narrow widths");
  assert.ok(app.includes("const otpGap = narrowOtp ? 6 : 8;"), "the gap does not shrink on narrow widths");
  assert.ok(app.includes("gap: otpGap"), "the code row does not use the responsive gap");
  const newRow = 6 * 40 + 5 * 6;
  assert.equal(newRow, 270);
  assert.ok(newRow <= innerAt(360), "the new row still spills at 360");
  assert.ok(newRow <= innerAt(390), "the new row spills at 390");
  assert.ok(oldRow <= 440 - 2 * panelSide, "the desktop 44px row must still fit the full panel");
});

// ══════════════════════════════════════════════════════════════════
group("Item 15, Find people rows give the identity usable width, recomputed");

await test("the recomputed identity width grows on narrow widths while tap targets stay 48 tall", () => {
  // Structural numbers from the shipped code. WorkspacePage mobile
  // side padding 18, the page panel border 1 a side, the results list
  // side padding 12. Glyph widths are estimates at 12px weight 500:
  // Follow about 34px, Following about 52px.
  const pageAt = (vw) => vw - 2 * 18 - 2 * 1 - 2 * 12;
  const followBtn = (padSide, text) => text + 2 * padSide + 2;
  const identityBefore = (vw, rowPadSide, gap, followPad, text) =>
    pageAt(vw) - 2 * rowPadSide - 3 * gap - 40 - 44 - followBtn(followPad, text);
  const before360 = identityBefore(360, 8, 12, 16, 34);
  const before390 = identityBefore(390, 8, 12, 16, 34);
  assert.equal(before360, 94, "identity width at 360 before the fix");
  assert.equal(before390, 124, "identity width at 390 before the fix");
  assert.ok(app.includes("const narrowPeople = winW <= 560;"), "the narrow people row switch is missing");
  // Composition wave, 2026-10-26: the row is a card now (surface,
  // border, real padding, a 48px avatar), so the geometry this pin
  // recomputes changed on purpose. The property it guards has not:
  // the identity block still ends up far wider than the pre fix row
  // (94 at 360) because the Follow button stays off the row and the
  // gaps stay at two. The recomputation below uses the card's real
  // numbers: narrow side padding 12, gap 10, avatar 48, the 48
  // message button (raised from 44 to the 48 floor by the follow on
  // polish wave, 2026-10-28), and 1px of card border a side.
  assert.ok(app.includes('gap: narrowPeople ? 10 : 12, padding: narrowPeople ? "12px 12px" : "14px 14px"'), "the row does not tighten on narrow widths");
  const modal = slice(app, "function NetworkSearchModal(", "/* Commit 100 — the privacy panel.");
  assert.ok(modal.includes("width: 48, height: 48"), "the message control lost its 48px tap target");
  // 2026-10-23 (huge audit redo): the Follow button came off the row
  // entirely, following lives on the profile. The row is now avatar,
  // identity, and the one 48 round message button, two gaps in total,
  // so the identity block keeps everything the Follow button used to take.
  assert.ok(!modal.includes("toggleFollow(r)"), "a Follow toggle still rides on the row");
  const identity = (vw, rowPadSide, gap) => pageAt(vw) - 2 * rowPadSide - 2 * gap - 48 - 48 - 2;
  const after360 = identity(360, 12, 10);
  const after390 = identity(390, 12, 10);
  assert.equal(after360, 156, "identity width at 360 after the fix");
  assert.equal(after390, 186, "identity width at 390 after the fix");
  assert.ok(after360 >= before360 + 30, "the fix does not buy real width at 360");
});

// ══════════════════════════════════════════════════════════════════
group("Item 16, WorkspacePage clears the fixed mobile header bar");

await test("mobile top padding is 64 against the 56px bar, desktop unchanged", () => {
  assert.ok(app.includes('padding: isMobile ? "64px 18px 56px" : "58px 32px 70px"'), "WorkspacePage padding pin moved");
  assert.ok(app.includes("height: 56, zIndex: Z.headerBar"), "the fixed header bar height pin moved");
  assert.equal(64 - 56, 8, "the breathing gap over the bar");
});

// ══════════════════════════════════════════════════════════════════
group("Item 18, the autoplay veto button clears the mobile bottom nav");

await test("mobile lifts the play button to the 88px convention, desktop keeps 18px", () => {
  const btn = slice(app, 'aria-label="Play background video"', "The handoff bridge");
  assert.ok(btn.includes('bottom: isMobile ? "calc(88px + env(safe-area-inset-bottom, 0px))" : "max(18px, env(safe-area-inset-bottom))"'), "the play button bottom offset pin moved");
  const nav = slice(app, '<nav aria-label="Primary"', "</nav>");
  assert.ok(nav.includes("minHeight: 64"), "the bottom nav height pin moved");
  assert.ok(88 > 64, "88px must clear the 64px nav before the safe area inset, which both sides add");
  assert.ok(app.includes('bottom: isMobile ? "calc(88px + env(safe-area-inset-bottom, 0px))" : "max(24px, env(safe-area-inset-bottom))"'), "the toast host 88px convention this follows is gone");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
