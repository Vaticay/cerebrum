const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const {parse} = require('@babel/parser');
const {transformSync} = require('esbuild');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync('src/CerebrumApp.jsx','utf8');
const dsSource = fs.readFileSync('src/designSystem.jsx','utf8');
const fcSource = fs.readFileSync('src/flowcharts.jsx','utf8');
const ast = parse(source,{sourceType:'module',plugins:['jsx']});
const dsAst = parse(dsSource,{sourceType:'module',plugins:['jsx']});
const fcAst = parse(fcSource,{sourceType:'module',plugins:['jsx']});
const names = ['AskModePicker','ProfileMarkers','CitationPeek','IncomingCall'];
const dsNames = ['UIButton','UICard'];
const functions = ast.program.body.filter(n=>n.type==='FunctionDeclaration' && names.includes(n.id.name));
const dsFunctions = dsAst.program.body
  .map(n=>n.type==='ExportNamedDeclaration' ? n.declaration : n)
  .filter(n=>n && n.type==='FunctionDeclaration' && dsNames.includes(n.id.name));
const fcFunctions = fcAst.program.body
  .map(n=>n.type==='ExportNamedDeclaration' ? n.declaration : n)
  .filter(n=>n && n.type==='FunctionDeclaration' && n.id.name==='Dialog');
assert.equal(functions.length + dsFunctions.length + fcFunctions.length,7);
const js=transformSync(functions.map(n=>source.slice(n.start,n.end)).join('\n')+'\n'+dsFunctions.map(n=>dsSource.slice(n.start,n.end)).join('\n')+'\n'+fcFunctions.map(n=>fcSource.slice(n.start,n.end)).join('\n'),{loader:'jsx',jsx:'transform'}).code;
const context=vm.createContext({React,useEdgeMask:()=>[null,{}],ASK_MODES:[{key:'explain',label:'Explain',blurb:'Explain evidence',icon:'spark'},{key:'compare',label:'Compare',blurb:'Compare evidence',icon:'compare'}],Icon:()=>null,FONT_SIZES:{caption:13,small:14,micro:11,subhead:16},SP:{sm:8,lg:24},TYPE:{label:{}},RADIUS:{pill:999,lg:12},SHADOW:{xs:()=>'none',md:()=>'none'},STATUS:{bad:'#b44'},TRACKING:{eyebrow:"0.12em",eyebrowWide:"0.2em",label:"0.06em",labelTight:"0.04em",tight:"0.01em"},withAlpha:(c)=>c});
/* Extra stubs for the dialog-semantics renders below: the real React
   state/ref hooks (rendering is real; only effects are inert under a
   server renderer), the Dialog stack/scroll-lock module state, and the
   small helpers the two components close over. */
Object.assign(context,{
  useState:React.useState,useRef:React.useRef,useMemo:React.useMemo,useCallback:React.useCallback,useId:React.useId,
  useEffect:()=>{},useLayoutEffect:()=>{},
  createPortal:(children)=>children,
  document:{},
  cbDialogStack:[],cbDialogLockScroll:()=>{},cbDialogUnlockScroll:()=>{},cbMotionOff:()=>true,
  Z:{sheet:260,sheetScrim:258,modalTop:400},
  accentInk:(P,a)=>a,
  doiHref:(s)=>s&&s.doi?('https://doi.org/'+s.doi):null,
  safeHref:(u)=>u,
  avatarSkin:()=>({background:'#334',color:'#eef'}),
  useCallTone:()=>{},
});
context.FONT_SIZES.body=15; context.FONT_SIZES.label=13; context.FONT_SIZES.title=18;
context.RADIUS.md=8; context.RADIUS.sm=6; context.RADIUS.viewport=2; context.RADIUS.xl=16;
vm.runInContext(js,context);
const P0={dark:true,ink:'#eee',ink2:'#bbb',line:'#444',line2:'#555'};
// Markers render as inline text, not a badge wall: no pill containers,
// no decorative icons — just the labels separated by middots, each with
// a tooltip explaining the criterion.
{
 const markers=renderToStaticMarkup(React.createElement(context.ProfileMarkers,{P:P0,accent:'#A3B899',markers:[
  {key:'founder',label:'Founder & Owner',title:'Founder — built Cerebrum'},
  {key:'verified',label:'Verified',title:'Verified — this account\'s identity was confirmed'},
  {key:'early_adopter',label:'Early adopter',title:'Early adopter — here since the public beta'},
 ]}));
 assert.match(markers,/Founder &amp; Owner/);
 assert.match(markers,/title="Verified — this account&#x27;s identity was confirmed"/);
 assert.match(markers,/Early adopter/);
 assert.doesNotMatch(markers,/border-radius/);
 const empty=renderToStaticMarkup(React.createElement(context.ProfileMarkers,{P:P0,accent:'#A3B899',markers:[]}));
 assert.equal(empty,'');
}
console.log('Markers render as inline text with tooltips.');
for(const dark of [true,false])for(const isMobile of [true,false]){
 const P={dark,ink:'#eee',ink2:'#bbb',line:'#444',line2:'#555'};
 const modes=renderToStaticMarkup(React.createElement(context.AskModePicker,{mode:'explain',setMode:()=>{},P,accent:'#A3B899',isMobile}));
 assert.match(modes,/aria-pressed="true"/); assert.match(modes,/Compare/);
 for(const variant of ['primary','secondary','ghost','destructive']){
  const button=renderToStaticMarkup(React.createElement(context.UIButton,{P,accent:'#A3B899',at:'#111',variant},'Continue'));
  assert.match(button,new RegExp('cb-glass-action--'+variant));
 }
 assert.match(renderToStaticMarkup(React.createElement(context.UICard,{P},'Evidence')),/Evidence/);
}
console.log('Actual search-mode, shared-button and card components render in dark/light and mobile/desktop variants.');

