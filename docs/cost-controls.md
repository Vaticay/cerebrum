# Cost controls — LLM spend

Cerebrum's synthesis fans out across paid providers per query. These are the
guardrails that keep a traffic spike or a bug from turning into a bill.

## Monthly per-tenant token budgets (`functions/lib/costControl.js`)

- Every tenant (user id, or the anonymous bucket) gets a monthly token cap.
  Defaults live in `DEFAULT_BUDGETS` per tier (`anonymous` / `free` / `pro`).
- `checkTokenBudget(env, userId, estimatedTokens, tier)` is called BEFORE
  the LLM call. Over budget → the call is refused and the pipeline degrades
  to the non-LLM path (cache → extractive), with a structured
  `llm_budget_denied` log.
- `spendTokens(env, userId, tokens)` consumes atomically — concurrent legs
  racing the same budget can never overshoot it (guarded INSERT … ON
  CONFLICT … WHERE).
- Actual usage and estimated spend per tenant/model/month are recorded by
  `recordLlmUsage` (`functions/lib/requestLog.js`), backed by D1 when bound
  with an in-memory fallback.

## Cheap-model-first routing

`classifyComplexity({ queryLength, historyTurns, sourceCount, ambiguous,
multiPart })` scores 0–1. Below 0.35 the cheap model is tried first; at or
above, the primary model leads. This is a heuristic router, not a quality
judgment — the wave race still lets the better answer win.

## Operator override

`setTenantCap(env, userId, tokenCap)` replaces the tier default for one
tenant (founder grants, abuse containment, load tests). There is no UI for
this; it is an operator action via D1.

## Where the budget is enforced

- `postChatCompletion` (all OpenAI-shaped calls in search.js): prompt clamped
  to `MAX_PROMPT_CHARS`, breaker-guarded, budget-checked.
- The synthesis wave legs (`callOR` / `callCompat` / `callCF` /
  `pollinationsCall`): circuit breakers fail fast on a sick provider so a
  dead model stops burning quota on every wave.
- Document analysis (`generate` in document.js): same budget path; the
  durable job mode (`?async=1`) is metered identically — async is a
  scheduling choice, not a cheaper one.
