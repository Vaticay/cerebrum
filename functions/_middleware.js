/**
 * Canonical-host middleware.
 *
 * THE PROBLEM THIS SOLVES
 * The site is served on askcerebrum.org, but Cloudflare Pages also serves
 * every deployment on its *.pages.dev origin (e.g. cerebrum-2pz.pages.dev)
 * with no redirect and no noindex. The full site — same content, same
 * canonical tags — is reachable on two hosts, which splits ranking signals
 * and crawl budget between them. Canonical tags mitigate; they do not fix.
 *
 * This middleware 301-redirects every request whose hostname is not the
 * canonical one, preserving path and query. Local development hostnames
 * (localhost, 127.0.0.1, ::1) are left alone so `wrangler pages dev` keeps
 * working.
 *
 * Safety properties (all covered by tests/seo-host-redirect.mjs):
 * - No redirect loops: the target is always the canonical host, and a
 *   request already on the canonical host is never redirected.
 * - /api/* on the canonical host passes straight through to the function
 *   handlers (context.next()); only the host redirect can reroute it.
 * - Static assets are unaffected on the canonical host: the middleware
 *   calls context.next() and Pages serves them normally.
 *
 * NOTE: this also redirects *.pages.dev preview deployments to production.
 * That is deliberate — previews were the duplicate-host problem.
 */

import { getRequestId, jsonLog } from "./lib/requestLog.js";

const CANONICAL_HOST = "askcerebrum.org";
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function onRequest(context) {
  // Nuance #30 — one request ID per request, generated centrally. A
  // client-supplied X-Request-ID wins (validated); otherwise we mint one.
  // It is stashed on context.data so route handlers log with the SAME id
  // instead of minting their own, and stamped on every response —
  // redirects, API routes, and static assets alike.
  const requestId = getRequestId(context.request);
  if (!context.data) context.data = {};
  context.data.requestId = requestId;
  const t0 = Date.now();
  const withId = (res) => {
    try {
      res.headers.set("X-Request-ID", requestId);
    } catch {
      // Immutable headers (e.g. a route's own redirect) — the id is still
      // in the logs; don't break the response to stamp it.
    }
    return res;
  };
  let url;
  try {
    url = new URL(context.request.url);
  } catch {
    // Unparseable URL: do not invent a redirect, just continue.
    return withId(await context.next());
  }
  const host = url.hostname.toLowerCase();
  const method = context.request.method || "GET";
  const path = url.pathname;
  if (host !== CANONICAL_HOST && !DEV_HOSTS.has(host)) {
    const target = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
    jsonLog("info", "redirect_canonical", { requestId, method, path, from: host });
    // Built manually (not Response.redirect) so the headers stay mutable
    // and the request id rides along on the redirect too.
    return withId(new Response(null, { status: 301, headers: { location: target } }));
  }
  jsonLog("info", "request_start", { requestId, method, path });
  let res;
  try {
    res = await context.next();
  } catch (e) {
    jsonLog("error", "request_error", {
      requestId, method, path,
      ms: Date.now() - t0,
      error: String((e && e.message) || e).slice(0, 200),
    });
    throw e;
  }
  jsonLog("info", "request_end", { requestId, method, path, status: res.status, ms: Date.now() - t0 });
  return withId(res);
}
