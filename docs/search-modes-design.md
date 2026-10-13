# Search Modes: scite.ai parity, done 10x better

Design only. No implementation. Repo: `~/workspace/cerebrum`.

## What scite.ai has (verified live 2026-10-09)

Four search modes in the `/search` dropdown, plus satellite tools:

| Mode | What it does | Test query "black soldier fly waste oil" |
|---|---|---|
| Papers | Hybrid metadata + full-text search, paper cards with Smart Citation tallies | 335,550 results, 1.94s |
| Citation Statements | Searches the extracted citing sentences themselves | 5,413 results, 0.56s |
| Metadata | Paper cards without citation context | 330,194 results, 0.99s |
| Patents (new) | 90M+ patent families, semantic search | Could not test (UI blocked) |

Plus: **Assistant** (chat RAG, agentic pipeline "Consulting 25 publications"), **Reference Check** (upload manuscript, flags retractions), **Advanced Search Builder** (Lucene syntax, 18 fields), API / MCP.

Scite's moat: citation statements extracted from 50.5M full texts, deep-learning classified into supporting / contrasting / mentioning with confidence + section attribution. 1.6B+ classified statements.

## What Cerebrum has today

One search mode: the 15-database funnel (Europe PMC, PubMed, OpenAlex, Crossref, arXiv, Semantic Scholar, DOAJ, bioRxiv, Zenodo, PLOS, CORE, BASE, PMC full text, OpenAIRE, preprints) with a retrieval ladder (up to 3 rungs), concept-group scoring, constraint enforcement, honesty floor, and SSE streaming.

Note: Cerebrum's frontend already has `mode` (answer intent: explain/compare/etc. via ASK_MODES). Search modes are a **separate dimension**. Do not overload `mode`. Add `searchMode` to the search body: `"papers" | "statements" | "metadata"`. Default `"papers"`.

## Mode 1: Papers (default) — keep, already ahead

This is today's pipeline. No changes needed except the mode selector defaulting here. Cerebrum is already ahead of scite's Papers mode on honesty (constraint enforcement, no fabricated stance counts, relevance floor) where scite shows model confidence as fact ("mentioning, 99% confidence").

## Mode 2: Citation Statements — the big gap, the big win

### What it is

A search mode that returns **citing sentences, not papers**. Each result is a verbatim quote: what a later paper actually said when it cited an earlier one.

### Data sources (verified live today)

1. **Semantic Scholar Graph API** — `/paper/{doi}/citations?fields=title,abstract,contexts,intents,year,authors`
   - `contexts`: real citation sentences. Verified live: "Innate immune cells are abundant in atherosclerotic lesions [141,150,173,174] and produce proinflammatory cytokines..." with `intents: ["background"]`.
   - `intents`: background / methodology / result — real classifier output, not derived from counts.
   - Free, no key for moderate use (100 req/5min unauth). Optional S2 API key in env for headroom.
   - Coverage caveat: only from S2's open-access corpus. Some citations return no contexts. This is honest missing data, not a bug.
2. **Europe PMC full-text search** — `query=...&resultType=core` finds full-text articles; JATS XML has `<xref ref-type="bibr">` markers. Sentences around markers near query terms can be extracted. Slower, use as supplement.
3. **OpenAlex** — has cite edges (`referenced_works`) but no sentences. Used only to build the paper list, not statements.

### Backend architecture

New module `functions/api/statements.js` (~600 lines). Do NOT add to `functions/api/search.js` — it is 15,246 lines. In `runSearchPipeline`, branch early on `body.searchMode === "statements"` and hand off.

Pipeline `runStatementSearch(query)`:

1. **Paper list (lite funnel).** Reuse rung 1 of the existing funnel only (15 sources, one pass, no ladder). Take top 8 papers with DOIs. This is the "what is this question about" step. Budget: ~15 subrequests.
2. **Fetch citing sentences.** For each of the 8 DOIs: `GET api.semanticscholar.org/graph/v1/paper/DOI:{doi}/citations?fields=title,abstract,contexts,intents,year,authors,venue&limit=50`. Budget: 8 subrequests. Total ~23 of the 50 Cloudflare subrequest cap. Fits.
3. **Filter sentences to the question.** A citation sentence only counts if it mentions the query's key terms (via the existing concept groups — so "Hermetia illucens" matches "black soldier fly" in sentences). Drop pure background cites that never mention the topic. This is the step scite skips: their mode returns any statement matching keywords, ours returns statements *about the question*.
4. **Dedupe.** Identical sentences cited across papers collapse to one card with "cited by N".
5. **Rank.** Prefer: sentences containing more key terms > methodology/result intents > recency. Never invent scores; show the ordering rationale in diagnostics.
6. **Cache.** KV/D1 cache keyed by DOI, 7-day TTL, so repeat queries are instant and popular papers accumulate a warm index.

SSE stages for the frontend: `finding_papers` → `reading_citing_sentences` → `matching_to_question` → done.

