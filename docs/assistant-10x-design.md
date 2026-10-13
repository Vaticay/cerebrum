# Design: The Answer, 10x better than scite.ai's Assistant

Date: 2026-10-09. Status: DESIGN ONLY, not implemented.

## What scite's Assistant is

Chat-style RAG over one index (317M articles). During generation it shows
stages: "Mapping out a search strategy" → "Running searches" →
"Consulting 25 publications" → "Double-checking against the sources" →
"Finalizing your cited answer". Settings: Citation Style, Model (GPT5 nano),
Reasoning Effort, Response Length, number of publications consulted (25),
evidence source, reference types, table mode. Anonymous users get text; the
fully cited version requires a free account.

It is a black box that generates text. The pipeline labels are
marketing-flavored; no stage shows what it actually did, and no answer
carries a post-hoc audit of how it was built.

## Cerebrum's position: the document, not chat

Do NOT copy their chat. Cerebrum's structured research document is already
the better form factor for research work:

- Chat buries findings in a scroll of turns; the document puts the answer
  first and the evidence trail below it.
- Chat answers evaporate; a document can be cited, exported (PDF), read
  aloud, simplified by reading tier, and saved as an investigation.
- The document's structure (short answer → what the research shows →
  where it disagrees → key figures → tables → bibliography) is a
  reading order that teaches. Chat has no reading order.

Keep the document. Beat them on transparency and evidence fidelity, not
on conversation.

## What Cerebrum already has (the head start)

- The Dive: 5 real SSE pipeline stages (Understanding question, Finding
  papers, Screening sources, Synthesizing findings, Checking citations)
  with real per-database counts ("9 of 15 databases answered").
- AnswerDiagnostics: post-hoc disclosure block with "Heard as"
  (query translation transparency), Databases (which answered, which did
  not), Timing, Sources (retrieved vs cited vs withheld), Synthesis mode,
  and failed Pipeline stages.
- Constraint enforcement: load-bearing phrase matching, proximity
  matching, concept groups (BSFL ↔ Hermetia illucens), name-search
  detection with honest "no clear direction" output.
- Claim-level citations, key figures, consensus meter, extraction tables,
  reading tiers (Graduate/Undergrad/Plain).
- Settings plumbing exists: answerLength (persisted in cookie),
  evidenceFilter (all vs filtered), citationStyle, askMode, Pro "Deeper
  Pro search" (2x rerank pool, 50 papers, stronger models).

## The 10x: a glass box, not a black box

Scite's Assistant is a black box that generates text. Cerebrum's answer
should be a transparent pipeline that shows its work. Every claim traced,
every filter visible, every assumption stated. That is the product, and it
is what scite cannot copy without rebuilding their retrieval.

### 1. The Trail (pipeline display, during + after)

During search the Dive already shows real stages. Make it show real
numbers at every stage, in plain language:

  Understanding question → "Understood: studies involving BSFL on waste oil substrates"
  Finding papers → "Searching 15 indexes in parallel" then "12 of 15 answered · 166 papers retrieved"
  Screening sources → "166 retrieved → 10 matched all constraints → 156 set aside"
  Synthesizing findings → "3 with usable abstracts → writing answer"
  Checking citations → "12 claim anchors verified"

After the answer lands, AnswerDiagnostics already carries this; promote
it from a quiet footer to a titled section: "How this answer was made."
Same rows, none invented: every number comes off the turn object
(sourcesQueried, stageHealth, relevanceGatedOut, answerSeconds,
queryAnalysis.plainEnglish, synthesisMode). Missing data means a missing
row, never a made-up one.

Rules, carried over from existing code:
- No elapsed clock during search; only real counts.
- Numbers that are approximate are labeled approximate (scite shows
  approximate counts without saying so — we say so).
