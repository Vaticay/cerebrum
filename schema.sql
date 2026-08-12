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
