-- Cerebrum D1 schema
-- Run once against your D1 database:
--   npx wrangler d1 execute cerebrum-cache --remote --file=schema.sql

-- Existing: answer cache. Keyed by normalized query text. Score goes up on
-- upvote, down on downvote (see /api/vote). High-score answers are served
-- directly on repeat queries instead of re-calling the LLM.
CREATE TABLE IF NOT EXISTS answer_cache (
  query_key   TEXT NOT NULL,
  answer_id   TEXT NOT NULL,
  answer      TEXT NOT NULL,
  sources     TEXT,
  score       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (query_key, answer_id)
);
CREATE INDEX IF NOT EXISTS idx_answer_cache_query ON answer_cache(query_key);
-- /api/vote looks up and updates rows by answer_id ALONE (not query_key), but
-- the only existing index is the composite PK (query_key, answer_id), which
-- can't be used to seek on answer_id by itself — every vote was doing a full
-- table scan. UNIQUE also closes a theoretical collision gap: answer_id is
-- generated from Date.now() + a few random base36 chars with no uniqueness
-- guarantee outside the composite key, so two different queries could in
-- principle share one and let a vote silently touch the wrong answer's score.
CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_cache_answer_id ON answer_cache(answer_id);

-- Existing: tracks which LLM tends to win (produce the accepted answer) for
-- a given topic domain, so repeat domains skip straight to the best model.
CREATE TABLE IF NOT EXISTS model_perf (
  domain  TEXT NOT NULL,
  model   TEXT NOT NULL,
  wins    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, model)
);

-- NEW: paper-level learning. Every paper that actually got cited [N] in a
-- successful answer for a given query is remembered here. Next time the
-- same (or near-identical) question comes in, these papers are injected
-- into the retrieval pool at maximum relevance BEFORE the search ladder
-- even runs — so a question Cerebrum has answered correctly before never
-- has to "rediscover" the right papers from scratch.
--
-- times_confirmed increases +1 automatically whenever a paper is cited in
-- an answer, +2 more on an explicit upvote (see /api/vote), and decays -1
-- on a downvote so a bad match doesn't stay force-included forever.
CREATE TABLE IF NOT EXISTS paper_cache (
  query_key       TEXT NOT NULL,
  title           TEXT NOT NULL,
  url             TEXT,
  journal         TEXT,
  year            TEXT,
  authors         TEXT,
  abstract        TEXT,
  times_confirmed INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (query_key, title)
);
CREATE INDEX IF NOT EXISTS idx_paper_cache_query ON paper_cache(query_key);

-- NEW v5.0: Query Intelligence — stores successful query resolutions so the
-- LLM resolver can be skipped for known queries. This is how Cerebrum "learns
-- and grows" — every successful answer makes the next similar query faster.
-- The query_hash is the normalized lowercase query stripped of punctuation.
-- success_count increases when an answer using this resolution gets upvoted.
CREATE TABLE IF NOT EXISTS query_intelligence (
  query_hash      TEXT NOT NULL PRIMARY KEY,
  raw_query       TEXT NOT NULL,
  resolved_query  TEXT NOT NULL,
  intent          TEXT NOT NULL,
  topic           TEXT,
  entities        TEXT,         -- JSON array of extracted entities
  success_count   INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_qi_intent ON query_intelligence(intent);

-- NEW v5.0: Topic Memory — tracks topics discussed across all sessions,
-- which search terms work best for each topic, and average paper yield.
-- This helps Cerebrum learn which search strategies are most effective
-- for each scientific domain.
CREATE TABLE IF NOT EXISTS topic_memory (
  topic_key         TEXT NOT NULL PRIMARY KEY,
  related_terms     TEXT,        -- JSON array
  best_search_terms TEXT,        -- JSON array of most effective search terms
  avg_paper_count   INTEGER DEFAULT 0,
  search_count      INTEGER DEFAULT 0,
  updated_at        INTEGER NOT NULL
);