- Failed stages render as honest disclosures ("The X stage did not
  complete — the answer was built without it"), never hidden.

### 2. "Heard as" — keep and deepen it

Scite shows "Mapping out a search strategy" as a stage label. Cerebrum
already shows the actual strategy: the "Heard as" row is the plain-English
read of the query with its load-bearing constraints.

Deepen it:
- Show what was kept vs dropped: "Kept: waste oil, BSFL, substrates.
  Dropped: 'studies' (too common), 'involving' (stop word)."
- Show constraint terms explicitly: "Required in each cited paper:
  'waste oil' (or 'waste cooking oil' within 8 words) AND 'BSFL' (or
  'Hermetia illucens', 'black soldier fly')."
- This is PubMed's "Search Details" box, done quietly, in plain
  language. Scite has nothing like it.

### 3. Why this paper — per-paper constraint evidence

This is the 10x no competitor has. Each bibliography row already knows
its constraint-matching state (the scorer computes coreCoverage per
paper). Surface it:

- On each cited paper: quiet chips or a line like
  "Matches: waste oil · BSFL · substrate. Absent: none."
- On withheld papers (already counted via relevanceGatedOut): an
  expandable "156 papers set aside" list with the reason per paper:
  "Olive oil pomace study — no mention of waste oil as substrate."
  Titles plus reasons, not just a count.

This turns retrieval from a claim ("we found the right papers") into
something checkable. Scite's "Consulting 25 publications" is a count;
this is a receipt.

### 4. Settings: take the good, leave the chrome

Scite's Assistant settings, translated to Cerebrum's quiet design:

| Scite setting      | Cerebrum version | Decision |
|--------------------|------------------|----------|
| Reasoning Effort   | Depth: Quick / Standard / Deep | ADD — this is the user-facing form of an internal knob. Quick = smaller retrieval pool, lighter model, 10 papers consulted. Standard = today's behavior, ~25 papers. Deep = Pro "Deeper" behavior made explicit: 50-paper rerank pool, stronger models, no cheap-first. Honest descriptions of what changes, not marketing. Persist in cookie like answerLength. |
| Evidence source    | Evidence: All / Reviews only / Primary studies / Clinical | EXTEND the existing evidenceFilter (currently all vs a filtered set) with Reviews-only and Clinical-only. This is natural-language filtering made quiet, no Lucene syntax required. |
| Reference types     | (fold into Evidence above) | Same control. One axis, not two. |
| Response length    | already answerLength (Concise/Standard/Detailed) | KEEP. |
| Citation style     | already citationStyle | KEEP. |
| Model (GPT5 nano)  | — | DO NOT COPY. Exposing model brand names is AI chrome; synthesis is model-agnostic infrastructure. |
| Table mode         | Evidence table toggle already exists | KEEP existing. |
| Attach files       | Document mode exists (document.js) | KEEP existing. |

Settings placement: a quiet "Search options" disclosure on the search
screen — plain text controls (Depth, Evidence, Length), no pills, no
gradients, no SaaS chrome, per standing design rules. Chosen options are
echoed in the Trail ("Depth: Standard · Evidence: all · 25-paper pool")
so the answer's assumptions are visible on the answer itself.

### 5. The honest fallback as a feature

Scite's Assistant either answers or gates. Cerebrum already does better:
- "What the limited sources say" heading when abstracts are thin.
- Weak tier: "couldn't find a direct answer" instead of laundering
  keyword matches into support.
- Name searches: "N papers found · no clear direction."

Make these first-class, not failure modes. The answer header should name
its own tier in plain words ("Limited sources", "Background only"), the
way KeyFigures already refuses to invent a direction. A system that
states its limits is the 10x; scite's confident chat text is the thing
to beat.

### 6. Every claim traced

Keep and extend claim-level citation anchors. The 10x bar:
- Every factual sentence in the answer body carries its anchor.
- "Checking citations" is a real stage, not a label: verify each anchor
  resolves to a retrieved paper and each quoted sentence exists in the
  source abstract/extraction.
- Extraction tables already tie cells to papers; add the source sentence
  under each contested cell so disagreements are checkable, not asserted.

## What deliberately NOT to do

- No chat mode. The document is the product.
- No model names in the UI.
- No "AI confidence %" scores (standing rule: no pseudo-precise
  confidence).
- No fabricated reception tallies (already fixed: receptionCounts returns
  null → honest dashes).
- No count without a label when approximate.
- Nothing in the settings panel that doesn't change retrieval or
  synthesis in a describable way. If it can't be explained in plain
  words, it doesn't get a control.

## Implementation sketch (for later, not now)

Backend (functions/api/search.js):
- settings.depth: quick|standard|deep → retrieval pool size, rerank
  strength, model tier. Standardize what "Deeper Pro search" already
  does as deep; gate deep behind Pro as today, quick/standard free.
- settings.evidence: all|reviews|primary|clinical → filter on study
  type / publication type at retrieval + scorer level.
- Return per-paper constraint match info already computed by the
  scorer (coreCoverage breakdown) on each source object, plus the
  constraint term list from queryAnalysis, so the frontend can render
  "Matches / Absent" chips and the withheld list with reasons.
- Funnel numbers per stage (retrieved → matched → abstracted → cited)
  carried on the turn payload; stage timings per stage.

Frontend (src/CerebrumApp.jsx):
- Search options disclosure: Depth, Evidence, Length; persist to
  cookies; echo into Trail.
- Dive depth rail: add real per-stage counts (from SSE frames that
  already carry answered/total; add counts for screening and
  synthesis stages).
- "How this answer was made" section: promote AnswerDiagnostics,
  add the funnel line, add kept/dropped terms and required
  constraints under "Heard as".
- Bibliography rows: "Matches: … · Absent: …" line from
  source.constraintMatch; withheld papers expandable list with
  per-paper reasons.
- KeyFigures/ConsensusMeter unchanged — they already refuse to invent
  direction.

## How it is better than scite's Assistant, in one paragraph

Scite's Assistant is a chatbot that consults one index and tells you it
"consulted 25 publications." Cerebrum's answer is a document that
searched 15 indexes, shows you the exact query it heard, the constraints
it enforced, which papers matched and which were set aside and why,
which databases failed, how long it took, and what it could not answer —
with every factual claim anchored to a real paper. The settings it
exposes (depth, evidence, length) change things you can name; the
settings it hides (model brand, reasoning effort) are chrome. That is
the 10x: a research instrument with a visible mechanism, not a chat
window with a confident tone.
