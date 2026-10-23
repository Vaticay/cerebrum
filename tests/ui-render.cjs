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
const tuSource = fs.readFileSync('src/textUtils.js','utf8');
const ast = parse(source,{sourceType:'module',plugins:['jsx']});
const dsAst = parse(dsSource,{sourceType:'module',plugins:['jsx']});
const fcAst = parse(fcSource,{sourceType:'module',plugins:['jsx']});
const tuAst = parse(tuSource,{sourceType:'module',plugins:['jsx']});
const names = [/* 2026-10-22 (simplify audit SH8): AskModePicker left the list because the component is deleted; the mode is set by the composer shapeshifter now, so there is no picker left to render */'ProfileMarkers','CitationPeek','IncomingCall','DocEvidenceTrail','answerTruncatedNote','DocStageHealth','stageState','TrendingHero','trendKind','trendProvenance','renderInlineMdLite','stripDanglingAsterisks','MediaFigure','TrendThumb',/* 2026-10-19 (S2, audit C3): CitationPeek renders its title through the shared inline renderer now, so the harness extracts the real chain */'renderTitleInline','renderInlineNodes','inlineTokens','speciesRuns','renderCleanTitle',/* 2026-10-22 (logic audit L7-2, L7-16): the real FactCheck receipt and the real buildEvidenceMap join the harness */'FactCheck','buildEvidenceMap'];
const dsNames = ['UIButton','UICard'];
const functions = ast.program.body.filter(n=>n.type==='FunctionDeclaration' && names.includes(n.id.name));
const dsFunctions = dsAst.program.body
  .map(n=>n.type==='ExportNamedDeclaration' ? n.declaration : n)
  .filter(n=>n && n.type==='FunctionDeclaration' && dsNames.includes(n.id.name));
const fcFunctions = fcAst.program.body
  .map(n=>n.type==='ExportNamedDeclaration' ? n.declaration : n)
  .filter(n=>n && n.type==='FunctionDeclaration' && n.id.name==='Dialog');
const tuDecls = tuAst.program.body
  .map(n=>n.type==='ExportNamedDeclaration' ? n.declaration : n)
  .filter(n=>n && ((n.type==='FunctionDeclaration' && (n.id.name==='renderCleanTitle' || n.id.name==='highlightKeywords')) || (n.type==='VariableDeclaration' && n.declarations.some(d=>d.id.name==='TITLE_SAFE_TAG_RE'))));
