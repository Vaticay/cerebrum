import assert from 'node:assert/strict';
import { contextAction, answerFromContext } from '../functions/lib/conversation.js';
import { onRequest } from '../functions/api/search.js';
for (const q of ['Can you give me a tldr of this', 'TL;DR', 'summarize that', 'make it shorter', 'explain that in simple language', 'put this into a table', 'translate it into Spanish', 'show me the sources']) assert.ok(contextAction(q), q);
for (const q of ['What is TLDR-seq?', 'Find more papers on this', 'Summarize photosynthesis', 'What about in humans?', 'Explain lignocellulose degradation step by step']) assert.equal(contextAction(q), null, q);
const sources = [{ title:'Original paper', url:'https://example.org/a', abstract:'Cellulose is degraded.' }, {title:'Second paper',url:'https://example.org/b'}];
const history = [{role:'user',content:'Explain lignocellulose.'},{role:'assistant',content:'A'.repeat(800)+' Important ending [2].',sources}];
let calls=0;
const env = { AI:{run:async (_model,args) => { calls++; assert.ok(args.messages[1].content.includes('Important ending')); return {response:'A brief summary [2].'}; }} };
const savedFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Unexpected network/retrieval request');};
try {
 const r=await answerFromContext('TLDR',history,env,'summary');assert.equal(r.sources[1].title,'Second paper');assert.equal(r.answer,'A brief summary [2].');assert.equal(calls,1);
 const req = () => new Request('https://askcerebrum.org/api/search',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://askcerebrum.org'},body:JSON.stringify({query:'Can you give me a tldr of this',history,pinnedSources:[{title:'Must not become citation one'}]})});
 const result=await onRequest({request:req(),env,waitUntil:()=>{}});assert.equal(result.status,200);const j=await result.json();assert.equal(j.responseKind,'context');assert.deepEqual(j.sourcesQueried,[]);assert.equal(j.sources[0].title,'Original paper');assert.equal(result.headers.get('cache-control'),'no-store');
 const unavailable=await onRequest({request:req(),env:{},waitUntil:()=>{}});assert.equal(unavailable.status,503);
 const invalid=await answerFromContext('TLDR',history,{AI:{run:async()=>({response:'Invented reference [9].'})}},'summary');assert.equal(invalid,null);
 const missing=await answerFromContext('TLDR',[],env,'summary');assert.match(missing.answer,/send the text/);
 const list=await answerFromContext('Show me the sources',history,{},'sources');assert.match(list.answer,/\[2\] Second paper/);
 const noSources=await answerFromContext('shorten it',[{role:'assistant',content:'An uncited answer.'}],{AI:{run:async()=>({response:'Short uncited answer.'})}},'summary');assert.deepEqual(noSources.sources,[]);
} finally {globalThis.fetch=savedFetch;}
console.log('Context follow-up regressions passed (routing, actual endpoint, citation order, full context, missing history, provider failure, invalid citations).');
