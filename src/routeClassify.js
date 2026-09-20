/**
 * Route classification for the SPA shell (src/main.jsx Root).
 *
 * Pure module with no JSX so the dispatch logic is unit-testable under
 * node: given a raw pathname, decide whether it is the application, one of
 * the prerendered info pages, or a dead end that must render the 404 view.
 * The app never reads the pathname for routing, so anything that is neither
 * the root nor a known info slug has no static file and no function behind
 * it — rendering the search UI there would be wrong, and serving the 404
 * view is the safe half of the story (see tests/seo-404.mjs).
 *
 * Normalization mirrors the shell: a trailing `.html` (e.g. someone typing
 * /about.html) and trailing slashes are folded away before classification.
 *
 * The marketing slugs (/features, /pricing, /document-mode, /diagram-studio,
 * /investigations) live here too: their content is defined in
 * src/marketingContent.js and prerendered by scripts/prerender.mjs, and the
 * SPA's InfoPage renders them from the same object (frontend wires the
 * lookup; see docs/video-cdn-frontend-map.md's sibling note in the report).
 */
export const INFO_SLUGS = [
  "about", "privacy", "terms", "disclosures", "contact",
  "features", "pricing", "document-mode", "diagram-studio", "investigations",
];

export function classifyRoute(rawPath) {
  const path = (rawPath || "").replace(/\.html$/, "").replace(/\/+$/, "");
  const slug = path.replace(/^\//, "");
  if (INFO_SLUGS.includes(slug)) return { kind: "info", slug };
  if (slug === "" || slug === "index") return { kind: "app" };
  return { kind: "notfound" };
}
