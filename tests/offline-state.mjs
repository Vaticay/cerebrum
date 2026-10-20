/**
 * Shell offline state (2026-10-20, design audit M6).
 *
 * The shell had no connection handling at all: drop the connection and
 * a new search fired a doomed fetch that spun or ended in a raw
 * network error, with nothing on screen saying the app was offline.
 * This suite drives the shipped pieces end to end at the level this
 * repo's harnesses allow:
 *
 *   1. The REAL connection monitor (src/useOnlineStatus.js) against a
 *      fake event target: the mount reading comes from the injected
 *      online reading, an "offline" event flips it, an "online" event
 *      restores it, duplicate events do not renotify, and stop()
 *      detaches the listeners.
 *   2. The REAL OfflineNotice (src/offlineNotice.jsx), compiled with
 *      esbuild and run through the real React server renderer in a vm
 *      sandbox, the same bargain tests/ui-render.cjs makes: the
 *      component is real, only its token seams (TYPE, Z) are stubbed
 *      with their real values. The render is driven BY the monitor:
 *      render, fire offline on the fake target, render again and the
 *      notice is there with the honest wording; fire online and it
 *      clears itself with no dismissal.
 *   3. The copy itself: no dash character of any kind (hyphen
 *      included) anywhere in the notice or the offline search copy,
 *      and nothing that claims a save, a send, or a queue the app
 *      does not have.
 *   4. Source pins for the shell wiring the render harness cannot
 *      reach: the notice mount in App, the monitor hookup, the search
 *      guard landing in the named failure funnel before any fetch,
 *      and the offline entry in the search failure model.
 *
 * What this is NOT: a browser test. This repo has no DOM harness, so
 * real window events in a live page and the guard's runtime effect
 * inside App are pinned by reading (part 4), not executed. The
 * monitor and the notice, the two new pieces, are executed for real.
 *
 * Run with: node tests/offline-state.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";

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

/* Every dash character there is: hyphen minus, the Unicode hyphen and
   dash block, and the minus sign. Dusty's rule covers all of them in
   visible copy, not only the typed dashes the dash gate polices. */
const ANY_DASH = /[-‐-―−]/;

/* A fake event target with the window's listener shape. */
function fakeTarget() {
  const map = new Map();
  return {
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (map.has(type)) map.get(type).delete(fn);
    },
    fire(type) {
      for (const fn of [...(map.get(type) || [])]) fn({ type });
    },
    listenerCount(type) {
      return map.has(type) ? map.get(type).size : 0;
    },
  };
}

const { createConnectionMonitor } = await import(join(root, "src/useOnlineStatus.js"));

/* The real OfflineNotice, compiled and sandboxed the ui-render way:
   its import lines are dropped and the seams (React, TYPE, Z) are
   supplied with their real values. */
function loadOfflineNotice() {
  const src = readFileSync(join(root, "src/offlineNotice.jsx"), "utf8")
    .replace(/^import[^;]+;$/gm, "");
  const { code } = transformSync(src, { loader: "jsx", jsx: "transform", format: "cjs" });
  const context = vm.createContext({
    React,
    module: { exports: {} },
    exports: {},
    console,
    /* The real token values from src/designSystem.jsx. */
    TYPE: {
      label: { fontFamily: "var(--cb-font)", fontSize: 13, fontWeight: 500, letterSpacing: 0, lineHeight: 1.4 },
      body: { fontFamily: "var(--cb-font)", fontSize: 15, fontWeight: 400, letterSpacing: 0, lineHeight: 1.55 },
    },
    Z: { banner: 150 },
  });
  context.exports = context.module.exports;
  vm.runInContext(code, context);
  return context.module.exports;
}
const noticeModule = loadOfflineNotice();
const { OfflineNotice, OFFLINE_TITLE, OFFLINE_WORKS, OFFLINE_WAITS, OFFLINE_SEARCH_HEADLINE, OFFLINE_SEARCH_BODY } = noticeModule;

/* The Sage palette surface set, the values the shell passes as P. */
const P = { surface: "#151816", ink: "#f4f7f4", ink2: "#cbd5cd", faint: "#94a397", line: "rgba(139,168,136,0.12)", line2: "rgba(139,168,136,0.2)" };
const renderNotice = (online) => renderToStaticMarkup(React.createElement(OfflineNotice, { P, online }));

// ═══════════════════════════════════════════════════════════════════
group("Connection monitor: mount reading, offline and online events");

await test("the mount reading comes from the injected online reading", () => {
  const target = fakeTarget();
  let reading = false;
  const monitor = createConnectionMonitor({ target, readOnLine: () => reading });
  assert.equal(monitor.isOnline(), false, "an offline mount reading was not honored");
  reading = true;
  const monitor2 = createConnectionMonitor({ target, readOnLine: () => reading });
  assert.equal(monitor2.isOnline(), true, "an online mount reading was not honored");
});

await test("offline and online events flip the state and notify once per change", () => {
  const target = fakeTarget();
  const monitor = createConnectionMonitor({ target, readOnLine: () => true });
  const seen = [];
  monitor.subscribe((v) => seen.push(v));
  monitor.start();
  assert.equal(target.listenerCount("offline"), 1);
  assert.equal(target.listenerCount("online"), 1);
  target.fire("offline");
  assert.equal(monitor.isOnline(), false);
  target.fire("offline");
  assert.deepEqual(seen, [false], "a duplicate offline event renotified");
  target.fire("online");
  assert.equal(monitor.isOnline(), true);
  assert.deepEqual(seen, [false, true]);
  monitor.stop();
  assert.equal(target.listenerCount("offline"), 0);
  assert.equal(target.listenerCount("online"), 0);
  target.fire("offline");
  assert.equal(monitor.isOnline(), true, "events still landed after stop");
});

