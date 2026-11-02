/* ledger.jsx — the Instrument ledger components (Wave 2, 2026-11-02).
   Built for the Library first, as the plan orders, and shared by
   Settings and Inbox so the three surfaces read as one instrument:
   a serif head word, a display size numeral where a count is the
   fact, sections titled in the serif on a hairline rule, and rows
   that are a serif title over a mono caption, ruled, with no fill,
   no radius, no shadow, and no arrow.

   Ground note: these components take their colours from the
   register ink family only. The surface ground itself is chosen by
   each view through its one named surface ground expression (for
   example LIBRARY_SURFACE_GROUND in CerebrumApp.jsx) so the Wave 0
   resolver can be swapped in at merge time in exactly one place per
   surface. */
import React from "react";
import { REGISTER_GOLD, REGISTER_INK, REGISTER_LINE, REGISTER_LINE_STRONG, REGISTER_SERIF } from "./registerTokens.js";

/* The hairline: the register ink at rule strength, consumed from
   the token file (merge fix, 2026-11-02: the literals that stood
   here failed the register gate the same morning). */
export const LEDGER_LINE = REGISTER_LINE;
export const LEDGER_LINE_STRONG = REGISTER_LINE_STRONG;

/* The ledger head: the surface word in the serif at 26, the count
   as a display size serif numeral, and its label in mono under it. */
export function LedgerHead({ word, count, countLabel, children }) {
  return (
    <header style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: REGISTER_SERIF, fontSize: 26, fontWeight: 500, color: REGISTER_INK.ink, lineHeight: 1.2 }}>{word}</h1>
        {children}
      </div>
      {typeof count === "number" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: REGISTER_SERIF, fontSize: 96, lineHeight: 0.95, fontWeight: 400, color: REGISTER_INK.ink, fontVariantNumeric: "tabular-nums" }}>{count}</div>
          {countLabel && (
            <div style={{ fontFamily: "var(--cb-mono)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: REGISTER_INK.ink55, marginTop: 10 }}>{countLabel}</div>
          )}
        </div>
      )}
    </header>
  );
}

/* A ledger section: a serif title at 26 on a hairline rule, then the
   rows. An optional gold word action sits at the right of the title,
   the only gold a section may carry. */
export function LedgerSection({ title, action, children, id }) {
  return (
    <section id={id} style={{ marginTop: 40 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, borderTop: `1px solid ${LEDGER_LINE_STRONG}`, paddingTop: 14, marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontFamily: REGISTER_SERIF, fontSize: 26, fontWeight: 500, color: REGISTER_INK.ink, lineHeight: 1.25 }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* A ledger row: serif title at 18, mono caption under it, ruled
   above, no fill in any state. The row body is a button when the row
   opens something; trailing word actions render after it. */
export function LedgerRow({ title, meta, detail, onClick, children, ariaLabel }) {
  const body = (
    <>
      <span style={{ display: "block", fontFamily: REGISTER_SERIF, fontSize: 18, fontWeight: 500, color: REGISTER_INK.ink, lineHeight: 1.35 }}>{title}</span>
      {meta && (
        <span style={{ display: "block", fontFamily: "var(--cb-mono)", fontSize: 12, color: REGISTER_INK.ink72, marginTop: 4, lineHeight: 1.6 }}>{meta}</span>
      )}
      {detail && (
        <span style={{ display: "block", fontFamily: REGISTER_SERIF, fontSize: 14, color: REGISTER_INK.ink72, marginTop: 5, lineHeight: 1.55 }}>{detail}</span>
      )}
    </>
  );
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, borderTop: `1px solid ${LEDGER_LINE}`, padding: "13px 0" }}>
      {onClick ? (
        <button type="button" aria-label={ariaLabel || (typeof title === "string" ? title : undefined)} onClick={onClick}
          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", font: "inherit" }}>
          {body}
        </button>
      ) : (
        <span style={{ flex: 1, minWidth: 0 }}>{body}</span>
      )}
      {children}
    </div>
  );
}

/* A gold word action: gold appears in these surfaces as a word, a
   rule, or a mark, never as a fill. This is the word form. */
export function LedgerWordAction({ children, onClick, ariaLabel, disabled }) {
  return (
    <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={onClick}
      style={{ background: "none", border: "none", padding: "6px 2px", margin: 0, cursor: disabled ? "default" : "pointer", color: REGISTER_GOLD, fontFamily: "var(--cb-font)", fontSize: 14, fontWeight: 500, opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

/* The one ruled search field: a transparent input on a hairline. */
export function LedgerSearch({ value, onChange, placeholder, ariaLabel }) {
  return (
    <div style={{ borderBottom: `1px solid ${LEDGER_LINE_STRONG}`, paddingBottom: 8, marginBottom: 8 }}>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel || placeholder}
        style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: REGISTER_INK.ink, fontFamily: REGISTER_SERIF, fontSize: 18, padding: 0 }} />
    </div>
  );
}
