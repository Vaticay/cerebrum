/**
 * appUtils.js — Shared application utilities.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * Pure helpers with no UI: API layer, cookies, toast events, time formatting,
 * avatar tones, notification prefs, version constants, and small utilities.
 */

import { useState, useEffect } from "react";
import { STATUS } from "./designSystem.jsx";

function setCookie(k, v) { try { document.cookie = `${k}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`; } catch (cbErr) { console.error("[Cerebrum] appUtils.js setCookie: document.cookie assignment:", cbErr); } if (k === "cb_anim2") { try { cbMotionCacheBust(); } catch (cbErr) { console.error("[Cerebrum] appUtils.js if: cbMotionCacheBust(); }:", cbErr); } } }

function ensureDyslexicFont() {
  if (typeof document === "undefined" || document.getElementById("cb-dyslexic-font")) return;
  const df = document.createElement("link");
  df.id = "cb-dyslexic-font"; df.rel = "stylesheet";
  df.href = "/fonts/opendyslexic.css";
  document.head.appendChild(df);
}

function getCookie(k) { try { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const APP_VERSION = "6.20.0";
const APP_VERSION_LABEL = "Public Beta 1";

async function apiAuth(action, payload) {
  let res;
  try {
    res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  } catch (netErr) {
    throw new Error("Connection to auth server failed. Please check your network or try again.");
  }
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (!isJson) throw new Error("Couldn't reach the account service right now. It may not be deployed yet. Try again shortly, or contact support if this keeps happening.");
    // Surface the specific backend error (e.g. "Incorrect email or password",
    // "An account with that email already exists", "Too many attempts") so the
    // user sees exactly what went wrong rather than a generic catch-all.
    throw new Error(data.error || (res.status === 401 ? "Invalid credentials." : res.status === 429 ? "Too many requests. Wait a moment and try again." : "Something went wrong. Please try again."));
  }
  return data;
}
async function apiWhoAmI() {
  try {
    const res = await fetch("/api/auth");
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch { return null; }
}
// ── Pro tier ──
async function apiProGet() {
  try {
    const res = await fetch("/api/pro");
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function apiProPost(action, payload) {
  const res = await fetch("/api/pro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(payload || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "Something went wrong. Please try again.");
  return data;
}
async function apiDataGet(resource, params) {
  try {
    const qs = new URLSearchParams({ resource, ...(params || {}) });
    const res = await fetch(`/api/data?${qs.toString()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function apiDataPost(resource, payload) {
  const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...payload }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
// The Multiplayer Network actions (update-profile/toggle-follow/send-message)
// dispatch on a bare `action` field with no `resource` at all — see the
// comment above them in functions/api/data.js. Reuses apiDataPost's error
// handling rather than duplicating it; passing `undefined` as the resource
// just means JSON.stringify drops that key from the request body entirely.
async function apiDataAction(action, payload) {
  return apiDataPost(undefined, { action, ...payload });
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const kbdLabel = (key) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

function download(fn, text) { const blob = new Blob([text], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); URL.revokeObjectURL(a.href); }

function mixHex(h1, h2, t) {
  const c = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [a1, b1, d1] = c(h1), [a2, b2, d2] = c(h2);
  const m = (x, y) => Math.round(x + (y - x) * t);
  const to = (n) => n.toString(16).padStart(2, "0");
  return `#${to(m(a1, a2))}${to(m(b1, b2))}${to(m(d1, d2))}`;
}

function contrastRatio(a, b) {
  const x = relLuminance(a), y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function accentInk(P, accent) {
  if (P.dark || contrastRatio(accent, P.bg) >= 4.5) return accent;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixHex(accent, "#101216", mid), P.bg) >= 4.6) hi = mid;
    else lo = mid;
  }
  return mixHex(accent, "#101216", hi);
}

function statusBad(P, pn) {
  return P.dark ? (pn === "Mid" ? "#ff7a7a" : STATUS.bad) : "#b92c31";
}

function selectChrome(P) {
  const arrow = P.dark ? "9ca3af" : "6b7280";
  return {
    WebkitAppearance: "none",
    appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23${arrow}'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: 28,
  };
}

let __cbMotionCache = null; // { v: boolean, t: number } — see cbMotionOff
/* Moved to src/flowcharts.jsx: cbMotionOff */
function cbMotionCacheBust() { __cbMotionCache = null; }
function cbMotionCacheSet(v) { __cbMotionCache = v; }

function cbBlip(freq, dur = 0.07, gain = 0.05) {
  try {
    if (getCookie("cb_muted") === "1") return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.012);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    g.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.connect(g); osc.start(); osc.stop(ctx.currentTime + dur);
    setTimeout(() => { try { ctx.close(); } catch (cbErr) { console.error("[Cerebrum] appUtils.js cbBlip: ctx.close(); }:", cbErr); } }, (dur + 0.25) * 1000);
  } catch (cbErr) { console.error("[Cerebrum] appUtils.js cbBlip: outer try:", cbErr); }
}

const NOTIFY_KINDS = ["call", "message", "watch"];
function notifyPref() {
  const raw = getCookie("cb_notify");
  if (raw === null || raw === "") return { call: true, message: true, watch: true };
  if (raw === "off") return { call: false, message: false, watch: false };
  const on = new Set(raw.split(","));
  return { call: on.has("call"), message: on.has("message"), watch: on.has("watch") };
}
function setNotifyPref(next) {
  const on = NOTIFY_KINDS.filter((k) => next[k]);
  setCookie("cb_notify", on.length ? on.join(",") : "off");
}

function cbNotify(title, body, tag, kind) {
  try {
    if (!("Notification" in window)) return;
    // An unrecognized/absent kind is always allowed through — a future
    // caller that forgets to pass one should still reach the user rather
    // than being silently swallowed by a preference it was never in.
    if (kind && NOTIFY_KINDS.includes(kind) && !notifyPref()[kind]) return;
    // Only when the tab isn't the thing they're looking at — a notification
    // for a conversation already on screen is noise.
    if (document.visibilityState === "visible") return;
    const fire = () => {
      try {
        const n = new Notification(title, { body, tag, icon: "/favicon.ico", renotify: false });
        n.onclick = () => { try { window.focus(); n.close(); } catch (cbErr) { console.error("[Cerebrum] appUtils.js fire: window.focus(); n.close(); }:", cbErr); } };
      } catch (cbErr) { console.error("[Cerebrum] appUtils.js fire: window.focus(); n.close(); } catch {} };:", cbErr); }
    };
    if (Notification.permission === "granted") fire();
    else if (Notification.permission === "default") Notification.requestPermission().then((p) => { if (p === "granted") fire(); });
  } catch (cbErr) { console.error("[Cerebrum] appUtils.js fire: window.focus(); n.close(); } catch {} };:", cbErr); }
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 900 : false);
  useEffect(() => { const onR = () => setM(window.innerWidth < 900); window.addEventListener("resize", onR); return () => window.removeEventListener("resize", onR); }, []);
  return m;
}

const TONES = [
  { h: 152, s: 26 }, // moss
  { h: 186, s: 30 }, // teal
  { h: 210, s: 22 }, // slate
  { h: 232, s: 28 }, // indigo
  { h: 200, s: 18 }, // steel
  { h: 288, s: 20 }, // plum
  { h: 22,  s: 26 }, // clay
  { h: 40,  s: 24 }, // sand
  { h: 138, s: 22 }, // pine
  { h: 220, s: 32 }, // denim
  { h: 108, s: 24 }, // fern
  { h: 250, s: 14 }, // stone
];

function toneIndex(seed) {
  const str = String(seed == null || seed === "" ? "cerebrum" : seed);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % TONES.length;
}

function avatarSkin(seed) {
  const t = TONES[toneIndex(seed)];
  return {
    // Solid hue: no decorative gradients on avatars.
    background: `hsl(${t.h} ${t.s}% 32%)`,
    color: `hsl(${t.h} 34% 90%)`,
  };
}

const REPORT_REASONS = [
  { id: "harassment", label: "Harassment or abuse" },
  { id: "spam", label: "Spam or scam" },
  { id: "inappropriate", label: "Inappropriate content" },
  { id: "impersonation", label: "Impersonation" },
  { id: "other", label: "Other" },
];

let cbToastId = 0;
function toast(message, opts = {}) {
  try {
    window.dispatchEvent(new CustomEvent("cb-toast", {
      detail: { id: ++cbToastId, message, tone: opts.tone || "success" },
    }));
  } catch (cbErr) { console.error("[Cerebrum] appUtils.js toast: window.dispatchEvent(new CustomEvent('cb-toast', {:", cbErr); }
}
export { setCookie, getCookie, ensureDyslexicFont, relativeTime, APP_VERSION, APP_VERSION_LABEL, apiAuth, apiWhoAmI, apiProGet, apiProPost, apiDataGet, apiDataPost, apiDataAction, IS_MAC, MOD, kbdLabel, download, mixHex, contrastRatio, accentInk, statusBad, selectChrome, __cbMotionCache, cbMotionCacheBust, cbMotionCacheSet, cbBlip, NOTIFY_KINDS, notifyPref, setNotifyPref, cbNotify, useIsMobile, TONES, toneIndex, avatarSkin, REPORT_REASONS, cbToastId, toast };
