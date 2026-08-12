// Vote endpoint: POST /api/vote
// Body: { answerId: "xxx", vote: "up" | "down" }
// Updates the score in the answer cache. Upvoted answers get served faster
// to future users. Downvoted answers get excluded from the cache.

export async function onRequest(context) {
  const { request, env } = context;

  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "https://askcerebrum.org",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "Database not configured" }),
      { status: 503, headers: cors }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { answerId, vote } = body;

    if (!answerId || (vote !== "up" && vote !== "down")) {
      return new Response(
        JSON.stringify({ error: "Need answerId and vote (up/down)" }),
        { status: 400, headers: cors }
      );
    }

    const delta = vote === "up" ? 1 : -1;

    await env.DB.prepare(
      "UPDATE answer_cache SET score = score + ? WHERE answer_id = ?"
    ).bind(delta, answerId).run();

    // Extend the learning signal to paper-level: look up which query this
    // answer belongs to, and nudge every paper attached to it in paper_cache.
    // Downvotes decay a paper's confirmation count so a bad match doesn't
    // stay force-included forever; upvotes strengthen it further.
    try {
      const row = await env.DB.prepare(
        "SELECT query_key FROM answer_cache WHERE answer_id = ?"
      ).bind(answerId).first();
      if (row && row.query_key) {
        if (vote === "up") {
          await env.DB.prepare(
            "UPDATE paper_cache SET times_confirmed = times_confirmed + 2 WHERE query_key = ?"
          ).bind(row.query_key).run();
        } else {
          await env.DB.prepare(
            "UPDATE paper_cache SET times_confirmed = MAX(0, times_confirmed - 1) WHERE query_key = ?"
          ).bind(row.query_key).run();
        }
      }
    } catch {}

    return new Response(
      JSON.stringify({ ok: true, answerId, vote }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || "Vote failed" }),
      { status: 500, headers: cors }
    );
  }
}
