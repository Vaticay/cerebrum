/**
 * Flowchart label-language tests: fcCompressStep + fcExtractSteps.
 *
 * The compression contract is strict: labels may only DELETE words from
 * the source sentence. They must never invent, never cut mid-word, and
 * stay terse (<= 52 chars). Extraction must never invent steps and must
 * carry each step's real citation indices.
 *
 * Unit tests against the real module — no server, no network.
 * Run with: node tests/fc-label.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { fcCompressStep, fcExtractSteps } = await import(join(root, "src/fcLabel.js"));

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

// ══════════════════════════════════════════════════════════════════════════
group("fcCompressStep — terse, honest compression");

await test("strips leading filler phrases", () => {
  assert.equal(
    fcCompressStep("The study found that metformin lowers blood glucose."),
    "Metformin lowers blood glucose"
  );
  assert.equal(
    fcCompressStep("Researchers observed that sleep deprivation impairs memory consolidation."),
    "Sleep deprivation impairs memory consolidation"
  );
  assert.equal(
    fcCompressStep("Overall, the data show that exercise improves insulin sensitivity."),
    "Exercise improves insulin sensitivity"
  );
});

await test("drops parenthetical asides", () => {
  assert.equal(
    fcCompressStep("Metformin (a biguanide) lowers hepatic glucose output."),
    "Metformin lowers hepatic glucose output"
  );
});

await test("short labels pass through nearly untouched", () => {
  assert.equal(fcCompressStep("Lower glucose output"), "Lower glucose output");
  assert.equal(fcCompressStep(""), "");
});

await test("long labels compress to the cap without mid-word cuts", () => {
  const long =
    "The randomized trial demonstrated that high-intensity interval training significantly reduced visceral adipose tissue in sedentary adults with metabolic syndrome.";
  const out = fcCompressStep(long);
  assert.ok(out.length <= 52, `too long (${out.length}): ${out}`);
  // No mid-word cut: every output word must appear whole in the input.
  const inputWords = new Set(long.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
  for (const w of out.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)) {
    assert.ok(inputWords.has(w), `invented or mangled word: "${w}" in "${out}"`);
  }
});

await test("compression only deletes words — never invents", () => {
  const inputs = [
    "It was found that chronic inflammation, which was measured via CRP, predicted cardiovascular events in the cohort.",
    "Results indicated that participants who received the intervention showed greater improvement than controls; the effect persisted at follow-up.",
    "In summary, the evidence suggests that Mediterranean diets reduce all-cause mortality among older adults with hypertension.",
  ];
  for (const input of inputs) {
    const out = fcCompressStep(input);
    assert.ok(out.length <= 52, `too long: ${out}`);
    const inputWords = new Set(input.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
    for (const w of out.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)) {
      assert.ok(inputWords.has(w), `word not in source: "${w}" (from "${input}")`);
    }
  }
});

await test("deterministic: same input, same label", () => {
  const s = "The authors concluded that early treatment prevents complications in high-risk patients.";
  assert.equal(fcCompressStep(s), fcCompressStep(s));
});

await test("never leaves a label dangling on a function word", () => {
  const out = fcCompressStep(
    "It was observed that high-dose statins lowered LDL cholesterol by an additional 15 percent in the treatment arm."
  );
  assert.ok(out.length <= 52, `too long: ${out}`);
  assert.ok(!/\b(a|an|the|by|to|of|in|for|with|on|at|from|and|or|via|than|as)$/i.test(out),
    `dangling function word: "${out}"`);
});

await test("keeps the first clause across strong breaks", () => {
  const out = fcCompressStep("Vaccination reduced hospitalizations; boosters extended protection into winter.");
  assert.ok(out.toLowerCase().includes("vaccination"), `lost the head clause: ${out}`);
  assert.ok(out.length <= 52, `too long: ${out}`);
});

// ══════════════════════════════════════════════════════════════════════════
group("fcExtractSteps — grounded step extraction");

await test("extracts list items without inventing steps", () => {
  const steps = fcExtractSteps("- Recruit participants\n- Randomize to arms\n- Measure outcomes at 12 weeks");
  assert.equal(steps.length, 3);
  assert.equal(steps[0].text, "Recruit participants");
  assert.deepEqual(steps[0].cites, []);
});

await test("captures 1-based citation indices per step", () => {
  const steps = fcExtractSteps("- Metformin lowers glucose [1, 2].\n- Insulin rises after meals [3].");
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].cites, [1, 2]);
  assert.deepEqual(steps[1].cites, [3]);
  assert.ok(!steps[0].text.includes("["), "citation leaked into step text");
});

await test("deduplicates repeated steps", () => {
  const steps = fcExtractSteps("- Measure blood pressure\n- Measure blood pressure\n- Record heart rate");
  assert.equal(steps.length, 2);
});

await test("falls back to sequence markers", () => {
  const steps = fcExtractSteps("First, prepare the sample carefully. Then, heat it to 90 degrees.");
  assert.ok(steps.length >= 2, `expected sequence steps, got ${steps.length}`);
});

await test("empty or garbage input yields no steps", () => {
  assert.deepEqual(fcExtractSteps(""), []);
  assert.deepEqual(fcExtractSteps(null), []);
  assert.deepEqual(fcExtractSteps("hi"), []);
});

await test("caps the step count", () => {
  const many = Array.from({ length: 20 }, (_, i) => `- Step number ${i + 1} here`).join("\n");
  assert.ok(fcExtractSteps(many, 7).length <= 7, "step cap not respected");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
