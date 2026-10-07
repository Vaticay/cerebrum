import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { transformSync } from 'esbuild';

// mergeFlowcharts lives in src/CerebrumApp.jsx (same pattern as the
// saveInvestigation test: extract the function declaration via AST and run
// it in a bare VM context, no React needed).
const appSource = fs.readFileSync('src/CerebrumApp.jsx', 'utf8');
const ast = parse(appSource, { sourceType: 'module', plugins: ['jsx'] });
const node = ast.program.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'mergeFlowcharts');
assert.ok(node, 'mergeFlowcharts must be declared in src/CerebrumApp.jsx');
const js = transformSync(appSource.slice(node.start, node.end), { loader: 'js' }).code;
const context = vm.createContext({});
vm.runInContext(js, context);
const { mergeFlowcharts } = context;
assert.equal(typeof mergeFlowcharts, 'function');

// Server charts win on id conflicts; local-only charts are kept; most-recent-first.
const server = [
  { id: 'a', title: 'Server A', updatedAt: 100, nodes: [{ id: 'n1' }], edges: [] },
  { id: 'b', title: 'Server B', updatedAt: 300, nodes: [], edges: [] },
];
const local = [
  { id: 'b', title: 'Stale local B', updatedAt: 50, nodes: [], edges: [] },
  { id: 'c', title: 'Local only C', updatedAt: 200, nodes: [], edges: [] },
];
const merged = mergeFlowcharts(server, local);
assert.equal(merged.length, 3, 'local-only chart must survive the merge');
// NB: merged lives in the vm realm, so spread into main-realm arrays
// before deepStrictEqual (cross-realm prototypes never compare equal).
assert.deepEqual([...merged.map((c) => c.id)], ['b', 'c', 'a'], 'sorted by updatedAt desc');
assert.equal(merged.find((c) => c.id === 'b').title, 'Server B', 'server wins id conflicts');

// Empty / missing inputs never throw and yield an empty list.
assert.deepEqual([...mergeFlowcharts(null, null)], []);
assert.deepEqual([...mergeFlowcharts([], undefined)], []);
assert.deepEqual([...mergeFlowcharts(server, 'not-an-array').map((c) => c.id)], ['b', 'a']);
const nulls = mergeFlowcharts([{ id: 'x', updatedAt: 1 }], [null, undefined, { id: 'x', updatedAt: 2 }]);
assert.equal(nulls.length, 1, 'null entries filtered, server id wins');

// Charts without updatedAt sort last, stably.
const noTs = mergeFlowcharts([{ id: 'n' }], [{ id: 'm', updatedAt: 5 }]);
assert.deepEqual([...noTs.map((c) => c.id)], ['m', 'n']);

// ── Server endpoint shape (static assertions, same style as
// content-endpoints.mjs) ──────────────────────────────────────────────
const dataSrc = fs.readFileSync('functions/api/data.js', 'utf8');
assert.ok(dataSrc.includes('resource === "flowcharts"'), 'data.js must route the flowcharts resource');
assert.ok(dataSrc.includes('action === "replace-all"'), 'data.js must support replace-all for flowcharts');
assert.ok(dataSrc.includes('user_flowcharts'), 'data.js must read/write the user_flowcharts table');
assert.ok(dataSrc.includes('ensureFlowchartTable'), 'data.js must self-heal the flowchart table');
assert.ok(dataSrc.includes('MAX_FLOWCHARTS_PER_USER'), 'data.js must cap charts per user');
assert.ok(dataSrc.includes('MAX_CHART_JSON_LEN'), 'data.js must cap chart JSON size');

// Account deletion must purge the table.
const authSrc = fs.readFileSync('functions/api/auth.js', 'utf8');
assert.ok(authSrc.includes('DELETE FROM user_flowcharts WHERE user_id = ?'), 'delete-account must purge user_flowcharts');

// schema.sql is the canonical schema.
const schema = fs.readFileSync('schema.sql', 'utf8');
assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS user_flowcharts'), 'schema.sql must declare user_flowcharts');

// Client must pull on sign-in and push debounced.
assert.ok(appSource.includes('apiDataGet("flowcharts")'), 'handleAuthed must pull flowcharts');
assert.ok(appSource.includes('apiDataPost("flowcharts", { action: "replace-all"'), 'client must push flowcharts via replace-all');

console.log('Flowchart sync: merge logic, endpoint wiring, schema, and client sync passed.');
