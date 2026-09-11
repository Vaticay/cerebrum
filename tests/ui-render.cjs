const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const {parse} = require('@babel/parser');
const {transformSync} = require('esbuild');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync('src/CerebrumApp.jsx','utf8');
const ast = parse(source,{sourceType:'module',plugins:['jsx']});
const names = ['AskModePicker','UIButton','UICard'];
const functions = ast.program.body.filter(n=>n.type==='FunctionDeclaration' && names.includes(n.id.name));
assert.equal(functions.length,3);
const js=transformSync(functions.map(n=>source.slice(n.start,n.end)).join('\n'),{loader:'jsx',jsx:'transform'}).code;
const context=vm.createContext({React,useEdgeMask:()=>[null,{}],ASK_MODES:[{key:'explain',label:'Explain',blurb:'Explain evidence',icon:'spark'},{key:'compare',label:'Compare',blurb:'Compare evidence',icon:'compare'}],Icon:()=>null,FONT_SIZES:{caption:13,small:14},SP:{sm:8,lg:24},TYPE:{label:{}},RADIUS:{pill:999,lg:12},STATUS:{bad:'#b44'},withAlpha:(c)=>c});
vm.runInContext(js,context);
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
