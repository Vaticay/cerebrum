# Advanced Search: Design Document

**Date:** 2026-10-09
**Status:** Design only. Not implemented.
**Goal:** Everything scite.ai's Search Builder does, but built for scientists who don't know query syntax. Natural language first, structured when you want it.

---

## 1. What scite has (from the browser investigation)

Scite's `/search/builder` is Lucene for librarians:

- Boolean: `AND` / `OR` / `NOT`, grouping with parentheses
- Phrases: `"long covid"`
- Wildcards: `term*`, fuzzy: `term~N`, proximity: `"words"~N`
- 18 fields: Title, Abstract, Citation Statements, Citation Section, Cited Document (DOI), Author, Affiliation, Topic, MeSH Descriptor, MeSH Qualifier, Year, Journal, ISSN, Publisher, Publication Type, PubChem substances
- Example: `"long covid" AND normalized_types:Review AND year:2024`
- 4 search modes as separate dropdown options: Papers / Citation Statements / Metadata / Patents

The field names are API-internal (`normalized_types`), not human. You have to learn Lucene. The modes are separate searches you switch between.

---

## 2. What Cerebrum has today

- Natural language queries through `analyzeQuery()` (`functions/api/search.js:2759`), which extracts:
  - `questionType` (definition, yes/no, etc.)
  - `isNameSearch`
  - `organism` + `organismPhrases`
  - `keyPhrases` → `constraints` (load-bearing phrases, enforced by `verifyPaperConstraints()`)
  - `plainEnglish` — shown in the UI as the **"Heard as"** line (query translation transparency)
- Query expansion via `SYNONYMS` + `CONCEPT_GROUPS` (the BSFL fix: scorer now knows "Hermetia illucens" = BSFL)
- Proximity phrase matching in the scorer (the "waste cooking oil" satisfies "waste oil" work)
- Evidence tier filter (All / Systematic reviews / RCTs / In vivo-in vitro) + stress filters (human studies, direct measurements)
- No inline operators. No field-scoped search. No boolean.

Paper fields actually available post-merge (from OpenAlex, Crossref, Europe PMC, PubMed, Semantic Scholar, biorxiv):

| Field | Where it lives | Quality |
|---|---|---|
| title | all sources | high |
| abstract | OpenAlex, PubMed, Europe PMC | high, some missing |
| authors (full list) | `_allAuthors` (OpenAlex authorships, PubMed XML) | high |
| year | all sources | high |
| journal | all sources | medium, name varies by source |
| doi | all sources | high |
| type | `_rawType` (OpenAlex only: article/preprint) | medium |

---

## 3. The honest field inventory

Ship only what the data supports. Scite lists 18 fields; we list what we have.

### Available now (no backend change)

| Operator | Matches against | Notes |
|---|---|---|
| `title:` (alias `intitle:`) | paper title | substring, case-insensitive |
| `abstract:` (alias `inabstract:`) | abstract text | papers without abstracts never match — say so in the UI |
| `author:` | full author list | substring on any author; `"Smith"` matches "Smith J" |
| `year:` | publication year | `2020`, `2020-2024`, `>2020`, `>=2020`, `<2020`, `<=2020` |
| `journal:` | venue name | substring; "Nature" also matches "Nature Communications" — document this |
| `doi:` | DOI | exact, normalized (strip `https://doi.org/`, case-insensitive) |
| `type:` | article / preprint / review | review detection is heuristic; preprint reliable via OpenAlex |

### Cheap to add (extend existing fetches, no new pipeline)

| Operator | Change needed | Effort |
|---|---|---|
| `topic:` | add `concepts` to OpenAlex `select` param; match `display_name` | ~10 lines |
| `affiliation:` | OpenAlex `authorships` already fetched; read nested `institutions` | ~15 lines |
| `issn:` | add via `primary_location.source.issn_l` in OpenAlex `select` | ~5 lines |
| `mesh:` | parse `<MeshHeading>` in `parsePubmedXML` (PubMed only) | ~15 lines |
| `cites:` | OpenAlex `filter=cites:` accepts a DOI/OpenAlex ID — papers citing a given work | new fetcher param |
| `language:` | already filtering to English server-side; expose as operator | trivial |

### Genuinely hard (do not fake)

| Operator | Why hard |
|---|---|
| `statement:` (citation statements) | needs full-text extraction + classification pipeline — this is scite's moat |
| `section:` (citation section) | same pipeline |

