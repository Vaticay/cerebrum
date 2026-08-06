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
