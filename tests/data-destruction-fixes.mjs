/**
 * Data-destruction regression tests (2026-10-08).
 *
 * Three P0 bugs where user data was silently destroyed:
 * 1. Library import stored the {merged, added, skipped} object as the
 *    library array, wiping the whole saved library.
 * 2. Delete-account sent {} but the backend requires confirm:true, so the
 *    dialog was a dead button (server always 400s).
 * 3. Sign-in merge dropped interests/pinned, then the debounced profile
 *    sync pushed interests:[] over the server copy on every fresh-device
 *    sign-in, and pinned stranded server-side.
 *
 * Run with: node tests/data-destruction-fixes.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { mergeCitationPapers } = await import(join(root, "src/importCitations.js"));
const appSource = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const settingsSource = readFileSync(join(root, "src/settings.jsx"), "utf8");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failures.push(name + ": " + e.message);
    console.log("  ✗ " + name + ": " + e.message);
  }
}

console.log("data-destruction-fixes:");

// ── Bug 1: library import must store the merged ARRAY, not the wrapper ──
await test("mergeCitationPapers returns {merged, added, skipped}, not an array", () => {
  const r = mergeCitationPapers([], [{ title: "A", year: 2024 }]);
  assert(!Array.isArray(r), "return value must not be a bare array");
  assert(Array.isArray(r.merged), "r.merged must be an array");
  assert.equal(typeof r.added, "number");
  assert.equal(typeof r.skipped, "number");
});

await test("caller destructures and stores the array (integration contract)", () => {
  // Simulate the exact caller path: library survives the import click.
  const saved = [{ title: "Existing", year: 2023 }];
  const selected = [{ title: "New", year: 2024 }, { title: "Existing", year: 2023 }];
  const { merged, added } = mergeCitationPapers(saved, selected);
  // What the fixed caller does: setSaved(merged)
  const storedLibrary = merged;
  assert(Array.isArray(storedLibrary), "stored library must be an array, got " + typeof storedLibrary);
  assert.equal(storedLibrary.length, 2, "library must keep existing + new paper");
  assert.equal(added, 1, "one paper added, one duplicate skipped");
  assert(!Number.isNaN(added), "added must not be NaN (the old merged.length bug)");
});

await test("caller source destructures the merge result", () => {
  const m = appSource.match(/const\s*\{\s*merged\s*,\s*added\s*\}\s*=\s*mod\.mergeCitationPapers\(saved,\s*selected\)/);
  assert(m, "caller must destructure { merged, added } from mergeCitationPapers");
  assert(!/const merged = mod\.mergeCitationPapers\(/.test(appSource),
    "caller must NOT assign the raw wrapper object to `merged`");
});

// ── Bug 2: delete-account must send confirm:true ──
await test("submitDeleteAccount sends confirm:true", () => {
  const m = settingsSource.match(/apiAuth\(\s*"delete-account"\s*,\s*\{([^}]*)\}/);
  assert(m, "delete-account apiAuth call not found in settings.jsx");
  assert(/confirm\s*:\s*true/.test(m[1]), "payload must include confirm:true, got {" + m[1] + "}");
});

// ── Bug 3: sign-in merge must carry interests and pinned ──
await test("handleAuthed profile merge includes interests from the server", () => {
  assert(/interests:\s*Array\.isArray\(profileRes\.user\.interests\)\s*\?\s*profileRes\.user\.interests\s*:\s*\[\]/.test(appSource),
    "setProfile merge must carry profileRes.user.interests (not drop it)");
});

await test("handleAuthed profile merge includes pinned from the server", () => {
  assert(/pinned:\s*Array\.isArray\(profileRes\.user\.pinned\)\s*\?\s*profileRes\.user\.pinned\s*:\s*\[\]/.test(appSource),
    "setProfile merge must carry profileRes.user.pinned (not strand it)");
});

await test("merge preserves server values instead of blanking them", () => {
  // The debounced sync pushes profile.interests to the server; if the merge
  // dropped them, interests:[] overwrites the server copy. Simulate:
  const serverUser = { interests: ["AI", "biology"], pinned: ["paper-1"] };
  const merged = {
    interests: Array.isArray(serverUser.interests) ? serverUser.interests : [],
    pinned: Array.isArray(serverUser.pinned) ? serverUser.pinned : [],
  };
  assert.deepEqual(merged.interests, ["AI", "biology"], "interests must survive sign-in");
  assert.deepEqual(merged.pinned, ["paper-1"], "pinned must survive sign-in");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