assert.equal(functions.length + dsFunctions.length + fcFunctions.length + tuDecls.length,26); // 2026-10-22: was 25, AskModePicker deleted (simplify audit SH8) makes 24, FactCheck and buildEvidenceMap added (logic audit L7-2, L7-16) makes 26
const js=transformSync(functions.map(n=>source.slice(n.start,n.end)).join('\n')+'\n'+dsFunctions.map(n=>dsSource.slice(n.start,n.end)).join('\n')+'\n'+fcFunctions.map(n=>fcSource.slice(n.start,n.end)).join('\n')+'\n'+tuDecls.map(n=>tuSource.slice(n.start,n.end)).join('\n'),{loader:'jsx',jsx:'transform'}).code;
const context=vm.createContext({React,useEdgeMask:()=>[null,{}],ASK_MODES:[{key:'explain',label:'Explain',blurb:'Explain evidence',icon:'spark'},{key:'compare',label:'Compare',blurb:'Compare evidence',icon:'compare'}],Icon:()=>null,FONT_SIZES:{caption:13,small:14,micro:11,subhead:16},SP:{sm:8,lg:24},TYPE:{label:{}},RADIUS:{pill:999,lg:12},SHADOW:{xs:()=>'none',md:()=>'none',xl:()=>'none'} /* 2026-10-18: Dialog calls SHADOW.xl (design audit C5) */,STATUS:{bad:'#b44',warn:'#B08B4F',good:'#7A9E7E'} /* 2026-10-20, readability residue wave: warn and good keys added beside bad because extracted components now read STATUS.warn and STATUS.good through withAlpha */,TRACKING:{eyebrow:"0.12em",eyebrowWide:"0.2em",label:"0.06em",labelTight:"0.04em",tight:"0.01em"},withAlpha:(c)=>c,
/* 2026-10-14, design overhaul wave 1: UIButton and UICard now close over
   the COLOR foundation tokens, so the sandbox carries the real values. */
COLOR:{ink:'#E8E6E3',ink2:'#A8A49E',faint:'#6B6762',accent:'#C4A35A',accentInk:'#121110',surface1:'#1C1B19',surface2:'#242320',field:'#161513',line:'#2E2C29',lineSubtle:'#252422',support:'#7A9E7E',caution:'#B08B4F'}});
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
  /* 2026-10-20, readability residue wave: DocEvidenceTrail label tones
     now route through the house status helpers (Worker B, item 2a and
     2d), so the sandbox provides them as fixed tones like accentInk. */
  statusBad:(P)=>'#b44',statusWarn:(P)=>'#B08B4F',statusGood:(P)=>'#7A9E7E',
  doiHref:(s)=>s&&s.doi?('https://doi.org/'+s.doi):null,
  safeHref:(u)=>u,
  avatarSkin:()=>({background:'#334',color:'#eef'}),
  useCallTone:()=>{},
});
context.FONT_SIZES.body=15; context.FONT_SIZES.label=13; context.FONT_SIZES.title=18;
/* 2026-10-14, wave 1: the radius scale is capped at 2, stubs follow. */
context.RADIUS.md=2; context.RADIUS.sm=2; context.RADIUS.viewport=2; context.RADIUS.xl=2;
/* TrendingHero stubs: no media (the resolver found nothing honest),
   no persistence label, and the helpers its provenance line closes
   over. Rendering is the real component; only these data seams are
   stubbed, the same bargain the dialog renders above make. */
context.SHADOW.sm=()=>'none'; context.TYPE.heading={letterSpacing:'0'};
context.trendingMediaOf=()=>null; context.trendPersistenceLabel=()=>''; context.relativeTime=()=>'2 days ago';
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
 for(const variant of ['primary','secondary','ghost','destructive']){
  const button=renderToStaticMarkup(React.createElement(context.UIButton,{P,accent:'#A3B899',at:'#111',variant},'Continue'));
  /* 2026-10-14, design overhaul wave 1: the glass action treatment is
     deleted, so the pin now checks the flat contract instead of the old
     cb-glass-action--<variant> class: every variant renders as a flat
     cb-press button with no glass class and no shadow, and the primary
     variant carries the flat accent as its background. */
  assert.match(button,/cb-press/);
  assert.doesNotMatch(button,/cb-glass-action/);
  assert.match(button,/box-shadow:none/);
  if(variant==='primary') assert.match(button,/background:#A3B899/);
 }
 assert.match(renderToStaticMarkup(React.createElement(context.UICard,{P},'Evidence')),/Evidence/);
}
console.log('Actual shared-button and card components render in dark/light and mobile/desktop variants.');

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
 /* 2026-10-18 (design audit M29): territory sheets take radius 2 like the desktop drawer. */
 assert.match(peek,/border-radius:2px 2px 0 0/);
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