The builder UI must not offer `statement:` until the pipeline exists. An honest 8-field builder beats a dishonest 18-field one.

---

## 4. The query language

Plain words, not API internals. Scite: `normalized_types:Review`. Cerebrum: `type:review`.

### 4.1 Inline operators (typed directly in the search box)

```
author:Smith                    author name contains "Smith"
author:"Smith, John"             exact author phrase
title:waste                     title contains "waste"
title:"waste oil"               title contains the exact phrase
intitle:larvae                  alias for title:
abstract:toxicity               abstract contains "toxicity"
journal:Nature                  journal name contains "Nature"
year:2020                       published in 2020
year:2020-2024                  published 2020 through 2024, inclusive
year:>2020   year:>=2020        after / on-or-after 2020
year:<2020   year:<=2020        before / on-or-before 2020
doi:10.1234/abcdef              exact DOI
type:review                     publication type is review
type:preprint                   preprints only
"waste oil"                     exact phrase anywhere (title or abstract)
-term                           exclude papers containing term
-"waste oil"                    exclude the exact phrase
NOT review                      exclude (Lucene-style, uppercase)
A OR B                          either (uppercase OR, like Google/scite)
(waste OR oil) larvae            grouping with parentheses
```

### 4.2 Rules

- **Implicit AND.** `waste oil larvae` means all three, as today. Nothing changes for existing users.
- **Precedence:** `NOT` / `-` > implicit AND > `OR`. Parentheses override.
- **OR must be uppercase.** Lowercase "or" stays as plain text ("for or against"). Same for AND/NOT — though implicit AND means nobody needs to type AND.
- **Unknown `field:` is ignored as text.** `year: the best year` — "year" followed by colon-space is not an operator. Only `knownfield:nonempty-value` parses as an operator. This keeps natural language safe: no query that works today breaks.
- **Quotes are double-only.** `"waste oil"` is a phrase. Single quotes stay as text.
- **Field values can be quoted or bare.** `author:Smith` and `author:"Smith, John"` both work. A quoted value may contain spaces, colons, parentheses.
- **No wildcards, no fuzzy `~`, no proximity `~N` in v1.** Deliberate: Cerebrum's scorer already does concept expansion (SYNONYMS + CONCEPT_GROUPS), typo-tolerant organism matching, and proximity phrase matching automatically. Scite needs the syntax because their retrieval is dumber. Our language stays small because the engine is smarter. Document this as a feature, not a gap.

### 4.3 Grammar

```
query        := clause (WS clause)*
clause       := or_group | exclusion | field_clause | phrase | term
or_group     := clause (WS "OR" WS clause)+
exclusion    := ("-" | "NOT" WS) clause
field_clause := field_name ":" field_value
field_name   := "title" | "intitle" | "abstract" | "inabstract"
              | "author" | "year" | "journal" | "doi" | "type"
              | "topic" | "affiliation" | "issn" | "mesh" | "cites" | "language"
field_value  := quoted | year_range | year_cmp | bare
year_range   := YYYY "-" YYYY
year_cmp     := (">=" | "<=" | ">" | "<") YYYY
quoted       := '"' [^"]+ '"'
term         := [^"\s:()]+
```

### 4.4 The structured query object

The parser produces this. It is the single interchange format between the search box, the builder UI, the "Heard as" line, and the backend.

```js
{
  text: "waste oil",          // free text left after operator extraction
  must: [                     // AND clauses
    { field: "all", value: "waste oil", phrase: true },
    { field: "title", value: "larvae", phrase: false }
  ],
  should: [                   // OR groups; at least one alternative must match
    [
      { field: "all", value: "waste" },
      { field: "all", value: "oil" }
    ]
  ],
  mustNot: [                  // exclusions; matching papers are dropped
    { field: "type", value: "review" }
  ],
  filters: [                  // hard metadata filters
    { field: "year", op: "between", from: 2020, to: 2024 },
    { field: "author", op: "contains", value: "Smith" }
  ]
}
```

`field: "all"` means title + abstract (the current default scope).

Two renderers:
- `toCQL(structured)` → the inline string: `title:larvae "waste oil" year:2020-2024 -type:review`
- `toPlainEnglish(structured)` → `Looking for papers with "larvae" in the title, about "waste oil", published 2020–2024, excluding reviews.`

---

## 5. How it plugs into the existing pipeline

Build on the old logic. No separate search path.

