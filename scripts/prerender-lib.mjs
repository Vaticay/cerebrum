/**
 * Small pure helpers for scripts/prerender.mjs, extracted so they can be
 * unit-tested without running the whole prerender (which needs dist/).
 */

/**
 * Demote the shell's <noscript> <h1> to a paragraph.
 *
 * index.html's <noscript> fallback carries its own <h1> ("Cerebrum"). Once
 * prerender.mjs injects the info page's own <h1> into the same document,
 * every prerendered page would carry two top-level headings. The injected
 * document markup is NOT inside a <noscript> tag (it sits directly in
 * #root), so scoping the rewrite to the <noscript> block can only touch the
 * shell's fallback heading.
 *
 * @param {string} html full document HTML
 * @returns {string} with the noscript h1 (and only it) demoted to <p>
 */
export function demoteNoscriptH1(html) {
  return html.replace(/<noscript>([\s\S]*?)<\/noscript>/, (m, inner) => {
    const demoted = inner
      .replace(/<h1(\s[^>]*)?>/g, "<p$1>")
      .replace(/<\/h1>/g, "</p>");
    return `<noscript>${demoted}</noscript>`;
  });
}