/* ── Document Reader honesty surfaces, render level ──────────────────
   The REAL DocEvidenceTrail and answerTruncatedNote from
   CerebrumApp.jsx, rendered for real: the backend's evidence trail
   (functions/api/document.js) shows each quoted passage with its
   verified location, a normalized match is disclosed as a spacing
   difference, and an unverified quote is labelled not found with NO
   location printed, because its offsets are -1 and meaningless.
   The negative cases matter as much: an empty or absent trail
   renders nothing at all, and the cut short note is null when the
   flag is off. */
{
 const P={dark:true,ink:'#eee',ink2:'#bbb',faint:'#999',line:'#444',line2:'#555',warn:'#b98a2f'};
 const trail=renderToStaticMarkup(React.createElement(context.DocEvidenceTrail,{P,evidence:[
  {quote:'Fifteen minutes in urban green space measurably restored directed attention.',start:120,end:197,verified:true,match:'exact'},
  {quote:'Reaction time variability improved only in the park condition.',start:2048,end:2111,verified:true,match:'normalized'},
  {quote:'Attention was fully restored within two minutes of exposure.',start:-1,end:-1,verified:false,match:null},
 ]}));
 assert.match(trail,/Evidence from the document/);
 assert.match(trail,/Fifteen minutes in urban green space measurably restored directed attention\./);
 /* 2026-10-18 (design audit H18): verified entries render a jump control,
    never raw character offsets. */
 assert.match(trail,/Jump to this passage in the document/);
 assert.doesNotMatch(trail,/characters/);
 // Large offsets are formatted the way the surface formats counts.
 assert.match(trail,/with spacing that differs from the document/) /* the normalized note survives; its offsets do not */;
 assert.match(trail,/Attention was fully restored within two minutes of exposure\./);
 assert.match(trail,/Not found in the document\. Treat this quote with care\./);
 // The unverified entry's -1 offsets never reach the page.
 assert.doesNotMatch(trail,/characters -1/);
 console.log('Evidence trail renders exact, normalized, and unverified entries with honest locations.');

 // A trail of ONLY an unverified entry prints no location anywhere.
 const unv=renderToStaticMarkup(React.createElement(context.DocEvidenceTrail,{P,evidence:[
  {quote:'A passage the model invented out of whole cloth.',start:-1,end:-1,verified:false,match:null},
 ]}));
 assert.match(unv,/Not found in the document/);
 assert.doesNotMatch(unv,/characters/);
 // Negative cases: no entries, no trail, not even the heading.
 assert.equal(renderToStaticMarkup(React.createElement(context.DocEvidenceTrail,{P,evidence:[]})),'');
 assert.equal(renderToStaticMarkup(React.createElement(context.DocEvidenceTrail,{P,evidence:undefined})),'');
 assert.equal(renderToStaticMarkup(React.createElement(context.DocEvidenceTrail,{P})),'');
 console.log('Evidence trail renders nothing when the trail is empty or absent.');

 /* Note carrying entries were never CHECKED (the backend's note
    field: "too-long" past the per quote checking limit, "over-cap"
    past the trail's checked slots), so they render as not checked —
    the not found wording is reserved for entries that were checked
    and failed, like the unverified ones above. */
 const noted=renderToStaticMarkup(React.createElement(context.DocEvidenceTrail,{P,evidence:[
  {quote:'A passage longer than the checking limit allows anyone to verify.',start:-1,end:-1,verified:false,match:null,note:'too-long'},
  {quote:'A passage past the number of quotes the trail can check.',start:-1,end:-1,verified:false,match:null,note:'over-cap'},
 ]}));
 assert.match(noted,/This quote was not checked: it is longer than the checking limit\./);
 assert.match(noted,/This quote was not checked: there are more quotes than the trail can check\./);
 assert.doesNotMatch(noted,/Not found in the document/);
 assert.doesNotMatch(noted,/characters/);
 console.log('Noted evidence renders as not checked, never as not found.');

 // The cut short note: null when the flag is off (the render sites
 // then show nothing), the plain sentence when it is on.
 assert.equal(context.answerTruncatedNote(false,'answer'),null);
 assert.equal(context.answerTruncatedNote(undefined,'summary'),null);
 assert.equal(context.answerTruncatedNote(true,'answer'),'This answer was cut short at the length limit, so it may end abruptly.');
 assert.equal(context.answerTruncatedNote(true,'summary'),'This summary was cut short at the length limit, so it may end abruptly.');
 console.log('Cut short note is null when the flag is off and plain when it is on.');

 /* The REAL DocStageHealth: the document backend's per stage record
    (functions/api/document.js, docStageEntry) rendered as one quiet
    line per stage through the search answer's own stageState
    classification. A failed stage shows its state and its detail
    (the disclosures that live only in the record, like sections
    that could not be read), a skipped stage shows its skip reason
    in the line, and an empty or absent record renders nothing. */
 const health=renderToStaticMarkup(React.createElement(context.DocStageHealth,{P,stageHealth:[
  {name:'digest',ok:false,ms:3200,detail:'2 of 5 sections could not be read'},
  {name:'synthesis',ok:true,ms:1500},
  {name:'summary',ok:null,ms:0,skipReason:'token budget exhausted'},
 ]}));
 assert.match(health,/Pipeline health/);
 /* 2026-10-18 (design audit H17): passing stages render nothing, and
    failures and skips are one plain sentence each with human stage
    names, no timings, no model names, no raw stage names. */
 assert.match(health,/Reading the document in sections did not finish\. 2 of 5 sections could not be read\./);
 assert.match(health,/Writing the summary was skipped because the AI budget for this 5 day period is used up\./);
 assert.doesNotMatch(health,/synthesis|3\.2s|1\.5s/);
 console.log('Stage health renders failures and skips as plain sentences, passing stages not at all.');
 assert.equal(renderToStaticMarkup(React.createElement(context.DocStageHealth,{P,stageHealth:[]})),'');
 assert.equal(renderToStaticMarkup(React.createElement(context.DocStageHealth,{P,stageHealth:undefined})),'');
 assert.equal(renderToStaticMarkup(React.createElement(context.DocStageHealth,{P})),'');
 console.log('Stage health renders nothing when the record is empty or absent.');

 /* Parked legs: a stage entry's skippedLegs ([{ model, reason }])
    render as their own quiet lines under the stage, so a stage that
    passed still shows the legs it never fired and why. A stage
    without the field renders exactly as before. */
 const parked=renderToStaticMarkup(React.createElement(context.DocStageHealth,{P,stageHealth:[
  {name:'answer',ok:true,ms:900,skippedLegs:[{model:'model one',reason:'daily cap reached'},{model:'model two',reason:'parked for this run'}]},
  {name:'digest',ok:true,ms:1200},
 ]}));
 /* 2026-10-18 (design audit H17): parked legs are no longer listed,
    and a record whose stages all passed renders nothing at all. */
 assert.equal(parked,'');
 console.log('Stage health renders nothing for an all passing record, parked legs included.');
}

