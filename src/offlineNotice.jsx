/**
 * OfflineNotice — the shell offline state (2026-10-20, design audit
 * M6: Shell scored 930 against a 950 floor, in part because it had no
 * designed offline state at all).
 *
 * Contract:
 *   - Renders only while the connection monitor reports offline, and
 *     removes itself the moment the connection returns. No dismissal,
 *     no modal, nothing for the reader to clear.
 *   - A solid opaque surface in the palette surface token, never a
 *     translucent layer over content, on the named banner z slot.
 *   - Plain honest wording: what still works (reading what is already
 *     loaded) and what waits (new searches, sync, calls). It never
 *     claims anything was saved or sent. The app holds no search
 *     outbox, so nothing in this copy speaks of a queue; the search
 *     copy below states that plainly instead.
 *   - No dash characters of any kind in the copy, per Dusty's rule.
 *
 * The search strings live here too so the banner and the search error
 * panel (searchErrorInfo, kind "offline", in CerebrumApp.jsx) can
 * never drift into saying two different things.
 */

import React from "react";
import { TYPE, Z } from "./designSystem.jsx";

export const OFFLINE_TITLE = "You are offline";
export const OFFLINE_WORKS = "Reading still works. Anything already loaded in the app, including saved work and answers on screen, stays readable.";
export const OFFLINE_WAITS = "New searches, sync, and calls wait until the connection returns. Nothing new is sent while you are offline.";
export const OFFLINE_SEARCH_HEADLINE = "You are offline, so this search cannot start.";
export const OFFLINE_SEARCH_BODY = "Nothing was sent and nothing was queued. Your question is back in the box, ready to run when the connection returns.";

export function OfflineNotice({ P, online }) {
  if (online || !P) return null;
  return (
    <div role="status" data-cb-offline-notice="true"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: Z.banner,
        background: P.surface, borderBottom: `1px solid ${P.line2 || P.line}`,
        padding: "12px 16px", display: "flex", gap: 12,
        alignItems: "flex-start", justifyContent: "center",
      }}>
      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: P.faint, flexShrink: 0, marginTop: 5 }} />
      <div style={{ maxWidth: 720 }}>
        <div style={{ ...TYPE.label, color: P.ink, marginBottom: 4 }}>{OFFLINE_TITLE}</div>
        <div style={{ ...TYPE.body, color: P.ink2 }}>{OFFLINE_WORKS}</div>
        <div style={{ ...TYPE.body, color: P.ink2 }}>{OFFLINE_WAITS}</div>
      </div>
    </div>
  );
}

export default OfflineNotice;
