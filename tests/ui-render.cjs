const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const {parse} = require('@babel/parser');
const {transformSync} = require('esbuild');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync('src/CerebrumApp.jsx','utf8');
const ast = parse(source,{sourceType:'module',plugins:['jsx']});
const names = ['AskModePicker','UIButton','UICard','ProfileCover','coverDesign','ProfileStats'];
const functions = ast.program.body.filter(n=>n.type==='FunctionDeclaration' && names.includes(n.id.name));
assert.equal(functions.length,6);
const js=transformSync(functions.map(n=>source.slice(n.start,n.end)).join('\n'),{loader:'jsx',jsx:'transform'}).code;
const context=vm.createContext({React,useEdgeMask:()=>[null,{}],ASK_MODES:[{key:'explain',label:'Explain',blurb:'Explain evidence',icon:'spark'},{key:'compare',label:'Compare',blurb:'Compare evidence',icon:'compare'}],Icon:()=>null,FONT_SIZES:{caption:13,small:14,micro:11,subhead:16},SP:{sm:8,lg:24},TYPE:{label:{}},RADIUS:{pill:999,lg:12},STATUS:{bad:'#b44'},withAlpha:(c)=>c});
vm.runInContext(js,context);
// Profile covers: all eight named designs render as gradients, and a
// null/unknown stored value falls back to the graphite default — never a
// broken banner.
{
 const designs = ['aurora','graphite','ember','abyss','moss','violet','sandstone','signal'].map((n)=>context.coverDesign(n,'#A3B899'));
 assert.equal(new Set(designs).size,8);
 for (const d of designs) assert.match(d,/gradient/);
 assert.equal(context.coverDesign(null,'#A3B899'),context.coverDesign('graphite','#A3B899'));
 assert.equal(context.coverDesign('not-a-cover','#A3B899'),context.coverDesign('graphite','#A3B899'));
 const P={dark:true,ink:'#eee',ink2:'#bbb',line:'#444',line2:'#555'};
 const banner=renderToStaticMarkup(React.createElement(context.ProfileCover,{P,cover:null,accent:'#A3B899',height:120}));
 assert.match(banner,/aria-hidden="true"/);
 assert.match(banner,/height:120px/);
 const stats=renderToStaticMarkup(React.createElement(context.ProfileStats,{P,stats:[{label:'Followers',value:0},{label:'Following',value:3}]}));
 assert.match(stats,/Followers/); assert.match(stats,/>3</);
}
console.log('Profile covers render all eight designs with a graphite fallback; the stats row renders real counts.');
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