/* ── Call surfaces: the huddle's modal contract, pinned by reading ──
   VideoHuddle is not extracted above: its body drives live WebRTC
   machinery that a server render cannot exercise, and this repo has
   no DOM harness to run its effects (see the dialog semantics note
   at the top of this file). What CAN be pinned is that the contract
   is present in the shipped source, in the IncomingCall shape: the
   expanded huddle declares dialog + aria-modal, focus moves into
   the surface, Tab cycles inside it, Escape minimizes, and focus is
   restored on unmount. The IncomingCall accept glyph is likewise
   source pinned: the harness Icon stub renders nothing, so the
   rendered markup cannot show which icon was chosen. */
{
 const vhAt=source.indexOf('function VideoHuddle');
 assert.ok(vhAt>0,'VideoHuddle missing');
 const vh=source.slice(vhAt,source.indexOf('\nfunction InboxView',vhAt));
 assert.match(vh,/role=\{minimized \? "button" : "dialog"\} aria-modal=\{!minimized\}/,'the huddle no longer declares its modal state');
 assert.match(vh,/const huddleRef = useRef\(null\);/,'the huddle has no root ref for the focus contract');
 assert.match(vh,/ref=\{huddleRef\}/,'the huddle root does not carry the ref');
 assert.match(vh,/tabIndex=\{minimized \? 0 : -1\}/,'the expanded huddle root is not a focus target');
 assert.match(vh,/if \(panel\) panel\.focus\(\);/,'focus does not move into the huddle on open or expand');
 assert.match(vh,/if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); setMinimized\(true\); return; \}/,'Escape does not minimize the huddle');
 assert.match(vh,/e\.key !== "Tab"/,'the huddle has no Tab containment');
 assert.match(vh,/prevFocus && prevFocus\.focus/,'focus is not restored when the huddle unmounts');
 // The trap stands down while a dialog is stacked over the call.
 assert.match(vh,/t\.closest\('\[role="dialog"\]'\)/,'the huddle key handler does not yield to a stacked dialog');
 // The root gap (sixth panel): focus lands on the panel root on
 // open, and the root is excluded from the focusable list by its
 // minus 1 tabindex, so the wrap must treat the root itself as the
 // boundary or Shift + Tab from the freshly focused root steps out
 // of the aria-modal surface before any wrap engages.
 assert.match(vh,/if \(document\.activeElement === panel\) \{ e\.preventDefault\(\); \(e\.shiftKey \? last : first\)\.focus\(\); \}/,'the huddle trap does not treat its root as the wrap boundary');
 const icAt=source.indexOf('function IncomingCall');
 const ic=source.slice(icAt,source.indexOf('\nlet __cbHuddleClientSeq',icAt));
 assert.match(ic,/call\.audioOnly \? "phone" : "camera"/,'the accept button does not pick its icon from the call kind');
 assert.match(ic,/if \(document\.activeElement === panel\) \{ e\.preventDefault\(\); \(e\.shiftKey \? last : first\)\.focus\(\); \}/,'the incoming call trap does not treat its root as the wrap boundary');
 console.log('VideoHuddle carries the modal focus contract and the accept icon follows the call kind.');
}

