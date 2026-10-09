# Citation statements data sources (free APIs)

Researched 2026-10-09. Purpose: power the scite-style citation layer
(per-paper stance tallies, verbatim citing sentences, retraction flags,
full-text search) without publisher deals. All sources free.

## 1. Citing sentences: Semantic Scholar Graph API

Base: `https://api.semanticscholar.org/graph/v1`

```
GET /paper/{id}/citations?fields=contexts,intents,isInfluential,citingPaper.paperId,citingPaper.title,citingPaper.year,citingPaper.authors,citingPaper.venue,citingPaper.externalIds&limit=1000&offset=0
```

- `contexts`: the VERBATIM sentences where the citing paper mentions the anchor
  paper. This is scite's "citation statement", free.
- `intents`: S2's own classification per citation: background, methodology,
  result. NOTE: this is NOT supporting/contrasting/mentioning. S2 does not
  sell stance. The supporting/contrasting/mentioning layer must be built
  (candidate: the existing claim-opposition logic run over `contexts`).
- `isInfluential`: S2's influential-citation flag. Feeds "influential in this
  set" marks on search cards.
- ID formats accepted: S2 paper ID, `DOI:`, `ARXIV:`, `PMID:`, `PMCID:`,
  `URL:`, `CorpusId:`.
- `POST /paper/batch` takes up to 500 paper IDs per request: a 10-paper
  bibliography's contexts can be fetched in ONE call.
- Pagination: `limit` max 1000 per page, `offset` for more.
- Rate limits: unauthenticated ~100 requests per 5 min. A free API key
  (request once, send as `x-api-key` header) raises it substantially; docs
  vary on the exact authenticated ceiling, so implement backoff and treat
  429 as the source of truth.
- Gotcha: `tldr` is NOT allowed as a sub-field on `citingPaper` (request
  fails). Use `abstract` instead.

## 2. Full-text search: S2 snippet search

```
GET /snippet/search?query={terms}&fields={snippet_fields}&limit={n}
```

Full-text search over 500-word paper chunks, not just titles and abstracts.
This is the fix for the "oil ignored" retrieval failure: a term buried in a
methods section can outrank a term in an abstract. Free.

## 3. Retraction flags: OpenAlex (+ Crossref)

```
GET https://api.openalex.org/works/doi:{doi}
```

- `is_retracted` is a boolean on EVERY works record, always populated
  (explicit `false`, never absent). No second lookup needed. Request it in
  the works field list; it rides the same response.
- OpenAlex exposes NO retraction date. For dated notices use Crossref:
  `https://api.crossref.org/works/{doi}` and read the `update-to` array
  (`type: "retraction"`).
- Caveats (measured, Oct 2026):
  - OpenAlex sets `is_retracted: true` on retraction NOTICES themselves, and
    at least one documented case of a mislabeled retraction exists. Never
    present the flag as a verdict; show provenance ("flagged by OpenAlex,
    notice DOI ..."). Fits the standing honesty bar.
  - Recall ~95.8% against the Retraction Watch gold set (120/120 found,
    115 flagged). Good signal, not ground truth.

## 4. What this means for the build order

| scite feature            | free source            | build vs buy        |
|--------------------------|------------------------|---------------------|
| citation statements      | S2 `contexts`          | wire up             |
| stance labels            | nothing off the shelf  | build (own classifier over contexts) |
| retraction flags         | OpenAlex `is_retracted`| wire up + provenance |
| full-text search         | S2 `/snippet/search`   | wire up             |
| influential marks        | S2 `isInfluential`     | wire up             |

No publisher deals needed. The only ML to build is stance classification
(supporting/contrasting/mentioning) over the free contexts.