Response shape:
```json
{
  "mode": "statements",
  "query": "...",
  "statements": [
    {
      "quote": "verbatim sentence",
      "citingPaper": { "title": "...", "authors": "...", "year": 2024, "venue": "...", "doi": "..." },
      "citedPaper": { "title": "...", "doi": "..." },
      "intent": "methodology",
      "intentSource": "Semantic Scholar classifier"
    }
  ],
  "coverage": { "papersChecked": 8, "citingPapersRead": 214, "sentencesKept": 31 },
  "honesty": "Intents are Semantic Scholar's classifier labels, not Cerebrum's judgment. Sentences are verbatim quotes."
}
```

### How it is 10x better than scite

1. **Filtered to the question.** Scite's statement search matches keywords; Cerebrum requires the sentence to be *about* the query terms (concept-aware). Searching "waste oil" returns sentences discussing waste oil, not every paper that ever cited a BSFL paper.
2. **Honest intent labels.** Scite presents "mentioning, 99% confidence" as product truth. Cerebrum labels every intent with its source ("classified by Semantic Scholar") and never converts intents into supporting/contrasting counts — the fabricated reception dots stay dead.
3. **Concept-aware matching.** "Hermetia illucens" in a sentence matches a "black soldier fly" query. Scite is keyword-bound.
4. **Coverage transparency.** Every response says how many citing papers were read and how many sentences survived. No silent gaps.
5. **Free and live.** No account wall (scite gates the good version behind signup). Query-time extraction means today's papers, not last quarter's index.

### Honest limitation

Scite pre-indexed 1.6B statements; query-time extraction is 10–25s per search and misses paywalled citing papers. Mitigation: the D1/KV cache becomes an incrementally-built index — every search warms it for the next. Long-term, a nightly worker can pre-warm statements for trending papers.

## Mode 3: Metadata — the fast lane

Same rung-1 funnel, skip everything expensive: no citation threads, no retraction checks, no LLM synthesis, no SSE. Return the ranked list with title/authors/year/journal/abstract/DOI in under ~5s.

UI: a dense reading list, not an answer. For the "just show me the papers" user.

10x better than scite: Cerebrum's list carries the honesty floor and constraint enforcement scite lacks — every row earned its place, and the diagnostics say why each database contributed what it did.

## Mode 4: Patents — skip

Recommendation: do not build. Cerebrum is scientific literature; patents are a different corpus with a different user. Scite just launched it and it's not their strength either. If Dusty later wants it: EPO OPS API (needs registration) or Google Patents Public Datasets (BigQuery, paid). Park it.

## What about Assistant and Reference Check?

- **Assistant (chat RAG):** Cerebrum's answer pipeline already does agentic retrieval + synthesis. Scite's visible pipeline stages ("Consulting 25 publications") are theater Cerebrum could adopt honestly via its real SSE stages. No new build needed — surface what exists.
- **Reference Check:** Cerebrum already flags retractions (`flagRetractions`) in the answer pipeline. A standalone upload-manuscript mode is a real gap but a separate project. Note as phase 2.
- **Advanced Search Builder (Lucene):** Cerebrum's query preprocessing (concept groups, constraint phrases, proximity) already does what Lucene operators do, invisibly. Exposing `author:`, `year:`, `"exact phrase"`, `-exclude` operators in the composer is cheap (parse prefix, pass through to sources that support fielded search: Europe PMC, OpenAlex, S2 all do). Recommend as a fast follow.

## UI design

### Mode switcher (composer)

A quiet segmented control in the search composer, next to the existing ask-mode selector: **Papers · Statements · Metadata**. Plain text, ink indicator for active, no pills, no gradients (Dusty's taste). Follows the ASK_MODES pattern already in `SearchNameplate`. On mobile it collapses to the same treatment.

### Statements view

Not an answer page — a reading list of quote cards:

- Each card **leads with the sentence**, large, in the reading typeface. The sentence is the hero.
- Beneath: quiet attribution line — citing authors, year, journal.
- Cited paper as a second quiet line: "citing *Title* (2021)".
- Intent tag in plain text: "used as method · classified by Semantic Scholar". Never colored as verdict.
- Tap a card → citing paper detail (abstract, DOI link).
- Header: "31 sentences from 214 citing papers" + "Heard as: ..." line (reuse the existing plain-English interpretation).
- Empty state: "No citing sentences found for this yet. Most citing full texts are paywalled or the papers are too new to be cited." — honest, with a button to fall back to Papers mode.

### Metadata view

Dense rows: title / authors / journal · year / abstract toggle / DOI. No synthesis, no verdict, no threads. A "Read" button per row opening the existing paper drawer.

## API contract

`POST /api/search` body gains `searchMode`. `stream=1` SSE works for all three modes with mode-appropriate stages. `GET /api/statements?q=...` as a convenience alias for the statements pipeline (shareable links, like scite's `?mode=citations` URLs).

## Build order

1. `functions/api/statements.js` + pipeline branch + S2 client with KV cache.
2. Frontend mode switcher + statements view.
3. Metadata view (mostly reuse).
4. Lucene-style operators in the composer (fast follow).
5. Reference Check standalone (phase 2, if wanted).
