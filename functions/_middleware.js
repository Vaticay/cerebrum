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

const CANONICAL_HOST = "askcerebrum.org";
const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function onRequest(context) {
  let url;
  try {
    url = new URL(context.request.url);
  } catch {
    // Unparseable URL: do not invent a redirect, just continue.
    return context.next();
  }
  const host = url.hostname.toLowerCase();
  if (host !== CANONICAL_HOST && !DEV_HOSTS.has(host)) {
    const target = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
    return Response.redirect(target, 301);
  }
  return context.next();
}
