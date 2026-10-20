/**
 * pdfFonts.js: embeddable typefaces for the answer PDF export.
 *
 * Added 2026-10-20 (design audit H14 remainder). The PDF builder in
 * CerebrumApp.jsx used to map its serif and sans roles onto the jsPDF
 * built in PostScript faces (times and helvetica) because the repo
 * shipped Source Serif 4 and Inter as woff2 webfonts only, which
 * jsPDF cannot embed. The repo now ships static TrueType faces for
 * both families under public/fonts/ttf/ (SIL Open Font License 1.1,
 * see public/fonts/ttf/SOURCES.md and OFL.txt), and this module is
 * the only place that knows about them.
 *
 * Plain JS module, no React, no JSX, so the PDF builder can lazy load
 * it with a dynamic import at export time, the same demand path as
 * the lazy jspdf import itself. Nothing here runs, and no font byte
 * is fetched, until a PDF export asks for it, so page weight
 * elsewhere is untouched.
 *
 * Registration contract: registerPdfFonts(doc) fetches every face in
 * PDF_FONT_SPECS, converts it to base64, then calls
 * doc.addFileToVFS(file, base64) and doc.addFont(file, family, style)
 * for each one. On success it resolves to the registered family
 * names. On any failure it throws, so the caller can fall back to the
 * built in faces with the failure logged, never silently.
 */

/* Family names registered inside the PDF. Short names with no spaces
   keep jsPDF font keys simple and stable for tests to pin. */
export const PDF_SERIF_FAMILY = "SourceSerif4";
export const PDF_SANS_FAMILY = "Inter";

/* Built in jsPDF faces, used only as the honest fallback when the
   embedded faces cannot be loaded. */
export const PDF_SERIF_FALLBACK = "times";
export const PDF_SANS_FALLBACK = "helvetica";

/* Every face the PDF builder can select. The serif set is complete
   (normal, bold, italic, bolditalic) because body runs carry bold
   and italic, including italic species names. The sans set carries
   the same four styles; the builder uses normal and bold today.
   Paths are site absolute so the fetch works from any route. */
export const PDF_FONT_SPECS = Object.freeze([
  Object.freeze({ family: PDF_SERIF_FAMILY, style: "normal", file: "SourceSerif4-Regular.ttf", path: "/fonts/ttf/SourceSerif4-Regular.ttf" }),
  Object.freeze({ family: PDF_SERIF_FAMILY, style: "bold", file: "SourceSerif4-Bold.ttf", path: "/fonts/ttf/SourceSerif4-Bold.ttf" }),
  Object.freeze({ family: PDF_SERIF_FAMILY, style: "italic", file: "SourceSerif4-Italic.ttf", path: "/fonts/ttf/SourceSerif4-Italic.ttf" }),
  Object.freeze({ family: PDF_SERIF_FAMILY, style: "bolditalic", file: "SourceSerif4-BoldItalic.ttf", path: "/fonts/ttf/SourceSerif4-BoldItalic.ttf" }),
  Object.freeze({ family: PDF_SANS_FAMILY, style: "normal", file: "Inter-Regular.ttf", path: "/fonts/ttf/Inter-Regular.ttf" }),
  Object.freeze({ family: PDF_SANS_FAMILY, style: "bold", file: "Inter-Bold.ttf", path: "/fonts/ttf/Inter-Bold.ttf" }),
  Object.freeze({ family: PDF_SANS_FAMILY, style: "italic", file: "Inter-Italic.ttf", path: "/fonts/ttf/Inter-Italic.ttf" }),
  Object.freeze({ family: PDF_SANS_FAMILY, style: "bolditalic", file: "Inter-BoldItalic.ttf", path: "/fonts/ttf/Inter-BoldItalic.ttf" }),
]);