/* ── MediaFigure: the unverified fallback renders marked ──────────
   The REAL MediaFigure with the object trendingMediaOf returns for
   an item's own article image (verified: false, the outlet as its
   credit): the caption must carry the "Unverified image" marking
   beside the credit, because that caption is the only thing telling
   a checked picture from an unchecked one. A verified object must
   NOT carry the marking. (Wave seven: the fallback previously
   rendered with neither marking nor credit while the contract
   comments claimed it rendered marked.) */
{
 const P={dark:true,ink:'#eee',ink2:'#bbb',faint:'#999',line:'#444',line2:'#555'};
 const unv=renderToStaticMarkup(React.createElement(context.MediaFigure,{P,media:{kind:'image',url:'https://example.com/apod.jpg',poster:null,credit:'NASA',creditUrl:null,license:null,source:'NASA',verified:false},title:'Desert Stairway to Heaven'}));
 assert.match(unv,/Unverified image/,'the unverified fallback rendered without its marking');
 assert.match(unv,/NASA/,'the fallback credit did not render');
 const bare=renderToStaticMarkup(React.createElement(context.MediaFigure,{P,media:{kind:'image',url:'https://example.com/x.jpg',poster:null,credit:null,creditUrl:null,license:null,source:null,verified:false},title:'No credit'}));
 assert.match(bare,/Unverified image/,'an unverified figure with no credit rendered without its marking');
 const ver=renderToStaticMarkup(React.createElement(context.MediaFigure,{P,media:{kind:'image',url:'https://example.com/h5n1.jpg',poster:null,credit:'NIAID / Wikimedia Commons',creditUrl:null,license:'CC BY 2.0',source:'commons',verified:true},title:'H5N1 particles'}));
 assert.doesNotMatch(ver,/Unverified image/,'a verified figure carried the unverified marking');
 assert.match(ver,/NIAID \/ Wikimedia Commons/);
 console.log('MediaFigure marks the unverified fallback (with or without credit) and never marks a verified figure.');
}

/* ── TrendThumb: the digest row marks its unverified thumb ───────
   The REAL TrendThumb with the same fallback object: the hero and
   article surfaces mark unverified media through MediaFigure, but
   digest rows render TrendThumb, which carried no marking at all
   until wave eight (seventh panel, Trending), so an unchecked photo
   sat unlabeled in every digest row. The thumb now prints the same
   "Unverified image" line under itself whenever the media object
   carries verified: false, and never for verified media. */
{
 const P={dark:true,ink:'#eee',ink2:'#bbb',faint:'#999',line:'#444',line2:'#555'};
 const unv=renderToStaticMarkup(React.createElement(context.TrendThumb,{P,media:{kind:'image',url:'https://example.com/apod.jpg',poster:null,credit:'NASA',creditUrl:null,license:null,source:'NASA',verified:false},title:'Desert Stairway to Heaven'}));
 assert.match(unv,/Unverified image/,'the unverified digest thumb rendered without its marking');
 const ver=renderToStaticMarkup(React.createElement(context.TrendThumb,{P,media:{kind:'image',url:'https://example.com/h5n1.jpg',poster:null,credit:'NIAID / Wikimedia Commons',creditUrl:null,license:'CC BY 2.0',source:'commons',verified:true},title:'H5N1 particles'}));
 assert.doesNotMatch(ver,/Unverified image/,'a verified digest thumb carried the unverified marking');
 console.log('TrendThumb marks the unverified digest thumb and never marks a verified one.');
}