// ═══════════════════════════════════════════════════════════════════
group("Offline notice: driven by the monitor, renders offline, clears on return");

await test("the full path: online renders nothing, the drop renders the notice, the return clears it", () => {
  const target = fakeTarget();
  const monitor = createConnectionMonitor({ target, readOnLine: () => true });
  monitor.start();
  assert.equal(renderNotice(monitor.isOnline()), "", "the notice rendered while online");
  target.fire("offline");
  const html = renderNotice(monitor.isOnline());
  assert.match(html, /role="status"/, "the notice is not a status surface");
  assert.match(html, /data-cb-offline-notice="true"/);
  assert.ok(html.includes(OFFLINE_TITLE), "the offline title did not render");
  assert.ok(html.includes(OFFLINE_WORKS), "the what still works line did not render");
  assert.ok(html.includes(OFFLINE_WAITS), "the what waits line did not render");
  /* Solid opaque: the surface is the palette hex itself, never an
     rgba layer over content. */
  assert.ok(html.includes("background:#151816"), "the notice surface is not the solid palette surface");
  assert.ok(!/background:rgba/.test(html), "the notice surface is translucent");
  target.fire("online");
  assert.equal(renderNotice(monitor.isOnline()), "", "the notice did not clear itself when the connection returned");
  monitor.stop();
});

await test("the notice renders nothing without a palette and nothing while online", () => {
  assert.equal(renderToStaticMarkup(React.createElement(OfflineNotice, { P: null, online: false })), "");
  assert.equal(renderNotice(true), "");
});

// ═══════════════════════════════════════════════════════════════════
group("Offline copy: honest wording, no dash characters");

await test("no dash character of any kind in the notice or search copy", () => {
  for (const [name, copy] of Object.entries({ OFFLINE_TITLE, OFFLINE_WORKS, OFFLINE_WAITS, OFFLINE_SEARCH_HEADLINE, OFFLINE_SEARCH_BODY })) {
    assert.ok(typeof copy === "string" && copy.length > 0, `${name} is missing`);
    assert.ok(!ANY_DASH.test(copy), `${name} carries a dash character: ${copy}`);
  }
  const text = renderNotice(false).replace(/<[^>]+>/g, " ");
  assert.ok(!ANY_DASH.test(text), `rendered notice text carries a dash character: ${text}`);
});

await test("the wording says what works, what waits, and never claims a save, a send, or a queue", () => {
  assert.match(OFFLINE_WORKS, /Reading still works/);
  assert.match(OFFLINE_WORKS, /already loaded/);
  assert.match(OFFLINE_WAITS, /New searches, sync, and calls wait/);
  assert.match(OFFLINE_WAITS, /Nothing new is sent/);
  assert.match(OFFLINE_SEARCH_BODY, /Nothing was sent and nothing was queued/);
  const all = [OFFLINE_TITLE, OFFLINE_WORKS, OFFLINE_WAITS, OFFLINE_SEARCH_HEADLINE, OFFLINE_SEARCH_BODY].join(" ");
  assert.ok(!/has been saved|was saved|saved successfully|sent successfully|will be sent|queued for delivery/i.test(all),
    "the copy claims a save, a send, or a delivery the app does not perform");
});

// ═══════════════════════════════════════════════════════════════════
group("Shell wiring: mount, hookup, and the offline search guard (source pins)");

const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

await test("App mounts the monitor hook, the ref mirror, and the notice", () => {
  assert.match(appSrc, /import \{ useOnlineStatus \} from "\.\/useOnlineStatus\.js";/);
  assert.match(appSrc, /import \{ OfflineNotice, OFFLINE_SEARCH_HEADLINE, OFFLINE_SEARCH_BODY \} from "\.\/offlineNotice\.jsx";/);
  assert.match(appSrc, /const online = useOnlineStatus\(\);/);
  assert.match(appSrc, /useEffect\(\(\) => \{ onlineRef\.current = online; \}, \[online\]\);/);
  assert.match(appSrc, /<OfflineNotice P=\{P\} online=\{online\} \/>/);
});

await test("a search attempted offline lands in the named failure funnel before any fetch", () => {
  const guard = /if \(!onlineRef\.current\) \{ clearTimeout\(askTimeout\); failSearch\("offline"\); return; \}/;
  assert.match(appSrc, guard, "the offline search guard is missing");
  const guardAt = appSrc.search(guard);
  const firstFetchAt = appSrc.indexOf('fetch("/api/videos"');
  assert.ok(firstFetchAt > guardAt, "a search fetch sits before the offline guard");
  assert.match(appSrc, /case "offline":/, "searchErrorInfo has no offline case");
  assert.match(appSrc, /return \{ headline: OFFLINE_SEARCH_HEADLINE, body: OFFLINE_SEARCH_BODY, detail: "" \};/,
    "the offline failure does not use the shared notice copy");
  assert.match(appSrc, /offline: \["retry"\]/, "the offline failure offers no retry recovery");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