/* Convert raw font bytes to the base64 string jsPDF addFileToVFS
   expects. Chunked so a large face never hits the argument limit of
   String.fromCharCode in one call. Works in browsers and in node. */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/* Base64 cache for the default fetch path only. Custom byte loaders
   (tests and node proofs) bypass the cache, so a test double can
   never poison a real export or the other way round. */
const base64Cache = new Map();

export function clearPdfFontCache() {
  base64Cache.clear();
}

function fontUrl(spec, deps) {
  const base = deps && typeof deps.baseUrl === "string" ? deps.baseUrl.replace(/\/+$/, "") : "";
  return base + spec.path;
}

async function fetchFontBytes(spec, deps) {
  if (deps && typeof deps.fetchBytes === "function") {
    const bytes = await deps.fetchBytes(spec);
    if (!bytes || !bytes.byteLength) throw new Error("pdfFonts: empty bytes for " + spec.file);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }
  const fetchImpl = (deps && deps.fetchImpl) || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) throw new Error("pdfFonts: no fetch available for " + spec.file);
  const res = await fetchImpl(fontUrl(spec, deps || {}));
  if (!res || res.ok === false) {
    throw new Error("pdfFonts: fetch failed for " + spec.file + " (status " + (res && res.status) + ")");
  }
  const buf = typeof res.arrayBuffer === "function" ? await res.arrayBuffer() : res;
  if (!buf || !buf.byteLength) throw new Error("pdfFonts: empty response for " + spec.file);
  return new Uint8Array(buf);
}

/* Load one face as base64. The four byte TrueType magic is checked so
   a 404 page or a woff2 served by mistake fails loudly here instead
   of producing a corrupt PDF downstream. */
export async function loadPdfFontBase64(spec, deps) {
  const useCache = !(deps && (deps.fetchBytes || deps.fetchImpl || deps.noCache));
  const key = fontUrl(spec, deps || {});
  if (useCache && base64Cache.has(key)) return base64Cache.get(key);
  const promise = (async () => {
    const bytes = await fetchFontBytes(spec, deps || {});
    if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x01 || bytes[2] !== 0x00 || bytes[3] !== 0x00) {
      throw new Error("pdfFonts: " + spec.file + " is not a TrueType file");
    }
    return bytesToBase64(bytes);
  })();
  if (useCache) {
    base64Cache.set(key, promise);
    promise.catch(() => { if (base64Cache.get(key) === promise) base64Cache.delete(key); });
  }
  return promise;
}

/* Load every face in PDF_FONT_SPECS as { family, style, file, base64 }. */
export async function loadPdfFonts(deps) {
  const loaded = [];
  for (const spec of PDF_FONT_SPECS) {
    loaded.push({ family: spec.family, style: spec.style, file: spec.file, base64: await loadPdfFontBase64(spec, deps) });
  }
  return loaded;
}

/* Register every embedded face on a jsPDF document. Throws on any
   failure (bad document, failed fetch, bad font bytes, or a face
   jsPDF does not report back afterwards), so the caller fallback is
   a deliberate, logged branch and tests can catch the signal. */
export async function registerPdfFonts(doc, deps) {
  if (!doc || typeof doc.addFileToVFS !== "function" || typeof doc.addFont !== "function") {
    throw new Error("pdfFonts: document does not support addFileToVFS and addFont");
  }
  const loaded = await loadPdfFonts(deps);
  for (const font of loaded) {
    doc.addFileToVFS(font.file, font.base64);
    doc.addFont(font.file, font.family, font.style);
  }
  if (typeof doc.getFontList === "function") {
    const list = doc.getFontList() || {};
    for (const font of loaded) {
      const styles = list[font.family] || [];
      if (!styles.includes(font.style)) {
        throw new Error("pdfFonts: jsPDF did not register " + font.family + " " + font.style);
      }
    }
  }
  return { serif: PDF_SERIF_FAMILY, sans: PDF_SANS_FAMILY, registered: loaded.map((f) => ({ family: f.family, style: f.style, file: f.file })) };
}