/* ── Trending hero: species italics in summaries ───────────────────
   The pipeline now puts the same *pairs* in summaries that titles
   have always carried (buildTrendingItem), and the hero renders its
   summary through the same formatter as its title. The REAL
   TrendingHero renders a summary carrying a marked binomial: the
   name must come out inside an <em> and the raw marker must never
   print literally. */
{
 const hero=renderToStaticMarkup(React.createElement(context.TrendingHero,{P:P0,accent:'#A3B899',at:'#111',item:{
  title:'Gut study finds a pattern',
  summary:'Eradicating *Helicobacter pylori* reduced recurrence in the trial group.',
  url:'https://example.com/gut',category:'Biology & Medicine',source:'J Test',type:'Paper',citedByCount:null,
  media:{image:null,video:null,resolvedAt:1},
 },onExpand:()=>{},generatedAt:Date.now(),isMobile:false}));
 assert.match(hero,/<em style="font-style:italic"><span>Helicobacter pylori<\/span><\/em>/,'the summary binomial did not render in italics');
 assert.doesNotMatch(hero,/\*Helicobacter/,'the raw italics marker printed literally in the summary');
 assert.match(hero,/Gut study finds a pattern/);
 console.log('Trending hero renders a summary binomial in italics; the marker never prints.');
}

