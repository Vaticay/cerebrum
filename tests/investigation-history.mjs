import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { transformSync } from 'esbuild';

// saveInvestigation is deliberately inlined in src/CerebrumApp.jsx (a
// one-function module was a Cloudflare deployment hazard), so the test
// extracts it from the app source instead of importing a module.
const source = fs.readFileSync('src/CerebrumApp.jsx', 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const node = ast.program.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'saveInvestigation');
assert.ok(node, 'saveInvestigation must be declared in src/CerebrumApp.jsx');
const js = transformSync(source.slice(node.start, node.end), { loader: 'js' }).code;
const context = vm.createContext({});
vm.runInContext(js, context);
const { saveInvestigation } = context;
assert.equal(typeof saveInvestigation, 'function');

const old = Array.from({length:4},(_,i)=>({id:`old${i}`,title:`Old ${i}`,ts:i,turns:[{id:i,q:`Old ${i}`}]}));
const first = {id:10,q:'How do roots grow?',answer:'A cited answer',sources:[{title:'Root paper'}]};
const saved = saveInvestigation(old,[first],first.sources,100);
assert.equal(saved.length,5);assert.equal(saved[0].title,first.q);assert.equal(old.length,4);
const followup={id:11,q:'Explain that step',answer:'More detail'};
const updated=saveInvestigation(saved,[first,followup],first.sources,200);
assert.equal(updated.length,5);assert.equal(updated[0].id,saved[0].id);assert.equal(updated[0].turns.length,2);assert.equal(updated[0].ts,200);
const restored=JSON.parse(JSON.stringify(updated));
assert.equal(saveInvestigation(restored,[first,followup],first.sources,300).length,5);
assert.equal(saveInvestigation(updated,[],[],400),updated);
assert.equal(saveInvestigation(null,[first],[],500).length,1);
let many=[];for(let i=0;i<45;i++)many=saveInvestigation(many,[{id:i,q:`Question ${i}`}],[],i);
assert.equal(many.length,40);assert.equal(many[0].title,'Question 44');
console.log('Investigation history: new answers, follow-ups, restore, deduplication, empty input and retention passed.');
