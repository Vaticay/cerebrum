const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const {parse} = require('@babel/parser');
const {transformSync} = require('esbuild');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync('src/CerebrumApp.jsx','utf8');
const dsSource = fs.readFileSync('src/designSystem.jsx','utf8');
const ast = parse(source,{sourceType:'module',plugins:['jsx']});
const dsAst = parse(dsSource,{sourceType:'module',plugins:['jsx']});
const names = ['AskModePicker','ProfileMarkers'];
const dsNames = ['UIButton','UICard'];
const functions = ast.program.body.filter(n=>n.type==='FunctionDeclaration' && names.includes(n.id.name));
const dsFunctions = dsAst.program.body
  .map(n=>n.type==='ExportNamedDeclaration' ? n.declaration : n)
  .filter(n=>n && n.type==='FunctionDeclaration' && dsNames.includes(n.id.name));
assert.equal(functions.length + dsFunctions.length,4);
const js=transformSync(functions.map(n=>source.slice(n.start,n.end)).join('\n')+'\n'+dsFunctions.map(n=>dsSource.slice(n.start,n.end)).join('\n'),{loader:'jsx',jsx:'transform'}).code;
const context=vm.createContext({React,useEdgeMask:()=>[null,{}],ASK_MODES:[{key:'explain',label:'Explain',blurb:'Explain evidence',icon:'spark'},{key:'compare',label:'Compare',blurb:'Compare evidence',icon:'compare'}],Icon:()=>null,FONT_SIZES:{caption:13,small:14,micro:11,subhead:16},SP:{sm:8,lg:24},TYPE:{label:{}},RADIUS:{pill:999,lg:12},SHADOW:{xs:()=>'none',md:()=>'none'},STATUS:{bad:'#b44'},TRACKING:{eyebrow:"0.12em",eyebrowWide:"0.2em",label:"0.06em",labelTight:"0.04em",tight:"0.01em"},withAlpha:(c)=>c});
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