/* ── Mobile dialog semantics, render level ─────────────────────────────
   What this is: the REAL CitationPeek (mobile branch), the REAL Dialog
   primitive it now renders through, and the REAL IncomingCall, run
   through the real React server renderer, asserting the dialog
   semantics in the shipped markup.
   What this is NOT: a layout test or a focus test. A server renderer
   runs no effects and measures nothing, so focus movement, the Tab
   trap, Escape handling, and hit-area geometry cannot be exercised
   here — this repo has no DOM harness (no jsdom, happy-dom, or
   browser driver in node_modules) that could run them, and none was
   installed to fake one. The focus contract itself lives in the Dialog
   primitive and is pinned by reading it; this block pins that the
   mobile surfaces actually render THROUGH that contract's markup. */
{
 const P={dark:true,ink:'#eee',ink2:'#bbb',faint:'#999',line:'#444',line2:'#555',surface:'#1a1a1a',raised:'#222',bg:'#111'};
 const src={title:'Sleep and memory consolidation',journal:'Nature',year:2024,doi:'10.1000/xyz123',url:'https://example.org/paper',tldr:'A study of sleep and memory.'};
 const peek=renderToStaticMarkup(React.createElement(context.CitationPeek,{n:1,sources:[src],P,accent:'#A3B899',onOpen:()=>{},onClose:()=>{},isMobile:true}));
 // The mobile citation sheet is the Dialog primitive: exactly one
 // dialog, modal, accessibly named for its source.
 assert.equal((peek.match(/role="dialog"/g)||[]).length,1,'the peek renders exactly one dialog');
 assert.match(peek,/aria-modal="true"/);
 assert.match(peek,/aria-label="Source 1"/);
 // Sheet geometry survived the move onto the primitive.
 assert.match(peek,/border-radius:18px 18px 0 0/);
 // The sheet's real content renders inside the dialog.
 assert.match(peek,/Sleep and memory consolidation/);
 assert.match(peek,/Deep read/);
 assert.match(peek,/Close source preview/);
 console.log('Mobile citation sheet renders through the Dialog primitive with modal semantics and its content.');

 const call=renderToStaticMarkup(React.createElement(context.IncomingCall,{call:{fromName:'Ada Lovelace',fromId:'u1'},P,accent:'#A3B899',at:'#111',isMobile:true,onAccept:()=>{},onDecline:()=>{}}));
 assert.match(call,/role="dialog"/);
 assert.match(call,/aria-modal="true"/);
 assert.match(call,/aria-label="Incoming call from Ada Lovelace"/);
 // The panel itself is the focus target on mount (tabIndex -1).
 assert.match(call,/tabindex="-1"/);
 assert.match(call,/Accept/);
 assert.match(call,/Decline/);
 console.log('Incoming call card renders as a modal dialog with a focusable panel and both actions.');
}
