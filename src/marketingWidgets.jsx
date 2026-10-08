/**
 * marketingWidgets.jsx — interactive widgets for the marketing/info pages.
 *
 * QuotaCalculator (pricing) and LiveDemo (about, features). Rendered by
 * InfoPage in CerebrumApp.jsx from the same data the prerender script uses,
 * so the static documents and the app cannot drift on copy.
 */

import React from "react";
import { RADIUS, FONT_SIZES, TRACKING } from "./designSystem.jsx";
import { DEMO_QUESTIONS } from "./marketingContent.js";

/**
 * Quota calculator (pricing page widget).
 *
 * An interactive slider, 1 to 100 questions in a typical week, with a live
 * readout that lets the visitor feel the free tier math instead of reading
 * it. Free is 50 AI answers every 5 days, about 70 a week. Under that, free
 * covers you. Over it, the readout names how often the cap would bite, and
 * Pro sits beside it as the never count option.
 */
export function QuotaCalculator({ P, accent, isMobile }) {
  const [perWeek, setPerWeek] = React.useState(20);
  const WEEKLY_CAPACITY = 70; // 50 answers per 5 days
  const covers = perWeek <= WEEKLY_CAPACITY;
  const daysPerCap = Math.max(1, Math.round(350 / perWeek));
  return (
    <div style={{
      marginTop: 18, padding: isMobile ? "20px 18px" : "24px 26px",
      borderRadius: RADIUS.lg, border: `1px solid ${P.line}`, background: P.surface,
    }}>
      <label htmlFor="cb-quota-slider" style={{ display: "block", fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink, fontFamily: "var(--cb-font)", marginBottom: 4 }}>
        Questions in a typical week
      </label>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent, fontFamily: "var(--cb-font)", fontVariantNumeric: "tabular-nums", marginBottom: 10 }}>
        {perWeek}
      </div>
      <input
        id="cb-quota-slider"
        type="range" min={1} max={100} step={1} value={perWeek}
        onChange={(e) => setPerWeek(Number(e.target.value))}
        aria-label="Questions in a typical week"
        style={{ width: "100%", minHeight: 44, accentColor: accent, cursor: "pointer" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)", marginTop: 2 }}>
        <span>1</span><span>100</span>
      </div>
      <div aria-live="polite" style={{
        marginTop: 14, padding: "14px 16px", borderRadius: RADIUS.md,
        background: covers ? "rgba(16,185,129,0.08)" : "rgba(217,165,32,0.08)",
        border: `1px solid ${covers ? "rgba(16,185,129,0.35)" : "rgba(217,165,32,0.4)"}`,
      }}>
        {covers ? (
          <>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-font)" }}>Free covers you.</div>
            <p style={{ fontSize: FONT_SIZES.caption, lineHeight: 1.6, color: P.ink2, margin: "6px 0 0", fontFamily: "var(--cb-font)" }}>
              50 answers every 5 days works out to about 70 a week. At {perWeek} a week, you have headroom.
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-font)" }}>
              You would hit the free cap every {daysPerCap} {daysPerCap === 1 ? "day" : "days"}.
            </div>
            <p style={{ fontSize: FONT_SIZES.caption, lineHeight: 1.6, color: P.ink2, margin: "6px 0 0", fontFamily: "var(--cb-font)" }}>
              Then you wait for the refill. Pro is unlimited answers at $20 a month, so you never count.
            </p>
          </>
        )}
      </div>
      <a href="/" style={{ display: "inline-block", marginTop: 14, fontSize: FONT_SIZES.caption, fontWeight: 700, color: accent, textDecoration: "none", fontFamily: "var(--cb-font)" }}>
        Start free, no account needed
      </a>
    </div>
  );
}

/**
 * One-question live demo (about + features pages).
 *
 * Three sample questions with cached sample answers and real, clickable
 * citations. Fixed snapshots, not live search, so the page never depends on
 * the API. A visitor sees what a Cerebrum answer looks like before signing
 * up for anything.
 */
export function LiveDemo({ P, accent, isMobile }) {
  const [active, setActive] = React.useState(0);
  const demo = DEMO_QUESTIONS[active] || DEMO_QUESTIONS[0];
  const chip = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 22, height: 22, padding: "0 6px", margin: "0 2px",
    borderRadius: 6, border: `1px solid ${P.line2}`,
    background: P.raised, color: accent,
    fontSize: 12, fontWeight: 700, fontFamily: "var(--cb-font)",
    textDecoration: "none", verticalAlign: "super", lineHeight: 1,
  };
  return (
    <div style={{
      marginTop: 40, padding: isMobile ? "22px 18px" : "28px 30px",
      borderRadius: RADIUS.lg, border: `1px solid ${P.line}`, background: P.surface,
    }}>
      <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: TRACKING.tight, color: accent, fontFamily: "var(--cb-font)", marginBottom: 10 }}>
        SEE WHAT AN ANSWER LOOKS LIKE
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {DEMO_QUESTIONS.map((d, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            aria-pressed={active === i}
            style={{
              minHeight: 44, padding: "10px 16px", borderRadius: 9999, cursor: "pointer",
              border: `1px solid ${active === i ? accent : P.line2}`,
              background: active === i ? accent : "transparent",
              color: active === i ? "#0b0b0e" : P.ink,
              fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-font)",
            }}
          >
            {d.q}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {demo.paragraphs.map((para, i) => (
          <p key={i} style={{ fontSize: FONT_SIZES.body, lineHeight: 1.7, color: P.ink2, margin: "0 0 12px", fontFamily: "var(--cb-font)" }}>
            {para.text}
            {(para.cites || []).map((n) => {
              const src = demo.sources[n - 1];
              return src ? (
                <a key={n} href={src.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${src.title}`} style={chip}>
                  {n}
                </a>
              ) : null;
            })}
          </p>
        ))}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${P.line}` }}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, letterSpacing: TRACKING.tight, color: P.faint, fontFamily: "var(--cb-font)", marginBottom: 8 }}>
            SOURCES
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {demo.sources.map((s, i) => (
              <li key={i} style={{ fontSize: FONT_SIZES.caption, lineHeight: 1.55, color: P.ink2, fontFamily: "var(--cb-font)" }}>
                <span style={{ fontWeight: 700, color: accent, marginRight: 8 }}>[{i + 1}]</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: P.ink, textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: P.line2 }}>
                  {s.title}
                </a>
                <span style={{ color: P.faint }}> {s.venue}, {s.year}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p style={{ fontSize: FONT_SIZES.caption, color: P.faint, margin: "16px 0 0", fontFamily: "var(--cb-font)", lineHeight: 1.6 }}>
        A cached sample, not a live search. Every citation above is a real paper you can open.
      </p>
      <a href="/" style={{ display: "inline-block", marginTop: 10, fontSize: FONT_SIZES.caption, fontWeight: 700, color: accent, textDecoration: "none", fontFamily: "var(--cb-font)" }}>
        Ask your own question, free
      </a>
    </div>
  );
}
