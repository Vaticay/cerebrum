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
-- cannot be used to seek on answer_id by itself — every vote was doing a full
-- table scan. UNIQUE also closes a theoretical collision gap: answer_id is
-- generated from Date.now() + a few random base36 chars with no uniqueness
-- guarantee outside the composite key, so two different queries could in
-- principle share one and let a vote silently touch the wrong answer’s score.
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
-- has to “rediscover” the right papers from scratch.
--
-- times_confirmed increases +1 automatically whenever a paper is cited in
-- an answer, +2 more on an explicit upvote (see /api/vote), and decays -1
-- on a downvote so a bad match doesn’t stay force-included forever.
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
-- LLM resolver can be skipped for known queries. This is how Cerebrum “learns
-- and grows” — every successful answer makes the next similar query faster.
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

-- ============================================================
-- NEW v5.1: accounts. Two ways in — email+password, or a magic
-- (passwordless) email link — both land in this same table.
-- password_hash/password_salt are NULL for an account that has only
-- ever signed in via magic link — a logged-in user can set a password
-- later from Settings, which doubles as the “forgot password” flow
-- (sign in with a magic link, then set a new password) instead of a
-- separate reset-token system.
--
-- Security posture, spelled out since it’s the whole point of this
-- table: passwords are never stored in any recoverable form — only a
-- PBKDF2-SHA256 hash (100k iterations — Cloudflare workerd’s hard ceiling
-- for a single PBKDF2 call, see the comment in functions/lib/authHelpers.js
-- for why this isn’t the 210k it used to say — plus a fresh random salt per
-- user) computed in functions/lib/authHelpers.js. A full database export gives an
-- attacker nothing they can log in with — brute-forcing one hash back
-- to a real password at that iteration count is not practical at any
-- scale worth worrying about. Session tokens follow the same rule
-- one level down — see `sessions` below.
-- ============================================================
-- id/email/username/name/affiliation/created_at match the live table’s
-- actual shape exactly (confirmed against its real DDL). email_lower/
-- password_hash/password_salt/last_login_at are additions this codebase’s
-- OTP and legacy-password logic depend on that the live table didn’t have
-- yet — functions/lib/authHelpers.js’s ensureUserProfileColumns adds them
-- itself (as nullable columns, since SQLite’s ALTER TABLE ADD COLUMN can’t
-- retroactively add a NOT NULL column to a table that might already have
-- rows) and backfills email_lower for any pre-existing row, so this file
-- and that self-heal path converge on the same shape either way.
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  email_lower     TEXT NOT NULL, -- lowercased — every auth query keys off THIS, not `email`, for case-insensitive matching
  username        TEXT UNIQUE,   -- defaults to the email’s local part at signup (collision-retried — see functions/api/auth.js), editable after
  name            TEXT,          -- NULL until the person sets one
  affiliation     TEXT,          -- NULL until the person sets one
  password_hash   TEXT,          -- legacy email+password accounts only — NULL for every OTP-created account
  password_salt   TEXT,
  created_at      INTEGER NOT NULL,
  last_login_at   INTEGER,
  avatar_base64   TEXT,          -- data: URL of a client-compressed 256x256 JPEG; NULL until the person uploads one
  plan            TEXT,          -- Pro tier (2026-09-15): NULL/'free' = free, 'pro' = entitled
  pro_source      TEXT,          -- 'subscription' (Stripe) or 'lifetime' (founder grant); webhooks never touch 'lifetime'
  pro_granted_at  INTEGER,       -- when a lifetime grant was made (founder action)
  pro_interval    TEXT,          -- subscription billing interval: 'month' | 'year' (NULL for lifetime/free)
  stripe_customer_id TEXT        -- cus_* — links the account to Stripe billing
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower);