1. **Parse first.** Before `analyzeQuery()`, run the operator parser. Operators are extracted; the remaining free text goes through the existing pipeline untouched (organism detection, key phrases, constraints, expansion, scoring). A query with no operators behaves exactly as today.

2. **Filters apply at two levels.**
   - *Pre-filter (pushdown):* where a source API supports it, pass filters server-side so they don't waste result slots. OpenAlex supports `filter=from_publication_date:2020-01-01,to_publication_date:2024-12-31`, `authorships.author.search:Smith`, `primary_location.source.id`, `type`. Europe PMC supports `FIRST_PDATE`/`LAST_PDATE` ranges. PubMed supports `[dp]` date fields.
   - *Post-filter:* after merging and deduping, apply all filters to the paper list. This is the correctness backstop — it works across every source uniformly.

3. **Field-scoped `must` clauses become constraints.** `title:"waste oil"` adds a constraint `{ phrase: "waste oil", field: "title" }` to the list `verifyPaperConstraints()` enforces. The existing relevance floor and capping behavior apply unchanged — a paper missing a title-constrained phrase is capped below the floor, same as a missing load-bearing phrase today.

4. **`mustNot` drops papers.** Exclusion is explicit user intent; demotion would be dishonest. A dropped paper is counted and reported ("3 papers excluded by your `-review` filter") so the filter is visible, not silent.

5. **`should` (OR groups) feed scoring.** At least one alternative must match for the paper to be citable; matching more alternatives scores higher. This reuses the existing `coreCoverage` machinery — an OR group is one gate term satisfied by any alternative.

6. **The "Heard as" line extends.** It already shows the plain-English read. With operators it also shows the structured read, e.g.:
   > Heard as: Looking for randomised trials from 2020 onward about "metformin" + "diabetes".
   > Structured: `type:rct year:>=2020 metformin diabetes`

---

## 6. Natural language → structured (the 10x)

Scite makes you learn Lucene. Cerebrum translates your English and shows its work.

Extend `analyzeQuery()` to also emit `structuredQuery` + `structuredText`:

| Natural language | Detected | Structured |
|---|---|---|
| "RCTs on metformin", "randomized trials", "randomised controlled trials" | trial vocabulary | `type:rct` |
| "systematic reviews", "meta-analyses" | review vocabulary | `type:review` |
| "since 2020", "after 2020", "from 2020 onward", "recent" (→ last 5 yrs) | temporal phrase | `year:>=2020` |
| "between 2020 and 2024", "2020 to 2024" | range phrase | `year:2020-2024` |
| "by Smith", "Smith et al.", "Smith's group" | author attribution | `author:Smith` |
| "in Nature", "published in Science" | venue phrase | `journal:Nature` |
| "not reviews", "excluding reviews", "no preprints" | exclusion phrase | `-type:review` / `-type:preprint` |
| "X or Y" | alternation | `(X OR Y)` |

The existing `EVIDENCE_TIERS` vocabulary ("Systematic reviews", "Randomised trials", "In vivo / in vitro") becomes the canonical wording map — the evidence filter dropdown and the NL translator share one vocabulary file, so "Randomised trials" in the dropdown and "rcts" in the box mean the same thing.

**Ambiguity rule:** when the NL translator is unsure, it does not guess silently. The "Heard as" line shows the translation, and anything uncertain is left as free text rather than forced into a filter. A wrong filter silently dropping papers is worse than no filter.

---

## 7. The Search Builder UI

For users who don't know query syntax. Quiet, plain, no SaaS chrome — same voice as the rest of the app.

### 7.1 Placement and entry

Below the search box, next to the existing "Add constraints" (evidence filter) control: a quiet text button, **"Refine search"**. Opens a panel inline (not a modal — modals are AI-tell chrome).

### 7.2 The panel

```
Refine search                                        [Use text instead]

Match [all ▾] of these:

  [Title   ▾] [contains ▾] [waste oil            ]  [×]
  [Year    ▾] [between  ▾] [2020        ] [2024  ]  [×]
⊕ Add a row                                    (AND / OR via the "all/any" dropdown)

Exclude papers matching any of these:

  [Type    ▾] [is       ▾] [review      ▾]          [×]
⊕ Add an exclusion

─────────────────────────────────────────────
Reads as: title contains "waste oil" AND year between
2020–2024, excluding type review.

[Search]  [Clear]
```

Design notes:

- **Field dropdown** lists only fields with data (Section 3). Each option carries a one-line note of what it searches: "Title — paper titles", "Author — any author name". No dead options.
- **Operator dropdown** is per-field: text fields get `contains / is exactly / does not contain`; year gets `is / between / after / before`; type gets `is / is not`.
- **"all / any" toggle** at the top switches the `must` rows between AND and OR. One control, no boolean primer needed.
- **"Reads as" line** is the bidirectional translation — the same plain voice as "Heard as". It updates live as rows change.
- **"Use text instead"** collapses the builder and puts the generated CQL string in the search box, editable. Editing the text and reopening the builder re-parses it into rows. Both directions work.
- **Prefill from NL.** If the query already parsed to structured form (Section 6), the builder opens with those rows filled in. The user sees what the system heard and corrects it by editing rows instead of retyping.
- **Exclusion rows are visually separate** ("Exclude papers matching any of these") rather than a NOT toggle per row — clearer, and matches how people think.
- **Result counts per filter.** After a search, each active filter shows how many papers it removed ("year 2020–2024 removed 41 papers"). Silent filters are a trust problem; this is the same principle as the existing "withheld" count in Answer Diagnostics.

### 7.3 What makes it 10x scite, concretely

| Scite | Cerebrum |
|---|---|
| Learn Lucene or use the builder | Type English; the builder is a correction tool, not a requirement |
| Builder output is a Lucene string you must trust | "Reads as" line states the builder's meaning in plain words |
| 18 fields, some thin | Only fields with real data; each labeled with what it searches |
| Field names are API internals (`normalized_types`) | Field names are plain words (`type:review`) |
| Fuzzy/proximity/wildcard syntax you must learn | Automatic in the scorer; the language stays small |
| 4 modes are separate searches | One box; operators compose inline |
| Wrong filter silently narrows | Every filter reports how many papers it removed |

---

## 8. What NOT to build

- **No 18-field parity.** We ship 8 honest fields (Section 3), add 5 cheap ones, and leave citation-statement search out until the extraction pipeline exists.
- **No wildcard/fuzzy/proximity syntax.** The scorer already does this work (concept groups, typo-tolerant organism matching, proximity phrase matching). Syntax for what the engine does automatically is clutter.
- **No replacement of the NL path.** Operators are additive. Every query that works today works identically tomorrow.
- **No "mode" dropdown.** Scite's Papers / Citation Statements / Metadata / Patents split is a UI workaround for separate indexes. Cerebrum has one index (the merged paper list) — operators scope within it.
- **No saved-search / alert builder in v1.** Scite has "Create Search Alert". Out of scope; note as future.

---

## 9. Implementation phases (for scheduling, not this doc's scope)

- **Phase 1 — Parser + inline operators.** `parseStructuredQuery()` in `functions/api/search.js`. Fields: title, abstract, author, year, journal, doi, type, phrase, `-` exclusion, `OR`, parens. Post-filter only. "Heard as" shows the structured read.
- **Phase 2 — Pushdown.** Pass year/author/type filters to OpenAlex + Europe PMC + PubMed server-side where supported.
- **Phase 3 — Cheap fields.** `topic:`, `affiliation:`, `issn:`, `mesh:`, `cites:` (extend OpenAlex `select`, parse MeSH).
- **Phase 4 — Builder UI.** Panel in `CerebrumApp.jsx`, bidirectional sync with the search box, "Reads as" line, per-filter removal counts.
- **Phase 5 — NL → structured.** Extend `analyzeQuery()` with the vocabulary map (trial/review/temporal/author/venue/exclusion phrases). Prefill builder from it.

Each phase is independently shippable and testable. Phase 1 alone makes `author:`, `year:`, `"exact phrase"`, and `-exclude` work in the box.

---

## 10. Open questions

1. Should `type:review` use the existing evidence-tier classifier or a simpler heuristic? The tier system already classifies systematic-review vs RCT vs in-vivo — reuse it rather than building a second classifier.
2. `journal:` substring matching ("Nature" hits "Nature Communications") — acceptable with documentation, or rank exact-name matches first? Recommend: exact-name matches score higher, document the behavior in the field note.
3. Should the builder be available to free users? Standing rule says good AI for free users — search precision is correctness, not a Pro feature. Recommend: yes, free.
4. Citation-statement search is scite's core moat. Is there a v1 that doesn't need full-text extraction — e.g., OpenAlex's `cited_by` + Semantic Scholar's citation contexts API? Worth a spike before committing to "genuinely hard".
