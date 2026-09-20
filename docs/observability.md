# Observability — Cerebrum backend

How to tell the backend is healthy, and where to look when it isn't.

## Request IDs

Every request gets an `X-Request-ID`: the client-supplied value wins, otherwise
the edge generates one (`functions/lib/requestLog.js`). It is attached to
responses (`attachRequestId`) and included in every structured log line, so a
user report ("search hung at 14:02") becomes a grep.

## Structured logs

`jsonLog(level, event, fields)` writes one JSON object per line. Key events:

| event | meaning |
|---|---|
| `doc_job_enqueued` / `doc_job_done` | durable document job lifecycle |
| `doc_dlq_arrival` | **a document job failed after acknowledgement — investigate** |
| `stripe_webhook_dlq` | **a Stripe event failed after the 200 — reconcile it** |
| `cache_lookup` | answer-cache hit/miss (see below) |
| `llm_budget_denied` | a tenant hit its monthly token budget and degraded to non-LLM |

## Sentry

Set `SENTRY_DSN` in the Pages project environment and `reportError(env, err,
context)` (`functions/lib/requestLog.js`) forwards unhandled route errors as
Sentry envelopes. No DSN → errors stay in the worker logs only. This is the
plug-in point: one env var, no code change.

## The three symptom alarms

These are the only three worth paging on. Everything else is a dashboard.

1. **Error rate** — 5xx share of `/api/*` responses over 5 minutes. The search
   pipeline degrades (waves → cache → extractive) rather than 500ing, so a
   rising 5xx rate means something structural: D1 down, a deploy with a bad
   import, an origin misconfiguration. Check the worker logs for the
   request IDs first.

2. **p95 latency** — p95 of `/api/search` POST duration. The staged SSE stream
   (`?stream=1`) reports stage timings client-side; a p95 climb concentrated
   in `synthesizing` points at provider slowness (check circuit-breaker
   snapshots — an open breaker on the primary provider is the usual cause).
   A climb in `finding_papers` points at retrieval/D1.

3. **Failed payments** — `stripe_webhook_dlq` log lines, or rows in
   `stripe_events` with `status = 'failed'`. Stripe does NOT retry after our
   200, so each row is revenue-affecting until reconciled: resend the event
   from the Stripe Dashboard, or have the user hit "verify" (the
   `verify-session` action re-reads the Checkout Session from Stripe
   directly and closes the gap).

## Cache hit rate

`getCacheStats(env, "answer")` (`functions/lib/aiCacheStats.js`) returns
`{ hits, misses, hitRate }` for the D1 answer cache. A sudden hit-rate drop
after a deploy usually means the cache key changed, not that users changed.
