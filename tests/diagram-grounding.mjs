/**
 * Diagram Studio grounding contract (huge audit fix, 2026 10 23).
 *
 * The contract, in plain words:
 *   1. A step owns its label, kind, detail, and source as one object.
 *      Editing, moving, inserting, or deleting steps can never move a
 *      citation onto a step it did not come from.
 *   2. A saved diagram reopens with exactly the sources it was saved
 *      with. A record with no sources field loads an empty source
 *      list, never one borrowed from whatever was active.
 *   3. A save with no labelled step is refused before any allowance
 *      is consumed.
 *   4. The Decision kind is gone until the model can hold two exits,
 *      and older branching charts are flagged for conversion instead
 *      of being silently rewritten.
 *
 * Unit tests against the real pure helpers in src/fcLabel.js, plus
 * static wiring assertions in the same style as flowchart-sync.mjs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  FC_LABEL_MAX, fcWrapBounded, fcCoerceStepType, fcStepsFromChart,
  fcChartSources, fcHasLabelledStep, fcMoveStep, fcChartNeedsConversion,
  fcSplitSentences, fcLabelFromSentence, fcBuildChain,
} = await import(join(root, 'src/fcLabel.js'));

// ── 1. Grounding follows the step object ─────────────────────────────
const paperA = { title: 'Paper A', year: 2021 };
const paperB = { title: 'Paper B', year: 2022 };
const sources = [paperA, paperB];
const s1 = { id: 's1', label: 'First step', type: 'evidence', detail: 'Sentence from paper A.', sourceIdx: 0 };
const s2 = { id: 's2', label: 'Second step', type: 'evidence', detail: 'Sentence from paper B.', sourceIdx: 1 };
const s3 = { id: 's3', label: 'Third step', type: 'process', detail: '', sourceIdx: undefined };
let steps = [s1, s2, s3];

// Move step 3 to the top: every object travels whole.
steps = fcMoveStep(steps, 's3', -1);
steps = fcMoveStep(steps, 's3', -1);
assert.deepEqual(steps.map((x) => x.id), ['s3', 's1', 's2']);
assert.equal(steps[1], s1, 'the step object itself moves, nothing is rebuilt by position');
assert.equal(steps[1].sourceIdx, 0);
assert.equal(steps[2].detail, 'Sentence from paper B.');
assert.equal(sources[steps[2].sourceIdx], paperB, 'step 2 still cites paper B after the move');

// Delete the middle step and insert a fresh one at the top: the
// surviving grounded steps keep their own detail and source.
steps = steps.filter((x) => x.id !== 's1');
steps = [{ id: 's0', label: 'New first', type: 'process', detail: '', sourceIdx: undefined }, ...steps];
assert.equal(steps.find((x) => x.id === 's2').sourceIdx, 1);
assert.equal(steps.find((x) => x.id === 's2').detail, 'Sentence from paper B.');
assert.equal(steps.find((x) => x.id === 's0').sourceIdx, undefined, 'a new step starts ungrounded');

// Moving past either end is a no op, and an unknown id changes nothing.
assert.deepEqual(fcMoveStep([s1, s2], 's1', -1).map((x) => x.id), ['s1', 's2']);
assert.deepEqual(fcMoveStep([s1, s2], 'nope', 1).map((x) => x.id), ['s1', 's2']);

// ── 2. A record round trips its sources through save and reopen ──────
const makeNode = (type, x, y, label, extra = {}) => ({
  id: 'tmp', type, x, y, w: 200, h: 92, label, ...extra,
});
const chain = fcBuildChain([s2, s3], 'across', makeNode);
const record = {
  id: 'chart-1', title: 'Round trip', nodes: chain.nodes, edges: chain.edges,
  sources, direction: 'across', updatedAt: 123,
};
// The server blob shape: everything except id and title rides in one
// JSON blob (functions/api/data.js). Simulate the write and the read.
const blob = JSON.parse(JSON.stringify({
  nodes: record.nodes, edges: record.edges, sources: record.sources, direction: record.direction,
}));
const reopened = { id: record.id, title: record.title, ...blob };
assert.deepEqual(fcChartSources(reopened), sources, 'sources come back exactly as saved');
const reopenedSteps = fcStepsFromChart(reopened);
assert.equal(reopenedSteps.length, 2);
assert.equal(reopenedSteps[0].label, 'Second step');
assert.equal(reopenedSteps[0].detail, 'Sentence from paper B.');
assert.equal(reopenedSteps[0].sourceIdx, 1);
assert.equal(fcChartSources(reopened)[reopenedSteps[0].sourceIdx].title, 'Paper B',
  'the inspector resolves the reopened step to the paper it was saved with');
assert.equal(reopened.direction, 'across', 'direction round trips on the record');

// ── 2b. A missing sources field loads an empty source list ───────────
assert.deepEqual(fcChartSources({ id: 'old', nodes: [], edges: [] }), []);
assert.deepEqual(fcChartSources({ sources: 'not-an-array' }), []);
assert.deepEqual(fcChartSources(null), []);
assert.deepEqual(fcChartSources(undefined), []);
// Even with another chart's sources in hand, a chart without its own
// stored sources has none: the helper reads only the chart itself.
const otherChart = { sources: [paperA] };
assert.deepEqual(fcChartSources({ id: 'old', nodes: [] }), []);
assert.deepEqual(fcChartSources(otherChart), [paperA]);

// ── 3. An empty save is refused before allowance ─────────────────────
assert.equal(fcHasLabelledStep([]), false);
assert.equal(fcHasLabelledStep([{ label: '   ' }]), false);
assert.equal(fcHasLabelledStep([{ label: '', type: 'process' }, { label: ' ', type: 'evidence' }]), false);
assert.equal(fcHasLabelledStep([{ type: 'start', label: 'Start' }, { type: 'end', label: 'End' }]), false);
assert.equal(fcHasLabelledStep([{ label: 'One real step' }]), true);

const appSrc = fs.readFileSync(join(root, 'src/CerebrumApp.jsx'), 'utf8');
const handlerStart = appSrc.indexOf('const saveDiagramRecord');
const handler = appSrc.slice(handlerStart, appSrc.indexOf('const handleSidebarCloseMobile', handlerStart));
assert.ok(handler.length > 0, 'saveDiagramRecord must exist');
assert.ok(handler.indexOf('hasLabelledStep') >= 0, 'the shared handler checks for a labelled step');
assert.ok(handler.indexOf('hasLabelledStep') < handler.indexOf('flowchart-allow'),
  'the empty check runs before the allowance call, so an empty save consumes nothing');
assert.ok(handler.includes('reason: "empty"'), 'an empty save returns the empty reason');
assert.ok(handler.includes('sources: Array.isArray(sources) ? sources : []'),
  'the record always carries a sources array, even an empty one');
assert.ok(handler.includes('direction: direction === "across" ? "across" : "down"'),
  'the record carries the direction');
// A network failure during the allowance check is a connection error,
// never the plan path: the catch returns network before openPro runs.
const catchIdx = handler.indexOf('catch { return { ok: false, reason: "network" }; }');
assert.ok(catchIdx >= 0, 'an allowance request failure returns the network reason');
assert.ok(handler.indexOf('openPro(') > catchIdx, 'the plan path opens only after a real denial');
assert.ok(handler.includes('synced: true') && handler.includes('syncError: true'),
  'the handler reports whether the account copy actually landed');

// ── 4. Decision kind, legacy charts, labels ──────────────────────────
assert.equal(fcCoerceStepType('decision'), 'process', 'old decision steps load as process');
assert.equal(fcCoerceStepType('evidence'), 'evidence');
assert.equal(fcCoerceStepType('io'), 'process');
const decisionChart = {
  nodes: [
    { id: 'a', type: 'decision', label: 'Pick one', x: 0, y: 0 },
    { id: 'b', type: 'process', label: 'Do it', x: 0, y: 200 },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b', label: '' }],
};
assert.equal(fcStepsFromChart(decisionChart)[0].type, 'process');

const simpleChain = {
  nodes: [
    { id: 'a', type: 'process', label: 'One', x: 0, y: 0 },
    { id: 'b', type: 'process', label: 'Two', x: 0, y: 200 },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b', label: '' }],
};
assert.equal(fcChartNeedsConversion(simpleChain), false, 'a simple chain opens normally');
const branching = {
  nodes: simpleChain.nodes,
  edges: [
    { id: 'e1', from: 'a', to: 'b', label: '' },
    { id: 'e2', from: 'a', to: 'b', label: '' },
  ],
};
assert.equal(fcChartNeedsConversion(branching), true, 'a chart with two exits from one node is flagged');
const labelledEdge = { nodes: simpleChain.nodes, edges: [{ id: 'e1', from: 'a', to: 'b', label: 'yes' }] };
assert.equal(fcChartNeedsConversion(labelledEdge), true, 'a labelled arrow is flagged');
const ioChart = { nodes: [{ id: 'a', type: 'io', label: 'In', x: 0, y: 0 }], edges: [] };
assert.equal(fcChartNeedsConversion(ioChart), true, 'an input or output kind is flagged');

// Long labels wrap inside a bounded box: bounded line count, and no
// line longer than the wrap width.
const longLabel = 'word '.repeat(60).trim();
const wrapped = fcWrapBounded(longLabel, 24, 5);
assert.ok(wrapped.length <= 5, 'wrap respects the line budget');
assert.ok(wrapped.every((ln) => ln.length <= 24), 'no wrapped line exceeds the width');
assert.ok(fcLabelFromSentence(longLabel).length <= FC_LABEL_MAX, 'hand picked sentence labels stay within the limit');

// Extraction fallback material: plain sentences with their citations.
const sents = fcSplitSentences('The larvae grew on waste oil [2]. Yields rose over ten days [1, 2].');
assert.equal(sents.length, 2);
assert.deepEqual(sents[0].cites, [2]);
assert.deepEqual(sents[1].cites, [1, 2]);

// ── Wiring: the studio and the server keep the contract ──────────────
const studioSrc = fs.readFileSync(join(root, 'src/flowcharts.jsx'), 'utf8');
assert.ok(!studioSrc.includes('onWriteChange'), 'the positional Write it editor is gone');
assert.ok(!studioSrc.includes('value="decision"'), 'the Decision kind is not offered');
assert.ok(studioSrc.includes('fcChartSources(chart)'), 'the studio loader reads sources from the chart record only');
assert.ok(studioSrc.includes('fcChartSources(initial)'), 'the boot loader reads sources from the record only');
assert.ok(studioSrc.includes('saveInFlightRef'), 'doSave carries a synchronous in flight guard');
assert.ok(studioSrc.includes('fcMoveStep'), 'reorder moves the step object as a unit');
assert.ok(studioSrc.includes('maxLength={FC_LABEL_MAX}'), 'step labels carry the length limit at input');

const dataSrc = fs.readFileSync(join(root, 'functions/api/data.js'), 'utf8');
assert.ok(dataSrc.includes('JSON.stringify({ nodes, edges, sources, direction })'),
  'the server flowchart blob persists sources and direction');
assert.ok(dataSrc.includes('sources: Array.isArray(blob.sources) ? blob.sources : []'),
  'the server flowchart read returns the stored sources');
assert.ok(dataSrc.includes('direction: blob.direction === "across" ? "across" : "down"'),
  'the server flowchart read returns the stored direction');

// ── 5. The sync merge never lets a sourceless copy win (mobile item 1) ──
// mergeFlowcharts exists in two files: the exported copy in
// src/flowcharts.jsx and the app copy in src/CerebrumApp.jsx that the
// sign in path actually runs. Extract and exercise both, the same
// AST pattern flowchart-sync.mjs uses.
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { transformSync } from 'esbuild';

function extractMerge(file) {
  const src = fs.readFileSync(join(root, file), 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const node = ast.program.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'mergeFlowcharts');
  assert.ok(node, `mergeFlowcharts must be declared in ${file}`);
  const js = transformSync(src.slice(node.start, node.end), { loader: 'js' }).code;
  const context = vm.createContext({});
  vm.runInContext(js, context);
  return context.mergeFlowcharts;
}

for (const file of ['src/flowcharts.jsx', 'src/CerebrumApp.jsx']) {
  const merge = extractMerge(file);
  const serverBare = [{ id: 'a', title: 'Server A', updatedAt: 300, nodes: [], edges: [] }];
  const localGrounded = [{ id: 'a', title: 'Local A', updatedAt: 100, nodes: [], edges: [], sources, direction: 'across' }];
  const out = merge(serverBare, localGrounded);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Server A', `${file}: the account copy still wins other fields`);
  assert.deepEqual([...out[0].sources], sources, `${file}: sources survive from the copy that has them`);
  assert.equal(out[0].direction, 'across', `${file}: direction survives from the copy that has it`);

  const serverGrounded = [{ id: 'a', title: 'Server A', updatedAt: 300, nodes: [], edges: [], sources: [paperB] }];
  const out2 = merge(serverGrounded, localGrounded);
  assert.deepEqual([...out2[0].sources], [paperB], `${file}: a grounded account copy keeps its own sources`);

  const out3 = merge(serverBare, [{ id: 'b', title: 'Local only', updatedAt: 50, nodes: [], edges: [], sources }]);
  assert.equal(out3.length, 2, `${file}: local only charts are kept`);
  assert.deepEqual([...out3.find((c) => c.id === 'b').sources], sources);
}

// ── 6. Mobile wiring: readable canvas, editor order, fields, share ──
assert.ok(studioSrc.includes('Math.max(Math.round(bounds.w * zoom), 640)'), 'the canvas keeps a 640 wide readable floor');
assert.ok(studioSrc.includes('touchAction: "none"') && studioSrc.includes('onCanvasTouchMove'), 'the canvas frame owns pinch and pan gestures');
assert.ok(studioSrc.includes('overscrollBehavior: "contain"'), 'the canvas frame does not hand scroll to the page');
assert.ok(studioSrc.includes('acrossTooSmall'), 'an Across diagram under the readable text size warns');
assert.ok(studioSrc.includes('isMobile ? "down"'), 'phones default to Down direction');
assert.ok(studioSrc.includes('{isMobile && kindSelect}') && studioSrc.includes('{!isMobile && kindSelect}'),
  'narrow step rows move the kind select to the second line');
assert.ok(studioSrc.includes('ds-step-') && studioSrc.includes('scrollIntoView'), 'selecting a node brings its editor row into view on phones');
assert.ok(studioSrc.includes('minHeight: 44'), 'studio fields stand at the 44 floor');
assert.ok(studioSrc.includes('initialFocus={topFocusRef}'), 'the dialog focuses a plain container, not the title input');
assert.ok(studioSrc.includes('exportWrapRef') && studioSrc.includes('navigator.share'), 'the export menu closes on outside taps and offers Share');

console.log('Diagram grounding: step identity, source round trip, empty save refusal, legacy flagging, sync merge, and wiring passed.');
