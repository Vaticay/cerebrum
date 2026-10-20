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
 * - `?magic=` no longer signs anyone in (the magic verify path was
 *   removed 2026-10-20, Lane C item 9: the auth server never
 *   implemented it and no server code issues such links). The session
 *   effect strips a stray `?magic=` on load; this parser still yields
 *   to it defensively when one is somehow present.
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
  // Defensive yield to a stray magic param (see the header note,
  // 2026-10-20): the session effect normally strips it before this runs.
  if (params.get("magic")) return null;
  const q = (params.get("q") || "").trim();
  return q ? q : null;
}
