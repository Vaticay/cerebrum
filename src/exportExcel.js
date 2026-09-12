/**
 * Excel export for Cerebrum paper lists.
 *
 * Plain JS module — no React, no JSX — so it can be lazy-loaded by the app
 * (`await import("./exportExcel.js")`) without dragging exceljs into the main
 * bundle, and so it can be unit-tested in plain node.
 *
 * `exportPapersToExcel(papers, opts)` builds a real .xlsx of the first 20
 * papers: Cerebrum logo (when a DOM is available), title + subtitle rows, a
 * styled header, one row per paper with a real hyperlink cell, frozen panes
 * and an autofilter. `buildPapersWorkbook(papers, opts)` exposes the workbook
 * itself for tests and non-download consumers.
 *
 * Paper shape: { title, authors, journal, year, url }. `authors` is normally
 * a pre-joined string but an array is tolerated. Every field is optional.
 */

import ExcelJS from "exceljs";

const MAX_PAPERS = 20;
const DEFAULT_FILENAME = "cerebrum-papers.xlsx";
const DEFAULT_TITLE = "Cerebrum — Top papers";
const DEFAULT_ACCENT = "#475569"; // slate; the app passes the user's accent via opts.accent

const COLUMNS = [
  { key: "n", header: "#", width: 5 },
  { key: "title", header: "Title", width: 62 },
  { key: "authors", header: "Authors", width: 42 },
  { key: "journal", header: "Journal", width: 30 },
  { key: "year", header: "Year", width: 9 },
  { key: "link", header: "Link", width: 11 },
];

/* Only http(s) URLs become hyperlinks — a javascript: or data: URL in a
   paper record must never turn into a clickable cell. */
function safeHttpUrl(url) {
  if (typeof url !== "string") return null;
  const t = url.trim();
  return /^https?:\/\/[^\s]+$/i.test(t) ? t : null;
}

function cleanText(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function authorsText(authors) {
  if (Array.isArray(authors)) return cleanText(authors.filter(Boolean).join(", "));
  return cleanText(authors);
}

function accentArgb(accent) {
  const m = typeof accent === "string" && accent.match(/^#([0-9a-f]{6})$/i);
  const hex = m ? m[1] : DEFAULT_ACCENT.slice(1);
  return "FF" + hex.toUpperCase();
}

/* Render an SVG markup string to a PNG buffer via canvas. DOM-only: callers
   in non-DOM environments (node tests, SSR) get null and skip the logo
   rather than crashing. The SVG is rasterized at 2x for crisp print. */
async function svgToPngBuffer(svgMarkup, cssWidth, cssHeight) {
  if (typeof document === "undefined") return null;
  if (typeof svgMarkup !== "string" || !svgMarkup.includes("<svg")) return null;
  try {
    let svg = svgMarkup;
    if (!/width=/.test(svg)) svg = svg.replace(/<svg\b/, `<svg width="${cssWidth}" height="${cssHeight}"`);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("logo image failed to decode"));
        el.src = url;
      });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cssWidth * scale);
      canvas.height = Math.round(cssHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!out) return null;
      return await out.arrayBuffer();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null; // a broken logo must never break the export
  }
}

/**
 * Build the workbook. Pure apart from the optional logo rasterization
 * (skipped automatically outside a DOM).
 */
export async function buildPapersWorkbook(papers, opts = {}) {
  const list = Array.isArray(papers) ? papers.slice(0, MAX_PAPERS) : [];
  const title = typeof opts.title === "string" && opts.title ? opts.title : DEFAULT_TITLE;
  const subtitle =
    typeof opts.subtitle === "string" && opts.subtitle
      ? opts.subtitle
      : `Exported from Cerebrum · ${new Date().toLocaleDateString()}`;
  const headerFill = accentArgb(opts.accent);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cerebrum";
  wb.created = new Date();
  const ws = wb.addWorksheet("Top papers", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 0 }],
  });

  /* ── Logo row ── */
  ws.getRow(1).height = 46;
  const logoPng = await svgToPngBuffer(opts.logoSvg, 168, 40);
  if (logoPng) {
    const imageId = wb.addImage({ buffer: logoPng, extension: "png" });
    // tl is 0-indexed; the image floats over A1:E1.
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 168, height: 40 } });
  }

  /* ── Title / subtitle ── */
  ws.mergeCells("A2:F2");
  const titleCell = ws.getCell("A2");
  titleCell.value = title;
  titleCell.font = { size: 16, bold: true, color: { argb: "FF1F2937" } };
  titleCell.alignment = { vertical: "middle" };
  ws.getRow(2).height = 28;

  ws.mergeCells("A3:F3");
  const subCell = ws.getCell("A3");
  subCell.value = subtitle;
  subCell.font = { size: 10, color: { argb: "FF6B7280" } };
  subCell.alignment = { vertical: "middle" };
  ws.getRow(3).height = 18;

  ws.getRow(4).height = 8; // breathing room before the header

  /* ── Header row (row 5) ── */
  const headerRow = ws.getRow(5);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
    cell.alignment = { vertical: "center", horizontal: i === 0 ? "center" : "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  ws.autoFilter = "A5:F5";
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
  });

  /* ── Paper rows ── */
  list.forEach((p, idx) => {
    const paper = p && typeof p === "object" ? p : {};
    const row = ws.getRow(6 + idx);
    const url = safeHttpUrl(paper.url);

    row.getCell(1).value = idx + 1;
    row.getCell(1).alignment = { vertical: "center", horizontal: "center" };

    row.getCell(2).value = cleanText(paper.title) || "Untitled";
    row.getCell(2).alignment = { vertical: "center", wrapText: true };

    row.getCell(3).value = authorsText(paper.authors);
    row.getCell(3).alignment = { vertical: "center", wrapText: true };

    row.getCell(4).value = cleanText(paper.journal);
    row.getCell(4).alignment = { vertical: "center", wrapText: true };

    const year = cleanText(paper.year);
    row.getCell(5).value = year;
    row.getCell(5).alignment = { vertical: "center", horizontal: "center" };

    const linkCell = row.getCell(6);
    if (url) {
      linkCell.value = { text: "Open", hyperlink: url };
      linkCell.font = { color: { argb: "FF2563EB" }, underline: true };
    }
    linkCell.alignment = { vertical: "center", horizontal: "center" };

    row.height = 30;
    if (idx % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });
    }
  });

  return { workbook: wb, count: list.length };
}

/**
 * Build the workbook and trigger an in-browser download.
 * opts: { title, subtitle, filename, logoSvg, accent } — all optional.
 * Returns { count, filename }.
 */
export async function exportPapersToExcel(papers, opts = {}) {
  const filename =
    typeof opts.filename === "string" && opts.filename.trim()
      ? opts.filename.trim()
      : DEFAULT_FILENAME;
  const { workbook, count } = await buildPapersWorkbook(papers, opts);
  const buffer = await workbook.xlsx.writeBuffer();

  // Node / non-DOM callers (tests): no download, just the result.
  if (typeof document !== "undefined") {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  return { count, filename };
}
