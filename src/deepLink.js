/**
 * `?q=` deep-link search.
 *
 * index.html's SearchAction structured data advertises
 * https://askcerebrum.org/?q={search_term_string} as the search URL, so
 * arriving with ?q= must actually search — prefill the composer and run the
 * question once on load. Kept as a pure helper (no window access inside the
 * parser) so it can be unit-tested.
 *
 * Coexistence rules:
 * - `?magic=` (magic-link sign-in) owns the URL when both are present: the
 *   sign-in flow consumes and strips the query string itself.
 * - `#pro=` (Stripe checkout return) is a fragment, handled by a separate
 *   effect; it never conflicts with a query param.
 *
 * @param {string} search window.location.search (with or without leading ?)
 * @returns {string|null} the trimmed query, or null when there is none
 */
export function getDeepLinkQuery(search) {
  let params;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    return null;
  }
  // Magic-link sign-in takes precedence over a deep-linked search.
  if (params.get("magic")) return null;
  const q = (params.get("q") || "").trim();
  return q ? q : null;
}