/* ── FactCheck receipt scope, render level (2026-10-22, L7-16) ─────
   The REAL FactCheck in its all clear state, over every mode the
   payload can carry. The collapsed line must state its denominator
   against the answer (the extracted set it ran on, plus the rest of
   the answer named as not claim checked), and the green pass dot
   may only show when the check's own summary carries no scope
   caveat. The deep summary carries none; the terms summary limits
   itself ("not a check on whether the conclusions are right") and
   the extractive summary limits itself ("not a verification"), so
   both render a neutral dot. */
{
 const P={dark:true,ink:'#eee',ink2:'#bbb',faint:'#999',line:'#444',line2:'#555'};
 const deep=renderToStaticMarkup(React.createElement(context.FactCheck,{P,accent:'#A3B899',fc:{
  mode:'claims',
  summary:'Checked 2 claims against the cited sources: 2 supported, 0 thin, 0 unsupported.',
  claims:[{claim:'First claim [1]',status:'supported',note:''},{claim:'Second claim [2]',status:'supported',note:''}],
 }}));
 // PIN UPDATED (2026-10-23, Wave 3 S5 landing, audit L5-13): the deep
 // receipt now states the check ran against the abstracts of the cited
 // sources, the same wording the server summary carries.
 assert.match(deep,/Checked 2 extracted claims against the abstracts of the cited sources and each one held up\. The rest of the answer was not claim checked\./,'deep receipt does not state its scope');
 assert.match(deep,/background:#7A9E7E/,'deep receipt lost its pass dot though its summary carries no caveat');
 assert.doesNotMatch(deep,/all 2 claims in this answer/,'the old exhaustive receipt wording is back');
 console.log('FactCheck deep receipt states its extracted denominator and keeps its pass dot.');

 const none=renderToStaticMarkup(React.createElement(context.FactCheck,{P,accent:'#A3B899',fc:{
  summary:'',
  claims:[{claim:'Only claim [1]',status:'supported',note:''}],
 }}));
 assert.match(none,/Checked 1 extracted claim against the abstracts of the cited sources and it held up\. The rest of the answer was not claim checked\./,'modeless receipt does not state its scope');
 assert.match(none,/background:#7A9E7E/,'modeless receipt lost its pass dot though its summary carries no caveat');
 console.log('FactCheck modeless receipt states its extracted denominator and keeps its pass dot.');

 const terms=renderToStaticMarkup(React.createElement(context.FactCheck,{P,accent:'#A3B899',fc:{
  mode:'terms',
  summary:'Every specific name the answer uses turns up in a paper it cites. That means it is drawing on this evidence rather than reaching past it. It is not a check on whether the conclusions are right.',
  claims:[{claim:'GENE1',status:'supported',note:''}],
 }}));
 assert.match(terms,/Checked 1 extracted name against its paper and it turned up\. The rest of the answer was not claim checked\./,'terms receipt does not state its scope');
 assert.doesNotMatch(terms,/background:#7A9E7E/,'terms receipt shows a pass dot though its own summary carries a scope caveat');
 console.log('FactCheck terms receipt states its scope and shows no pass dot.');

 const extractive=renderToStaticMarkup(React.createElement(context.FactCheck,{P,accent:'#A3B899',fc:{
  mode:'extractive',
  summary:'Traced 2 cited claims against the wording of the papers they cite: 2 traced to the cited paper\'s wording, 0 overlap only weakly, 0 do not trace. A wording trace is not a verification of the claims.',
  claims:[{claim:'First cited claim',status:'traced',note:''},{claim:'Second cited claim',status:'traced',note:''}],
 }}));
 assert.match(extractive,/Checked 2 extracted claims against their papers for shared wording and each one matched\. The rest of the answer was not claim checked\./,'extractive receipt does not state its scope');
 assert.doesNotMatch(extractive,/background:#7A9E7E/,'extractive receipt shows a pass dot though its own summary carries a scope caveat');
 console.log('FactCheck extractive receipt states its scope and shows no pass dot.');
}

/* ── buildEvidenceMap: unknown means unknown (2026-10-22, L7-2) ───
   The REAL buildEvidenceMap, called directly. A turn whose check
   never ran (factCheck null, a disagreement verdict present, the
   after/03 shape) builds no map at all, so it can stamp zero
   paragraphs as supported. A cited paragraph no claim matched
   returns null, the default state. Only a matched claim stamps,
   each in its own honest state. */
{
 assert.equal(context.buildEvidenceMap(null,{status:'settled',summary:'No opposing findings were detected.'}),null,'a verdict alone built an evidence map');
 assert.equal(context.buildEvidenceMap(null,null),null,'a missing check built an evidence map');
 assert.equal(context.buildEvidenceMap({claims:[]},{status:'settled'}),null,'an empty check built an evidence map');
 const evMap=context.buildEvidenceMap({claims:[
  {claim:'Alpha finding about sleep and memory consolidation in adults',status:'supported',cites:[1]},
  {claim:'Beta finding about dose response in the same cohort',status:'traced',cites:[2]},
  {claim:'Gamma finding about outcomes after treatment ends',status:'unsupported',cites:[3]},
 ]},null);
 assert.equal(evMap('A paragraph no claim reached, citing a paper anyway.',[4]),null,'an unmatched cited paragraph got a stamp');
 assert.equal(evMap('A paragraph with no citations at all.',[]),null,'an uncited paragraph got a stamp');
 assert.equal(evMap('Any paragraph citing the first paper.',[1]).status,'supported','a supported claim lost its stamp');
 assert.equal(evMap('Any paragraph citing the second paper.',[2]).status,'traced','a traced claim lost its own state');
 assert.equal(evMap('Any paragraph citing the third paper.',[3]).status,'unsupported','an unsupported claim lost its stamp');
 const mystery=context.buildEvidenceMap({claims:[{claim:'Delta finding with a status nobody defined',status:'mystery',cites:[1]}]},null);
 assert.equal(mystery('Any paragraph citing the first paper.',[1]),null,'an unknown claim status stamped a paragraph');
 console.log('buildEvidenceMap stamps only paragraphs a check actually reached, each in its honest state.');
}