-- ============================================================
-- Multiplayer Academic Network — follows, accolades, and messaging.
-- This block matches the live database’s actual DDL verbatim (confirmed
-- against its real, pasted schema — not guessed). functions/lib/
-- authHelpers.js’s ensureSocialTables creates all five of these on first
-- use if they’re missing, using these exact same column names and types,
-- so a fresh database and the live one converge on one shape either way.
-- ============================================================
CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- badge_type values this codebase actually grants or checks for today:
-- `early_adopter` (auto-granted at account creation in functions/api/
-- auth.js — genuinely true for anyone signing up during this preview
-- phase). `top_peer_reviewer` and `published_author` have no granting
-- mechanism yet — they stay honestly empty for everyone rather than being
-- faked, until there’s a real way to verify either claim. See PROFILE_
-- BADGES in main.jsx for the one client-side exception (“Verified
-- sign-in”), which needs no DB row since it’s implied by having a session.
-- id is a plain TEXT primary key (no autoincrement) — every insert supplies
-- its own generated id via authHelpers.js’s newId(`acc`).
CREATE TABLE IF NOT EXISTS accolades (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  badge_type  TEXT NOT NULL,
  granted_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accolades_user_badge ON accolades(user_id, badge_type);

-- A thread’s membership lives in thread_participants rather than a fixed
-- pair of columns on `threads` itself, so a `dm` (2 participants) and a
-- `group` (however many) use the exact same shape — functions/api/data.js
-- leans on this for its send-message authorization check (you must have a
-- row here for a thread before you can post into it).
CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL, -- `dm` | `group`
  name        TEXT,          -- group display name — NULL for a DM (the other participant’s name is used instead)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- last_read_at (Commit 47): epoch-ms, NULL until the participant has ever
-- opened this thread. Deliberately not DATETIME/CURRENT_TIMESTAMP like the
-- other timestamp columns in this file — it's compared directly against
-- messages.created_at after both pass through data.js's toEpochMs(), so
-- storing it as the same epoch-ms shape functions/lib/authHelpers.js's
-- self-heal ALTER TABLE adds to an existing live table avoids a mismatch
-- between a fresh deploy's schema and an upgraded one's.
CREATE TABLE IF NOT EXISTS thread_participants (
  thread_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  joined_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_read_at  INTEGER,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_participants_user ON thread_participants(user_id);

-- id is a plain TEXT primary key (no autoincrement) — every insert supplies
-- its own generated id via authHelpers.js’s newId(`msg`). text and
-- attachment_title are both nullable since a message can be one without
-- the other (a shared-source card with no caption, or plain text with
-- nothing attached), but functions/api/data.js’s send-message rejects a
-- request with neither.
CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL,
  sender_id         TEXT NOT NULL,
  text              TEXT,
  attachment_title  TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

-- ============================================================
-- E2EE Phase 1 (2026-09-16): per-device key directory + encrypted threads.
-- The server NEVER sees private keys. It stores public identity/prekeys,
-- routes opaque ciphertext, and enforces "ciphertext-only" on encrypted
-- threads — it cannot read message content and must not try.
-- ============================================================
-- One row per device that holds E2EE keys.
CREATE TABLE IF NOT EXISTS e2ee_devices (
  user_id       TEXT NOT NULL,
  device_id     TEXT NOT NULL,          -- client-generated: 16 random bytes, base64url
  identity_key  TEXT NOT NULL,          -- Curve25519 public identity key, base64
  signing_key   TEXT NOT NULL,          -- Ed25519 public signing key, base64
  signed_prekey TEXT NOT NULL,          -- signed prekey public part, base64
  prekey_sig    TEXT NOT NULL,          -- Ed25519 sig over (identity_key || signed_prekey)
  fallback_key  TEXT,                   -- fallback one-time-key public part, base64 (NULL until client uploads)
  fallback_sig  TEXT,                   -- Ed25519 sig over (identity_key || fallback_key)
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER,                -- NULL = active
  label         TEXT,                   -- user label: "Dusty's iPhone"
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_e2ee_devices_user ON e2ee_devices(user_id);

-- One-time prekeys. The server hands each out at most once, then deletes
-- it — a claimed prekey can never start a second session.
CREATE TABLE IF NOT EXISTS e2ee_one_time_prekeys (
  user_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  key_id     TEXT NOT NULL,             -- client-generated id
  pubkey     TEXT NOT NULL,             -- base64
  claimed_at INTEGER,                   -- NULL = unclaimed
  PRIMARY KEY (user_id, device_id, key_id)
);
CREATE INDEX IF NOT EXISTS idx_e2ee_otk_unclaimed ON e2ee_one_time_prekeys(user_id, device_id, claimed_at);

-- Per-thread encryption state. A thread listed here accepts ONLY
-- ciphertext (msg_kind='cipher'); everything else is plaintext-legacy.
CREATE TABLE IF NOT EXISTS e2ee_threads (
  thread_id       TEXT PRIMARY KEY,
  protocol        TEXT NOT NULL,        -- 'olm-v1' (Phase 1); 'megolm-v1' (Phase 2)
  encrypted_since INTEGER NOT NULL,     -- messages created after this are ciphertext
  upgraded_by     TEXT NOT NULL         -- user_id that flipped the switch
);

-- Zero-knowledge backup bundles: one row per (user, device). `bundle` is
-- the opaque JSON object produced by recovery.js encryptBackupBundle:
-- AES-GCM-256 ciphertext whose key is Argon2id(24-word recovery phrase).
-- The server stores salt + ciphertext and can NEVER decrypt it — the phrase
-- never leaves the user's devices. A second device never overwrites the
-- first's backup. Never parse or interpret this column.
CREATE TABLE IF NOT EXISTS e2ee_backups (
  user_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  label      TEXT,
  bundle     TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

-- Additive columns on the live `messages` table (applied to existing
-- databases by the attempt-and-swallow ALTERs in ensureSocialTables):
--
--   msg_kind          TEXT NOT NULL DEFAULT 'plaintext-legacy'
--                     'cipher' | 'plaintext-legacy' | 'system'. For encrypted
--                     threads `text` holds the ciphertext envelope (never
--                     plaintext); the column is NOT renamed because renaming
--                     breaks the self-heal path — the semantics are
--                     documented here instead.
--   sender_device_id  TEXT — which device key sent it (session lookup +
--                     new-device warnings). NULL for legacy rows.
--   envelope_version  INTEGER NOT NULL DEFAULT 1 — wire-format migration.

-- Commit 48 — message/call moderation: block + report. Directional (blocker
-- blocked blocked) so "who blocked whom" is always answerable, though every
-- enforcement check in functions/api/data.js treats it as mutual — either
-- direction blocks new messages/threads/calls between the two people.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id  TEXT NOT NULL,
  blocked_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- One table + a `kind` discriminator ('message' | 'user' | 'call') for all
-- three moderation report surfaces, deliberately separate from the
-- pre-existing `reports` table (bad AI answers/citations, not user conduct).
-- No admin/review UI yet — same honest limitation as `reports` itself.
CREATE TABLE IF NOT EXISTS content_reports (
  id                TEXT PRIMARY KEY,
  reporter_id       TEXT NOT NULL,
  reported_user_id  TEXT,
  thread_id         TEXT,
  message_id        TEXT,
  kind              TEXT NOT NULL,
  reason            TEXT NOT NULL,
  note              TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported ON content_reports(reported_user_id);

-- Sessions are looked up by the SHA-256 hash of the cookie value, never
-- the raw token — so a leaked/dumped `sessions` table (unlike a leaked
-- cookie) is useless for impersonating anyone. Cookie itself is
-- httpOnly + Secure + SameSite=Lax so it’s inaccessible to any script
-- running on the page, including a successful XSS.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Magic-link tokens: same hash-only-at-rest rule as sessions. Single
-- use (used_at set on redemption, checked before honoring), short
-- expiry (15 minutes, enforced in functions/api/auth.js).
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash  TEXT NOT NULL PRIMARY KEY,
  email_lower TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email_lower);

-- Everything below is per-account storage that replaces localStorage
-- once someone is signed in (a signed-out/guest visitor still keeps
-- working exactly as before — nothing server-side is ever written for
-- them). Each row is scoped to user_id and every endpoint in
-- functions/api/data.js checks the session before touching any of it.
CREATE TABLE IF NOT EXISTS user_collections (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id);

-- NOTE: the live database also has a separate `saved_sources` table
-- (id, user_id, title, authors, journal, year, url, relevance, saved_at —
-- one column per bibliographic field). That is NOT this table and nothing
-- in functions/api/data.js reads or writes it yet — every `saved` action
-- today goes through user_saved_sources below, which stores the whole
-- source as one opaque source_json blob instead of individual columns.
-- Left alone deliberately rather than guessing which shape should win —
-- worth a real decision (migrate onto the flat table, or keep both for
-- different purposes) before anything builds on `saved_sources`.
CREATE TABLE IF NOT EXISTS user_saved_sources (
  id             TEXT NOT NULL PRIMARY KEY,
  user_id        TEXT NOT NULL,
  collection_id  TEXT, -- NULL = uncategorized, otherwise FK to user_collections.id
  source_json    TEXT NOT NULL,
  rating         INTEGER, -- NULL = unrated, 1-5 = user's star rating (Goodreads/Letterboxd-style)
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON user_saved_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_collection ON user_saved_sources(collection_id);

CREATE TABLE IF NOT EXISTS user_history (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT,
  turns_json  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_user ON user_history(user_id);

-- ============================================================
-- NEW: one-time passcode (OTP) sign-in. This is now the ONLY sign-in
-- method the frontend exposes — no password is ever collected on this
-- path. One row per email holds the CURRENT pending code only
-- (INSERT OR REPLACE on every new request), so requesting a fresh code
-- immediately invalidates any earlier one for that address.
--
-- code_hash is SHA-256(email_lower + `:` + the 6-digit code) — the raw
-- code exists nowhere at rest, only in the one email it was sent to.
-- flow_hash is SHA-256 of a random token handed to the browser as an
-- HttpOnly `cb_pending_auth` cookie when the code is sent — verify-code
-- requires BOTH the correct code AND that same cookie, so a remote
-- attacker who never requested a code for this address (and so never
-- received the cookie) cannot even attempt one guess against it over
-- the API. attempts counts wrong guesses — five burns the row outright
-- (functions/api/auth.js enforces this) — a 6-digit space is only
-- ~1,000,000 possibilities, so this ceiling is load-bearing, not
-- decorative.
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  email_lower  TEXT NOT NULL PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  flow_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- ============================================================
-- NEW: bad-data / hallucination reports, filed from the “Report bad data”
-- button on every answer (see ReportModal in main.jsx, functions/api/
-- report.js). This table was missing entirely even though report.js has
-- always attempted to INSERT into it — every report was silently dropped
-- the moment env.DB was bound, since D1 throws on an INSERT against a table
-- that was never created and report.js deliberately swallows that error (so
-- a missing table can never turn “thanks for the report” into a visible
-- failure for the person filing it). report.js now also creates this table
-- itself on first use via CREATE TABLE IF NOT EXISTS, so a fresh deploy is
-- self-healing even before this file is run against the live database —
-- this definition is kept as the canonical, documented shape.
-- ============================================================
-- ============================================================
-- Commit 50: WebRTC signaling relay for VideoHuddle's own peer-to-peer
-- calling (replacing the meet.jit.si embed, which as of August 24, 2023
-- requires an authenticated moderator to start a room — see the block
-- comment above VideoHuddle in src/main.jsx). One row per small signaling
-- message (hello/offer/answer/ice/bye); functions/api/call-signal.js also
-- creates this table itself on first use (same self-healing pattern as
-- `reports` above) and deletes rows older than 10 minutes on every write to
-- a given thread, so it never grows unbounded.
-- ============================================================
CREATE TABLE IF NOT EXISTS call_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  type        TEXT NOT NULL, -- 'hello' | 'offer' | 'answer' | 'ice' | 'bye'
  payload     TEXT NOT NULL, -- JSON
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_signals_thread ON call_signals(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_call_signals_created ON call_signals(created_at);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  query       TEXT,
  description TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  source_url  TEXT,
  created_at  INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

-- ============================================================
-- 2026-09-15 — Pro tier: AI-answer metering + Stripe idempotency.
-- One row per (user, UTC month) counts AI-synthesized answers against the
-- free monthly cap (15). Pro accounts never write here. Both tables are
-- also created on first use by ensureProTables in
-- functions/lib/proEntitlement.js, so deploys self-heal.
-- ============================================================
CREATE TABLE IF NOT EXISTS pro_usage (
  user_id    TEXT NOT NULL,
  month      TEXT NOT NULL, -- UTC YYYY-MM
  ai_answers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id    TEXT PRIMARY KEY, -- evt_* — claimed before apply, so retried
  received_at INTEGER NOT NULL  -- deliveries can never double-apply
);

-- ============================================================
-- 2026-09-15 — Shared rate limiter moved from Workers KV to D1.
-- KV's free tier allows only 1,000 writes/day and the limiter wrote one
-- key per rate-limited request, so normal traffic exhausted it in hours.
-- D1 gives ~100x the free write headroom on infrastructure already bound.
-- One row per (key, fixed window bucket); the table is also created on
-- first use by ensureTable in functions/lib/rateLimit.js, so deploys
-- self-heal. Over-limit requests never write (rejected before the upsert).
-- ============================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  k          TEXT NOT NULL PRIMARY KEY, -- rl:<scope>:<window bucket>
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL           -- ms epoch; pruned probabilistically
);
