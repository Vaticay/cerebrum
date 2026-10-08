/**
 * settings.jsx — Settings page and sub-panels.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * SettingsView plus all settings-exclusive panels (Pro, API keys, vault,
 * privacy, encryption, TTS, system/config status).
 */

import { APP_VERSION_LABEL, accentInk, apiAuth, apiDataAction, apiDataGet, apiDataPost, apiProPost, cbNotify, download, kbdLabel, notifyPref, relativeTime, setNotifyPref, statusBad, toast, useIsMobile } from "./appUtils.js";
import { FONT_SIZES, Icon, ProBadge, RADIUS, SP, STATUS, TRACKING, TYPE, TierBadge, UIButton, UISelect, UIRow, Z, withAlpha } from "./designSystem.jsx";
import { isProPalette } from "./palettes.js";
import { Sfx } from "./sfx.js";
import { Dialog } from "./flowcharts.jsx";
import { clearE2EEMemory, confirmRecoveryPhrase, ensureE2EEDevice, getBackupInfo, getRecoveryPhrase, listBackups, listDevices, restoreFromPhrase, revokeDevice, uploadBackupNow } from "./e2ee/messaging.js";
import { ZkSession, isValidRecoveryPhrase, makeItemId } from "./zkData.js";
import { normalizePhrase } from "./e2ee/recovery.js";
import React, { useCallback, useEffect, useRef, useState } from "react";

function TtsVoiceSetting({ P, accent, at, S, sfx }) {
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem("cb_tts_voice") || "female"; } catch { return "female"; } });
  const set = (v) => { setVoice(v); try { localStorage.setItem("cb_tts_voice", v); } catch (cbErr) { console.error("[Cerebrum] settings.jsx set: localStorage.setItem('cb_tts_voice', v); }:", cbErr); } sfx(); };
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {[["female", "Female"], ["male", "Male"]].map(([v, label]) => (
        <UIButton P={P} variant="ghost" key={v} onClick={() => set(v)} style={{ minHeight: 44, flex: 1, padding: "9px 6px", fontSize: FONT_SIZES.small, fontWeight: 600, background: voice === v ? accent : "transparent", color: voice === v ? at : P.ink2, border: `1px solid ${voice === v ? accent : P.line}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>{label}</UIButton>
      ))}
    </div>
  );
}

function ProAccountSection({ P, accent, at, user, proStatus, onOpenPro, Section, Row }) {
  const [portalBusy, setPortalBusy] = useState(false);
  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    try {
      const r = await apiProPost("create-portal", {});
      window.location.href = r.url;
    } catch (e) {
      toast(e.message || "Couldn't open billing. Try again?", { tone: "error" });
      setPortalBusy(false);
    }
  };
  // Refill countdown off the same 5-day grid the backend enforces
  // (proStatus.quotaPeriod.resetsInMs). Ticks once a minute — a meter that
  // counts down in real time at 1s granularity is a battery drain for a
  // number nobody acts on within the minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const fetchedAtRef = useRef(Date.now());
  const prevStatusRef = useRef(proStatus);
  if (prevStatusRef.current !== proStatus) { prevStatusRef.current = proStatus; fetchedAtRef.current = Date.now(); }
  const periodMs = proStatus?.quotaPeriod?.resetsInMs;
  const refillMs = periodMs != null ? Math.max(0, fetchedAtRef.current + periodMs - now) : null;
  const fmtRefill = (ms) => {
    if (ms == null) return "refills every 5 days";
    const m = Math.floor(ms / 60000);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d > 0) return `refills in ${d}d ${h}h`;
    if (h > 0) return `refills in ${h}h ${mm}m`;
    if (mm > 0) return `refills in ${mm}m`;
    return "refilling now";
  };

  const tier = proStatus?.tier || "free";
  const isPro = tier === "pro" || !!user?.isPro;
  const isLite = tier === "lite" || !!proStatus?.isLite;
  const rank = isPro ? "pro" : isLite ? "lite" : "free";
  const q = proStatus?.quota;
  const dq = proStatus?.docReads;
  const fq = proStatus?.flowcharts;
  const canManage = proStatus?.hasBilling && proStatus?.proConfigured;

  // The flat gold CTA is the one place gold-as-a-button is allowed: it is
  // the product's own Pro brand, used once, for the single primary action.
  const goldBtn = (label, onClick, disabled) => (
    <UIButton P={P} variant="ghost" onClick={onClick} disabled={disabled} style={{
      padding: "9px 16px", minHeight: 40, fontSize: FONT_SIZES.small, fontWeight: 700,
      background: "#34d399", color: "#06281c", border: "none", borderRadius: 8,
      cursor: disabled ? "default" : "pointer", fontFamily: "var(--cb-font)",
      whiteSpace: "nowrap", flexShrink: 0, opacity: disabled ? 0.6 : 1,
    }}>{label}</UIButton>
  );
  const quietBtn = (label, onClick, disabled) => (
    <UIButton P={P} variant="ghost" onClick={onClick} disabled={disabled} style={{
      padding: "8px 16px", minHeight: 40, fontSize: FONT_SIZES.small, fontWeight: 600,
      background: "transparent", color: P.ink, border: `1px solid ${P.line2}`,
      borderRadius: 8, cursor: disabled ? "default" : "pointer", fontFamily: "var(--cb-font)",
      whiteSpace: "nowrap", flexShrink: 0,
    }}>{label}</UIButton>
  );

  const meterRow = (label, used, cap, last) => {
    const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    return (
      <Row
        key={label}
        label={label}
        desc={`${used} of ${cap} used · ${fmtRefill(refillMs)}`}
        control={
          <div style={{ width: 92, height: 5, borderRadius: 9999, background: P.raised, overflow: "hidden", flexShrink: 0 }} role="progressbar" aria-valuenow={used} aria-valuemax={cap} aria-label={`${label} usage`}>
            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 9999, background: pct >= 100 ? STATUS.bad : "#d4a437", transition: "width 300ms ease" }} />
          </div>
        }
        last={last}
      />
    );
  };

  const capacityLine = isPro
    ? (user?.proSource === "lifetime" ? "Lifetime member: unlimited AI answers, document reads and flowcharts. No billing, ever."
      : proStatus?.billing?.plan === "annual" ? "Annual billing · unlimited AI answers, document reads and flowcharts."
      : proStatus?.billing?.plan === "monthly" ? "Monthly billing · unlimited AI answers, document reads and flowcharts."
      : "Unlimited AI answers, document reads and flowcharts.")
    : isLite
    ? (proStatus?.billing?.plan === "annual" ? "Annual billing · " : proStatus?.billing?.plan === "monthly" ? "Monthly billing · " : "")
      + "500 AI answers, 30 document reads and 10 flowcharts every 5 days: 10 times the free plan."
    : "50 AI answers, 3 document reads and 1 flowchart every 5 days.";
  const tierName = isPro ? "Pro" : isLite ? "Pro Lite" : "Free";

  return (
    <Section title="Membership">
      {!user ? (
        <Row label="Go further with Pro" desc="Unlimited AI answers, document reads and flowcharts, the PRO badge and an exclusive theme."
          control={goldBtn("See plans", onOpenPro)} last />
      ) : (
        <>
          <Row
            label={<span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}><TierBadge tier={rank} />{tierName}</span>}
            searchKey="Membership"
            desc={capacityLine}
            control={canManage ? quietBtn(portalBusy ? "Opening…" : "Manage subscription", openPortal, portalBusy) : null}
          />
          {!isPro && meterRow("AI answers", q?.used || 0, q?.cap || (isLite ? 500 : 50), false)}
          {!isPro && meterRow("Document reads", dq?.used || 0, dq?.cap || (isLite ? 30 : 3), false)}
          {!isPro && meterRow("Flowcharts", fq?.used || 0, fq?.cap || (isLite ? 10 : 1), rank === "free")}
          {rank === "free" && (
            <Row
              label="Pro Lite"
              desc="500 AI answers every 5 days: 10 times your current limit, plus 30 document reads and 10 flowcharts. $3.99/month or $39/year."
              control={goldBtn("See plans", onOpenPro)}
            />
          )}
          {rank !== "pro" && (
            <Row
              label="Pro"
              desc="The meter goes away: unlimited AI answers, document reads and flowcharts, deeper Pro search, investigation templates, API access, plus the badge, four exclusive themes and the members' reels. $20/month or $144/year."
              control={rank === "free" ? goldBtn("Go Pro", onOpenPro) : quietBtn("Go Pro", onOpenPro)}
              last
            />
          )}
        </>
      )}
    </Section>
  );
}

function ApiKeyPanel({ P, accent, at, Section, Row }) {
  const [keys, setKeys] = useState(null);
  const [usage, setUsage] = useState(null); // per-key usage dashboard
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const r = await apiProPost("api-key-list", {});
      setKeys(r.keys || []);
      // Usage is best-effort: the key list is the source of truth and a
      // usage-table hiccup must not hide it.
      try {
        const u = await apiProPost("api-key-usage", {});
        const byId = {};
        for (const x of (u.usage || [])) byId[x.id] = x;
        setUsage(byId);
      } catch { setUsage({}); }
    } catch (e) {
      setKeys([]);
      setMsg({ tone: "bad", text: e.message || "Couldn't load API keys." });
    }
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (busy) return;
    setBusy(true); setMsg(null); setCopied(false);
    try {
      const r = await apiProPost("api-key-create", { name: name.trim() });
      setNewKey(r.key);
      setName("");
      await refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e.message || "Couldn't create the key." });
    }
    setBusy(false);
  };

  const revoke = async (id) => {
    if (busy) return;
    if (!window.confirm("Revoke this API key? Anything using it stops working immediately.")) return;
    setBusy(true); setMsg(null);
    try {
      await apiProPost("api-key-revoke", { id });
      await refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e.message || "Couldn't revoke the key." });
    }
    setBusy(false);
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(newKey.key);
      setCopied(true);
    } catch {
      setMsg({ tone: "bad", text: "Copy failed — select the key text manually." });
    }
  };

  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <Section title="API access" footer="Pro members can call /api/search with an API key instead of a browser session. Keys inherit your Pro quota (unlimited) and stop working if Pro lapses. Never share a key — it acts as you.">
      {newKey && (
        <div style={{ margin: "0 0 12px", padding: 14, borderRadius: 12, border: `1px solid ${STATUS.good}`, background: withAlpha(STATUS.good, 0.07) }}>
          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-font)", marginBottom: 6 }}>
            Your new key — copy it now, it won't be shown again
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, fontSize: FONT_SIZES.small, color: P.ink, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 8, padding: "8px 12px", overflowX: "auto", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>
              {newKey.key}
            </code>
            <UIButton P={P} accent={accent} at={at} variant="ghost" onClick={copyKey} style={{ minHeight: 40, flexShrink: 0 }}>
              {copied ? "Copied" : "Copy"}
            </UIButton>
          </div>
          <div style={{ marginTop: 8 }}>
            <UIButton P={P} variant="ghost" onClick={() => setNewKey(null)} style={{ minHeight: 36, fontSize: FONT_SIZES.small }}>
              Done
            </UIButton>
          </div>
        </div>
      )}
      <Row
        label="New API key"
        desc="Up to 5 active keys. 60 requests per minute per key."
        control={
          <div style={{ display: "flex", gap: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              placeholder="Key name, e.g. my script" autoComplete="off"
              style={{ padding: "8px 12px", fontSize: FONT_SIZES.small, background: P.surface, color: P.ink, border: `1px solid ${P.line2}`, borderRadius: 8, fontFamily: "var(--cb-font)", width: 170 }} />
            <UIButton P={P} accent={accent} at={at} variant="ghost" onClick={create} disabled={busy || (keys && keys.length >= 5)} style={{ minHeight: 40, flexShrink: 0 }}>
              {busy ? "…" : "Create key"}
            </UIButton>
          </div>
        }
        last={!(keys && keys.length)} />
      {msg && (
        <div style={{ padding: "0 12px 12px", fontSize: FONT_SIZES.small, color: msg.tone === "good" ? "#3fb96c" : "#e5484d", fontFamily: "var(--cb-font)" }}>{msg.text}</div>
      )}
      {keys == null ? (
        <Row label="Loading…" desc="" control={null} last />
      ) : keys.length === 0 ? (
        <Row label="No API keys yet" desc="Create one above to call the search API from your own scripts." control={null} last />
      ) : keys.map((k, i) => {
        const u = usage && usage[k.id];
        // Usage line: today + 7d + lifetime, error rate when nonzero.
        // Compact one-liner under the key name — the panel is a list, not
        // a dashboard page.
        let usageLine = `${k.name} · created ${fmtDate(k.createdAt)} · last used ${fmtDate(k.lastUsedAt)}`;
        if (u) {
          const errBit = u.totalErrors > 0 ? ` · ${u.totalErrors} error${u.totalErrors === 1 ? "" : "s"}` : "";
          usageLine = `${k.name} · ${u.callsToday} today · ${u.calls7d} last 7d · ${u.totalCalls} total${errBit}`;
        }
        return (
        <Row key={k.id}
          label={<span style={{ fontFamily: "ui-monospace, monospace", fontSize: FONT_SIZES.small }}>{k.keyPrefix}…</span>}
          desc={usageLine}
          control={
            <UIButton P={P} variant="ghost" onClick={() => revoke(k.id)} disabled={busy}
              style={{ minHeight: 40, padding: "6px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: "#e5484d", border: "1px solid rgba(229,72,77,0.4)", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
              Revoke
            </UIButton>
          }
          last={i === keys.length - 1} />
        );
      })}
    </Section>
  );
}

function ProGrantPanel({ P, accent, at, Section, Row, onProChanged }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }
  const [list, setList] = useState(null);
  const refreshList = async () => {
    try {
      const r = await apiProPost("list-lifetime", {});
      setList(r.lifetime || []);
    } catch { setList([]); }
  };
  useEffect(() => { refreshList(); }, []);
  const run = async (action, targetEmail) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiProPost(action, { email: targetEmail });
      // Backend returns { ok, email, already, lifetime } — read r.email, not r.user.email.
      setMsg({ tone: "good", text: action === "grant" ? `Permanent Pro granted to ${r.email}.` : `Pro revoked for ${r.email}.` });
      setEmail("");
      await refreshList();
      if (onProChanged) await onProChanged();
    } catch (e) {
      setMsg({ tone: "bad", text: e.message || "That didn't work. Try again?" });
    }
    setBusy(false);
  };
  return (
    <Section title="Grant Pro access" footer="Founder only. A grant is permanent: it survives cancellations, failed payments, and every Stripe webhook. Nothing on this page is visible to anyone but you.">
      <Row
        label="Grant permanent Pro"
        desc="Enter the account's email address. They get everything Pro has, forever, with no billing."
        control={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run("grant", email); }}
              placeholder="name@example.com" type="email" autoComplete="off"
              style={{ padding: "8px 12px", fontSize: FONT_SIZES.small, background: P.surface, color: P.ink, border: `1px solid ${P.line2}`, borderRadius: 8, fontFamily: "var(--cb-font)", flex: "1 1 160px", minWidth: 0, maxWidth: 260 }} />
            <UIButton P={P} variant="ghost" onClick={() => run("grant", email)} disabled={busy || !email.trim()} style={{ padding: "8px 16px", minHeight: 40, fontSize: FONT_SIZES.small, fontWeight: 700, background: busy ? P.raised : "#34d399", color: busy ? P.faint : "#1a1405", border: "none", borderRadius: 8, cursor: busy || !email.trim() ? "default" : "pointer", fontFamily: "var(--cb-font)", flexShrink: 0 }}>
              {busy ? "…" : "Grant"}
            </UIButton>
          </div>
        } />
      {msg && (
        <div style={{ padding: "0 12px 12px", fontSize: FONT_SIZES.small, color: msg.tone === "good" ? "#3fb96c" : "#e5484d", fontFamily: "var(--cb-font)" }}>{msg.text}</div>
      )}
      <Row
        label="Lifetime Pro members"
        desc={list == null ? "Loading…" : list.length === 0 ? "Nobody yet." : `${list.length} member${list.length === 1 ? "" : "s"}`}
        control={null}
        last={!(list && list.length)} />
      {list && list.map((m) => (
        <Row key={m.email} label={m.email} desc={m.granted_at ? `Granted ${new Date(m.granted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Lifetime member"}
          control={<UIButton P={P} variant="ghost" onClick={() => run("revoke", m.email)} disabled={busy} style={{ minHeight: 44, padding: "6px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: "#e5484d", border: "1px solid rgba(229,72,77,0.4)", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Revoke</UIButton>}
          last={m === list[list.length - 1]} />
      ))}
    </Section>
  );
}

function RestorePhrasePanel({ P, accent, backups, restoreDeviceId, setRestoreDeviceId, restorePhrase, setRestorePhrase, doRestore, busy, pillBtn, sfx }) {
  return (
    <div style={{ padding: "16px 16px", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderTop: `1px solid ${P.line}` }}>
      {backups.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.ink2, marginBottom: 6, fontFamily: "var(--cb-font)" }}>Which device's backup is this for?</div>
          <UISelect P={P} accent={accent} value={restoreDeviceId} onChange={(v) => { sfx(); setRestoreDeviceId(v); }}
            options={backups.map((b) => ({ value: b.deviceId, label: `${b.label} — backed up ${relativeTime(b.updatedAt)}` }))}
            ariaLabel="Which device's backup is this for" style={{ width: "100%", fontSize: 16 }} />
        </div>
      )}
      <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.ink2, marginBottom: 6, fontFamily: "var(--cb-font)" }}>Your 24-word recovery phrase</div>
      <textarea
        aria-label="Your 24-word recovery phrase"
        value={restorePhrase}
        onChange={(e) => setRestorePhrase(e.target.value)}
        rows={3} autoComplete="off" autoCapitalize="off" spellCheck={false}
        placeholder="Enter the 24 words in order, separated by spaces"
        style={{ width: "100%", padding: "12px 12px", fontSize: 16, fontFamily: "var(--cb-font)", color: P.ink, background: P.dark ? "rgba(255,255,255,0.06)" : "#fff", border: `1px solid ${P.line}`, borderRadius: 8, outline: "none", resize: "vertical", marginBottom: 10 }}
      />
      <button onClick={doRestore} disabled={!restorePhrase.trim() || busy === "restore"} style={{ ...pillBtn, opacity: !restorePhrase.trim() ? 0.45 : 1 }}>
        {busy === "restore" ? "Restoring…" : "Restore encrypted messaging"}
      </button>
    </div>
  );
}

function EncryptionSettings({ P, accent, at, sfx, Section, Row }) {
  const [loading, setLoading] = useState(true);
  const [setUp, setSetUp] = useState(false);
  const [deviceId, setDeviceId] = useState(null);
  const [phrase, setPhrase] = useState(null);           // 24-word string while visible
  const [phraseMode, setPhraseMode] = useState(null);   // "setup" | "revealed" | null
  const [challenges, setChallenges] = useState([]);      // [{ index, typed }]
  const [challengeOn, setChallengeOn] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null);
  const [devices, setDevices] = useState([]);
  const [backups, setBackups] = useState([]);
  const [showRestore, setShowRestore] = useState(false);
  const [restorePhrase, setRestorePhrase] = useState("");
  const [restoreDeviceId, setRestoreDeviceId] = useState("");
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [busy, setBusy] = useState("");

  const pillBtn = {
    minHeight: 44, padding: "7px 16px", fontSize: FONT_SIZES.small, fontWeight: 600,
    background: withAlpha(accent, 0.16), color: accent,
    border: `1px solid ${withAlpha(accent, 0.35)}`, borderRadius: 9999,
    cursor: "pointer", fontFamily: "var(--cb-font)", whiteSpace: "nowrap",
  };
  const dangerBtn = {
    ...pillBtn, background: withAlpha(STATUS.bad, 0.1), color: statusBad(P),
    border: `1px solid ${withAlpha(STATUS.bad, 0.35)}`,
  };
  const statusPill = (text, color) => (
    <span style={{
      fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label,
      padding: "4px 12px", borderRadius: 9999, color, background: withAlpha(color, 0.12),
      whiteSpace: "nowrap",
    }}>{text}</span>
  );

  const refresh = async () => {
    setLoading(true);
    try {
      // getRecoveryPhrase is a safe probe: it never creates a device, so
      // merely opening Settings can't silently enroll the user.
      const existing = await getRecoveryPhrase().catch(() => null);
      if (!mountedRef.current) return;
      if (!existing) { setSetUp(false); setDeviceId(null); return; }
      setSetUp(true);
      const [dev, info] = await Promise.all([
        listDevices(apiDataAction).catch(() => null),
        getBackupInfo().catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setDeviceId(dev ? dev.currentDeviceId : null);
      setDevices(dev ? dev.devices : []);
      setBackupInfo(info);
      setConfirmed(!!(info && info.phraseConfirmed));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickChallenges = () => {
    const idx = new Set();
    while (idx.size < 3) idx.add(Math.floor(Math.random() * 24));
    return [...idx].sort((a, b) => a - b).map((i) => ({ index: i, typed: "" }));
  };

  const doSetup = async () => {
    if (busy) return;
    setBusy("setup");
    try {
      sfx();
      const res = await ensureE2EEDevice(apiDataAction);
      setDeviceId(res.deviceId);
      setSetUp(true);
      setPhrase(res.recoveryPhrase || await getRecoveryPhrase().catch(() => null));
      setPhraseMode("setup");
      setChallenges(pickChallenges());
      setChallengeOn(false);
      const info = await getBackupInfo().catch(() => null);
      setBackupInfo(info);
      setConfirmed(!!(info && info.phraseConfirmed));
      const dev = await listDevices(apiDataAction).catch(() => null);
      setDevices(dev ? dev.devices : []);
    } catch (e) {
      toast(e.message || "Couldn't set up encrypted messaging.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const words = (phrase || "").trim().split(/\s+/).filter(Boolean);
  const challengesOk = challenges.length === 3 && words.length === 24 &&
    challenges.every((c) => c.typed.trim().toLowerCase() === (words[c.index] || "").toLowerCase());

  const doConfirmPhrase = async () => {
    if (!challengesOk || busy) return;
    setBusy("confirm");
    try {
      sfx();
      await confirmRecoveryPhrase();
      setConfirmed(true);
      setChallengeOn(false);
      setPhraseMode(null);
      setPhrase(null);
      toast("Recovery phrase confirmed. Back it up so you never lose access to encrypted conversations.");
      const info = await getBackupInfo().catch(() => null);
      setBackupInfo(info);
    } catch (e) {
      toast(e.message || "Couldn't confirm the phrase.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const doReveal = async () => {
    if (busy) return;
    setBusy("reveal");
    try {
      sfx();
      const p = await getRecoveryPhrase();
      if (!p) throw new Error("No recovery phrase on this device.");
      setPhrase(p);
      setPhraseMode("revealed");
    } catch (e) {
      toast(e.message || "Couldn't show the recovery phrase.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const doBackupNow = async () => {
    if (busy) return;
    setBusy("backup");
    try {
      sfx();
      await uploadBackupNow(apiDataAction);
      const info = await getBackupInfo().catch(() => null);
      setBackupInfo(info);
      toast("Encrypted backup saved.");
    } catch (e) {
      toast(e.message || "Couldn't save the backup.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const doRevoke = async (id) => {
    if (busy) return;
    setBusy("revoke:" + id);
    try {
      sfx();
      const res = await revokeDevice(apiDataAction, id);
      setRevokeTarget(null);
      if (res.wasCurrent) {
        // This device is out. Local keys are wiped; the user starts over
        // explicitly rather than failing closed forever on a dead id.
        clearE2EEMemory();
        setSetUp(false);
        setDeviceId(null);
        setDevices([]);
        setPhrase(null);
        setPhraseMode(null);
        toast("This device was removed from encrypted messaging. Set it up again to rejoin.");
      } else {
        toast("Device removed.");
        const dev = await listDevices(apiDataAction).catch(() => null);
        setDevices(dev ? dev.devices : []);
      }
    } catch (e) {
      toast(e.message || "Couldn't remove that device.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  // Ref mirror of showRestore: the toggle below must branch on the LATEST
  // intent, not the render closure — a fast double-click otherwise closes
  // the panel while the stale `showRestore` still reads false and fires
  // listBackups anyway.
  const showRestoreRef = useRef(false);
  const openRestore = async () => {
    sfx();
    const next = !showRestoreRef.current;
    showRestoreRef.current = next;
    setShowRestore(next);
    if (next) {
      try {
        const b = await listBackups(apiDataAction).catch(() => []);
        setBackups(b || []);
        if (b && b.length > 0 && !restoreDeviceId) setRestoreDeviceId(b[0].deviceId);
      } catch (cbErr) { console.error("[Cerebrum] settings.jsx if: const b = await listBackups(apiDataAction).catch(() => []);:", cbErr); }
    }
  };

  const doRestore = async () => {
    const p = restorePhrase.trim();
    if (!p || busy) return;
    setBusy("restore");
    try {
      sfx();
      await restoreFromPhrase(apiDataAction, p, restoreDeviceId || null);
      showRestoreRef.current = false;
      setShowRestore(false);
      setRestorePhrase("");
      setPhrase(null);
      setPhraseMode(null);
      toast("Encrypted messaging restored on this device.");
      await refresh();
    } catch (e) {
      toast(e.message || "Couldn't restore from that phrase.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const backupDesc = !backupInfo ? "No backup yet."
    : backupInfo.at ? `Last backed up ${relativeTime(backupInfo.at)}.${backupInfo.pending ? " Changes since then aren't backed up yet." : ""}`
    : "No backup yet.";

  const phraseGrid = phrase && words.length === 24 && (
    <div style={{ padding: "16px 16px", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderTop: `1px solid ${P.line}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        {words.map((w, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "baseline", gap: 8, padding: "8px 12px",
            background: P.dark ? "rgba(255,255,255,0.05)" : "#fff",
            border: `1px solid ${P.line}`, borderRadius: 8,
            fontSize: FONT_SIZES.small, fontFamily: "var(--cb-font)",
          }}>
            <span style={{ color: P.faint, fontSize: FONT_SIZES.micro, minWidth: 18 }}>{i + 1}</span>
            <span style={{ color: P.ink, fontWeight: 600, userSelect: "all" }}>{w}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: FONT_SIZES.caption, color: P.ink2, lineHeight: 1.5, marginBottom: phraseMode === "setup" && !challengeOn ? 12 : 0 }}>
        <Icon name="warning" size={15} style={{ color: STATUS.bad, flexShrink: 0, marginTop: 1 }} />
        <span>Write these down on paper and keep them somewhere safe. Anyone with these words can read your encrypted messages. Cerebrum can't recover them for you.</span>
      </div>
      {phraseMode === "setup" && !challengeOn && (
        <UIButton P={P} variant="ghost" onClick={() => { sfx(); setChallengeOn(true); }} style={pillBtn}>I've written them down</UIButton>
      )}
      {phraseMode === "setup" && challengeOn && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, marginBottom: 8, fontFamily: "var(--cb-font)" }}>
            Prove you wrote them down — type the requested words:
          </div>
          {challenges.map((c) => (
            <div key={c.index} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <label htmlFor={"cb-challenge-" + c.index} style={{ fontSize: FONT_SIZES.small, color: P.ink2, minWidth: 74, fontFamily: "var(--cb-font)" }}>Word {c.index + 1}</label>
              <input
                id={"cb-challenge-" + c.index}
                value={c.typed}
                onChange={(e) => setChallenges((prev) => prev.map((x) => x.index === c.index ? { ...x, typed: e.target.value } : x))}
                autoComplete="off" autoCapitalize="off" spellCheck={false}
                style={{
                  flex: 1, padding: "9px 12px", fontSize: 16, fontFamily: "var(--cb-font)",
                  color: P.ink, background: P.dark ? "rgba(255,255,255,0.06)" : "#fff",
                  border: `1px solid ${P.line}`, borderRadius: 8, outline: "none",
                }}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={doConfirmPhrase} disabled={!challengesOk || busy === "confirm"} style={{ ...pillBtn, opacity: !challengesOk ? 0.45 : 1, cursor: !challengesOk ? "default" : "pointer" }}>
              {busy === "confirm" ? "Confirming…" : "Confirm"}
            </button>
            <UIButton P={P} variant="ghost" onClick={() => { sfx(); setChallenges(pickChallenges()); }} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>
              Pick different words
            </UIButton>
          </div>
        </div>
      )}
      {phraseMode === "revealed" && (
        <div style={{ marginTop: 4 }}>
          <UIButton P={P} variant="ghost" onClick={() => { sfx(); setPhrase(null); setPhraseMode(null); }} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>Hide</UIButton>
        </div>
      )}
    </div>
  );

  return (<>
    <Section
      title="Encrypted messaging"
      footer="Encrypted conversations can only be read on your devices — not by Cerebrum, not by anyone in between. Your recovery phrase is the only way back in if you lose a device, so write it down."
    >
      {loading ? (
        <Row label="Checking this device…" last />
      ) : !setUp ? (<>
        <Row
          label="Encrypted messaging"
          desc="Set it up on this device to start private conversations. You'll get a recovery phrase — the only way to get back in if you lose this device."
          control={<button onClick={doSetup} disabled={busy === "setup"} style={pillBtn}>{busy === "setup" ? "Setting up…" : "Set up"}</button>}
        />
        <Row
          label="Restore from recovery phrase"
          desc="Already set up encrypted messaging on another device? Bring this device in with your 24-word phrase."
          control={<UIButton P={P} variant="ghost" onClick={openRestore} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>{showRestore ? "Close" : "Restore"}</UIButton>}
          last={!showRestore}
        />
        {showRestore && (
          <RestorePhrasePanel P={P} accent={accent} backups={backups} restoreDeviceId={restoreDeviceId} setRestoreDeviceId={setRestoreDeviceId} restorePhrase={restorePhrase} setRestorePhrase={setRestorePhrase} doRestore={doRestore} busy={busy} pillBtn={pillBtn} sfx={sfx} />
        )}
      </>) : (<>
        <Row
          label="Encrypted messaging"
          desc="This device can send and read encrypted messages."
          control={statusPill("On", STATUS.good)}
        />
        {!confirmed && (
          <Row
            label="Recovery phrase"
            desc="You haven't confirmed your recovery phrase yet. Without it, losing this device means losing your encrypted conversations."
            control={phraseMode === "setup"
              ? <UIButton P={P} variant="ghost" onClick={() => { sfx(); setPhrase(null); setPhraseMode(null); }} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>Hide</UIButton>
              : <button onClick={doSetup} disabled={busy === "setup"} style={pillBtn}>{busy === "setup" ? "Loading…" : "Show phrase"}</button>}
          />
        )}
        {confirmed && (
          <Row
            label="Recovery phrase"
            desc="Written down and confirmed. You can look at it again any time."
            control={phraseMode === "revealed"
              ? <UIButton P={P} variant="ghost" onClick={() => { sfx(); setPhrase(null); setPhraseMode(null); }} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>Hide</UIButton>
              : <UIButton P={P} variant="ghost" onClick={doReveal} disabled={busy === "reveal"} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>{busy === "reveal" ? "Loading…" : "Show"}</UIButton>}
          />
        )}
        {phraseGrid}
        <Row
          label="Back up now"
          desc={backupDesc}
          control={<button onClick={doBackupNow} disabled={busy === "backup"} style={pillBtn}>{busy === "backup" ? "Saving…" : "Back up"}</button>}
        />
        <Row
          label="Restore from recovery phrase"
          desc="Move encrypted messaging to a fresh device, or recover after losing one."
          control={<UIButton P={P} variant="ghost" onClick={openRestore} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>{showRestore ? "Close" : "Restore"}</UIButton>}
          last={!showRestore}
        />
        {showRestore && (
          <RestorePhrasePanel P={P} accent={accent} backups={backups} restoreDeviceId={restoreDeviceId} setRestoreDeviceId={setRestoreDeviceId} restorePhrase={restorePhrase} setRestorePhrase={setRestorePhrase} doRestore={doRestore} busy={busy} pillBtn={pillBtn} sfx={sfx} />
        )}
      </>)}
    </Section>

    {setUp && !loading && (
      <Section
        title="Devices"
        footer="Every device you use gets its own keys. Removing a device stops it from reading new messages right away — it can't sneak back in later."
      >
        {devices.length === 0 && <Row label="No other devices yet" desc="Set up encrypted messaging on another device and it will appear here." last />}
        {devices.map((d, i) => (
          <Row
            key={d.deviceId}
            label={<span>{d.label || "Device"}{d.current && <span style={{ marginLeft: 8 }}>{statusPill("This device", accent)}</span>}{d.revokedAt && <span style={{ marginLeft: 8 }}>{statusPill("Removed", STATUS.bad)}</span>}</span>}
            desc={d.revokedAt ? `Removed ${relativeTime(d.revokedAt)}` : d.lastSeenAt ? `Last active ${relativeTime(d.lastSeenAt)}` : "No recent activity"}
            control={d.revokedAt ? null : revokeTarget === d.deviceId ? (
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: FONT_SIZES.caption, color: P.ink2, fontFamily: "var(--cb-font)" }}>Remove{d.current ? " this device" : ""}?</span>
                <button onClick={() => doRevoke(d.deviceId)} disabled={busy === "revoke:" + d.deviceId} style={dangerBtn}>{busy === "revoke:" + d.deviceId ? "Removing…" : "Yes, remove"}</button>
                <UIButton P={P} variant="ghost" onClick={() => { sfx(); setRevokeTarget(null); }} style={{ ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 }}>Keep</UIButton>
              </span>
            ) : (
              <button onClick={() => { sfx(); setRevokeTarget(d.deviceId); }} style={{ ...dangerBtn, background: "transparent" }}>Remove</button>
            )}
            last={i === devices.length - 1}
          />
        ))}
      </Section>
    )}
  </>);
}

function PrivateVaultSettings({ P, accent, sfx, Section, Row, user, saved, setSaved, history, setHistory, collections, setCollections, vaultCtl }) {
  const [busy, setBusy] = useState("");
  const [enableStep, setEnableStep] = useState(null);   // null | "warnings" | "phrase" | "migrating"
  const [needE2ee, setNeedE2ee] = useState(false);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [purgeNeeded, setPurgeNeeded] = useState(false);
  const [unlockPhrase, setUnlockPhrase] = useState("");
  const [showUnlock, setShowUnlock] = useState(false);
  const [disableStep, setDisableStep] = useState(false);
  const [disableConsent, setDisableConsent] = useState(false);

  const mode = vaultCtl.mode;

  const pillBtn = {
    minHeight: 44, padding: "7px 16px", fontSize: FONT_SIZES.small, fontWeight: 600,
    background: withAlpha(accent, 0.16), color: accent,
    border: `1px solid ${withAlpha(accent, 0.35)}`, borderRadius: 9999,
    cursor: "pointer", fontFamily: "var(--cb-font)", whiteSpace: "nowrap",
  };
  const dangerBtn = {
    ...pillBtn, background: withAlpha(STATUS.bad, 0.1), color: statusBad(P),
    border: `1px solid ${withAlpha(STATUS.bad, 0.35)}`,
  };
  const ghostBtn = { ...pillBtn, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2 };
  const statusPill = (text, color) => (
    <span style={{
      fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label,
      padding: "4px 12px", borderRadius: 9999, color, background: withAlpha(color, 0.12),
      whiteSpace: "nowrap",
    }}>{text}</span>
  );
  const noteBox = {
    padding: "16px 16px", background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    borderTop: `1px solid ${P.line}`,
  };
  const warnLine = {
    display: "flex", alignItems: "flex-start", gap: 8, fontSize: FONT_SIZES.small,
    color: P.ink2, lineHeight: 1.5, marginBottom: 10, fontFamily: "var(--cb-font)",
  };
  const fieldLabel = {
    fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.ink2, marginBottom: 6, fontFamily: "var(--cb-font)",
  };
  const textArea = {
    width: "100%", padding: "12px 12px", fontSize: 16, fontFamily: "var(--cb-font)",
    color: P.ink, background: P.dark ? "rgba(255,255,255,0.06)" : "#fff",
    border: `1px solid ${P.line}`, borderRadius: 8, outline: "none", resize: "vertical", marginBottom: 10,
  };

  // Enable is fail-closed on the recovery phrase: the vault is keyed by
  // the same phrase as encrypted conversations, so without it on this
  // device there is nothing to enable with.
  const startEnable = async () => {
    if (busy) return;
    sfx();
    if (!user || !user.id) { toast("Sign in first to use Private Vault."); return; }
    const devicePhrase = await getRecoveryPhrase().catch(() => null);
    if (!devicePhrase) { setNeedE2ee(true); return; }
    setNeedE2ee(false);
    setEnableStep("warnings");
  };

  const doEnable = async () => {
    if (busy) return;
    const devicePhrase = await getRecoveryPhrase().catch(() => null);
    if (!devicePhrase) { setNeedE2ee(true); setEnableStep(null); return; }
    const typed = typedPhrase.trim();
    // isValidRecoveryPhrase is async in the production bundle (the vite
    // alias routes e2ee/recovery.js through the lazy facade): a bare call
    // returns a Promise, which is always truthy, silently bypassing this
    // validation. Await it.
    if (!(await isValidRecoveryPhrase(typed))) { toast("That doesn't look like a valid 24-word recovery phrase.", { tone: "error" }); return; }
    // The typed phrase must be THIS device's phrase: enabling under any
    // other phrase would lock the vault to a key this device doesn't hold.
    if (normalizePhrase(typed) !== normalizePhrase(devicePhrase)) { toast("That doesn't match the recovery phrase on this device.", { tone: "error" }); return; }
    setBusy("enable");
    setEnableStep("migrating");
    vaultCtl.holdLegacy(true);
    // Set the moment the vault row exists on the server. From then on a
    // failure must land in "locked" (fail-closed) — never "off", which
    // would let the plaintext sync path resume under an existing vault.
    let vaultLive = false;
    try {
      sfx();
      const phrase = normalizePhrase(typed);
      const session = new ZkSession({ userId: user.id, post: vaultCtl.post, getPhrase: getRecoveryPhrase });
      const vs = await session.getVaultState().catch(() => null);
      const exists = !!(vs && (vs.exists || vs.dekId || vs.dek_id || vs.wrappedDek || vs.wrapped_dek));
      if (exists) await session.unlock(phrase);
      else await session.enable(phrase);
      vaultLive = true;
      // Everything currently in the library, encrypted. Migrated items
      // carry the permanent honest label.
      const savedRows = [], historyRows = [], colRows = [];
      for (const s of saved || []) {
        const id = s.zkId || makeItemId("paper");
        savedRows.push({ id, kind: "paper", collectionId: s.collectionId || null, payload: { ...vaultCtl.paperPayload(s), zkMigrated: true }, rev: vaultCtl.nextRev(id) });
      }
      for (const h of history || []) {
        const id = h.zkId || h.id || makeItemId("inv");
        historyRows.push({ id, kind: "investigation", collectionId: null, payload: { ...vaultCtl.invPayload(h), zkMigrated: true }, rev: vaultCtl.nextRev(id) });
      }
      for (const c of collections || []) {
        colRows.push({ id: c.id, kind: "collection-meta", collectionId: null, payload: { ...vaultCtl.colPayload(c), zkMigrated: true }, rev: vaultCtl.nextRev(c.id) });
      }
      // Id write-back BEFORE the upload: ids are stable, so a retry of a
      // half-finished migration can never duplicate rows.
      vaultCtl.setSession(session);
      vaultCtl.setMode("unlocked");
      vaultCtl.setMigPending(false);
      vaultCtl.seedPushed(savedRows.map((r) => r.id), historyRows.map((r) => r.id));
      vaultCtl.writeBackSaved(savedRows);
      vaultCtl.writeBackHistory(historyRows);
      vaultCtl.writeBackCollections(colRows);
      const allRows = [...savedRows, ...historyRows, ...colRows];
      if (allRows.length) await vaultCtl.pushBatched(session, allRows);
      // The vault is live from here: the verified purge of old plaintext.
      let deleted = null;
      let purgeFailed = false;
      try {
        const res = await session.purgeLegacy();
        deleted = (res && (res.deleted || res.counts)) || null;
      } catch (e) {
        // Ciphertext is up and the vault is on; only the cleanup failed.
        // Say so loudly and offer the retry — never pretend it's gone.
        purgeFailed = true;
        setPurgeNeeded(true);
        toast("Private Vault is on, but the old readable copies couldn't be removed. Use \"Remove old readable copies\" below to try again.", { tone: "error" });
      }
      setTypedPhrase("");
      setEnableStep(null);
      if (deleted) {
        setPurgeNeeded(false);
        toast(`Private Vault is on. Removed the old readable copies: ${deleted.saved || 0} saved, ${deleted.history || 0} investigations, ${deleted.collections || 0} collections.`);
      } else if (!purgeFailed) {
        setPurgeNeeded(false);
        toast("Private Vault is on.");
      }
    } catch (e) {
      // Anything before the vault row existed: abort cleanly, nothing was
      // made private, so nothing is claimed. Once the vault row exists,
      // fail closed into "locked" with the migration marked unfinished —
      // Settings offers "Finish turning on Private Vault" to retry.
      vaultCtl.setSession(null);
      vaultCtl.setMode(vaultLive ? "locked" : "off");
      vaultCtl.setMigPending(vaultLive);
      toast(vaultCtl.errorMessage(e, "Couldn't turn on Private Vault."), { tone: "error" });
      setEnableStep(vaultLive ? null : "phrase");
    } finally {
      vaultCtl.holdLegacy(false);
      setBusy("");
    }
  };

  // Retry for a half-finished enable: the vault row exists on the server
  // but the encrypted upload didn't complete. Ids were written back
  // before the first upload attempt, so re-running reuses the same ids
  // and can never duplicate rows.
  const doFinishMigration = async () => {
    if (busy) return;
    if (!user || !user.id) { toast("Sign in first."); return; }
    const devicePhrase = await getRecoveryPhrase().catch(() => null);
    // Awaited: isValidRecoveryPhrase is async in the production bundle
    // (lazy facade via the vite alias); a bare call is always truthy.
    if (!devicePhrase || !(await isValidRecoveryPhrase(devicePhrase))) {
      toast("Couldn't find your recovery phrase on this device. Set up encrypted conversations first.", { tone: "error" });
      return;
    }
    setBusy("finish");
    vaultCtl.holdLegacy(true);
    try {
      const session = new ZkSession({ userId: user.id, post: vaultCtl.post, getPhrase: getRecoveryPhrase });
      await session.unlock(normalizePhrase(devicePhrase));
      const savedRows = [], historyRows = [], colRows = [];
      for (const s of saved || []) {
        const id = s.zkId || makeItemId("paper");
        savedRows.push({ id, kind: "paper", collectionId: s.collectionId || null, payload: { ...vaultCtl.paperPayload(s), zkMigrated: true }, rev: vaultCtl.nextRev(id) });
      }
      for (const h of history || []) {
        const id = h.zkId || h.id || makeItemId("inv");
        historyRows.push({ id, kind: "investigation", collectionId: null, payload: { ...vaultCtl.invPayload(h), zkMigrated: true }, rev: vaultCtl.nextRev(id) });
      }
      for (const c of collections || []) {
        colRows.push({ id: c.id, kind: "collection-meta", collectionId: null, payload: { ...vaultCtl.colPayload(c), zkMigrated: true }, rev: vaultCtl.nextRev(c.id) });
      }
      vaultCtl.setSession(session);
      vaultCtl.setMode("unlocked");
      vaultCtl.setMigPending(false);
      vaultCtl.seedPushed(savedRows.map((r) => r.id), historyRows.map((r) => r.id));
      vaultCtl.writeBackSaved(savedRows);
      vaultCtl.writeBackHistory(historyRows);
      vaultCtl.writeBackCollections(colRows);
      const allRows = [...savedRows, ...historyRows, ...colRows];
      if (allRows.length) await vaultCtl.pushBatched(session, allRows);
      let deleted = null;
      let purgeFailed = false;
      try {
        const res = await session.purgeLegacy();
        deleted = (res && (res.deleted || res.counts)) || null;
      } catch (e) {
        purgeFailed = true;
        setPurgeNeeded(true);
        toast("Private Vault is on, but the old readable copies couldn't be removed. Use \"Remove old readable copies\" below to try again.", { tone: "error" });
      }
      if (deleted) {
        setPurgeNeeded(false);
        toast(`Private Vault is on. Removed the old readable copies: ${deleted.saved || 0} saved, ${deleted.history || 0} investigations, ${deleted.collections || 0} collections.`);
      } else if (!purgeFailed) {
        setPurgeNeeded(false);
        toast("Private Vault is on.");
      }
    } catch (e) {
      vaultCtl.setSession(null);
      vaultCtl.setMode("locked");
      toast(vaultCtl.errorMessage(e, "Couldn't finish turning on Private Vault."), { tone: "error" });
    } finally {
      vaultCtl.holdLegacy(false);
      setBusy("");
    }
  };

  const doRotate = async () => {
    if (busy) return;
    const session = vaultCtl.getSession();
    if (!session) return;
    const phrase = await getRecoveryPhrase().catch(() => null);
    if (!phrase) {
      vaultCtl.setMode("locked");
      toast("Private Vault is locked on this device — confirm your recovery phrase in Settings to resume syncing.");
      return;
    }
    setBusy("rotate");
    try {
      sfx();
      await session.rotate(phrase);
      const pulled = await session.pullItems();
      vaultCtl.applyItems(session, pulled.items, pulled.quarantined);
      toast("Vault key rotated. Anything encrypted under the old key can no longer be written to.");
    } catch (e) {
      toast(vaultCtl.errorMessage(e, "Couldn't rotate the vault key."), { tone: "error" });
    } finally { setBusy(""); }
  };

  const doPurgeRetry = async () => {
    if (busy) return;
    const session = vaultCtl.getSession();
    if (!session) return;
    setBusy("purge");
    try {
      sfx();
      const res = await session.purgeLegacy();
      const d = (res && (res.deleted || res.counts)) || {};
      setPurgeNeeded(false);
      toast(`Old readable copies removed: ${d.saved || 0} saved, ${d.history || 0} investigations, ${d.collections || 0} collections.`);
    } catch (e) {
      toast(vaultCtl.errorMessage(e, "Couldn't remove the old copies."), { tone: "error" });
    } finally { setBusy(""); }
  };

  const doUnlock = async () => {
    if (busy) return;
    const typed = unlockPhrase.trim();
    // Awaited: isValidRecoveryPhrase is async in the production bundle
    // (lazy facade via the vite alias); a bare call is always truthy.
    if (!(await isValidRecoveryPhrase(typed))) { toast("That doesn't look like a valid 24-word recovery phrase.", { tone: "error" }); return; }
    setBusy("unlock");
    try {
      sfx();
      let session = vaultCtl.getSession();
      if (!session) {
        if (!user || !user.id) throw new Error("Sign in first to use Private Vault.");
        session = new ZkSession({ userId: user.id, post: vaultCtl.post, getPhrase: getRecoveryPhrase });
      }
      await session.unlock(normalizePhrase(typed));
      const pulled = await session.pullItems();
      vaultCtl.setSession(session);
      if ((pulled.items || []).length === 0 && vaultCtl.migPending) {
        // Half-finished migration: the vault is empty but the library
        // never moved into it. Keep the library visible and stay ready
        // to finish — never swap it for an empty vault.
        vaultCtl.setMode("locked");
        toast("Private Vault wasn't finished turning on. Use \"Finish turning on Private Vault\" below to move your library into the vault.");
      } else {
        vaultCtl.applyItems(session, pulled.items, pulled.quarantined);
        vaultCtl.setMode("unlocked");
        setUnlockPhrase("");
        setShowUnlock(false);
        toast("Private Vault unlocked on this device.");
      }
    } catch (e) {
      toast(vaultCtl.errorMessage(e, "Couldn't unlock Private Vault with that phrase."), { tone: "error" });
    } finally { setBusy(""); }
  };

  // Writes the current browser library back as ordinary readable rows.
  // Collections are recreated (they get new server ids), saved papers'
  // collection links are remapped onto those new ids, then saved/history
  // are replaced. Vault bookkeeping (zkId/zkRev) is stripped everywhere.
  const writePlaintextLibrary = async () => {
    const strip = (s) => { const { zkId, zkRev, ...rest } = s || {}; return rest; };
    const idMap = new Map();
    const freshCols = [];
    const failedCols = [];
    for (const c of collections || []) {
      try {
        const r = await apiDataPost("collections", { action: "create", name: c.name });
        freshCols.push({ id: r.id, name: r.name, created_at: Date.now() });
        idMap.set(c.id, r.id);
      } catch (e) {
        // Never silently drop a collection: items filed under a collection
        // that failed to recreate would lose their shelf. Surface it.
        failedCols.push(c.name || "Untitled collection");
      }
    }
    if (failedCols.length) {
      throw new Error(
        "Couldn't write back " + failedCols.length + " collection" + (failedCols.length === 1 ? "" : "s") +
        " (" + failedCols.slice(0, 3).join(", ") + (failedCols.length > 3 ? ", …" : "") +
        "). Your saved items are untouched — try again in a moment."
      );
    }
    const remap = (s) => {
      const st = strip(s);
      const cid = st.collectionId;
      st.collectionId = cid && idMap.has(cid) ? idMap.get(cid) : null;
      return st;
    };
    await apiDataPost("saved", { action: "replace-all", items: (saved || []).map(remap) });
    await apiDataPost("history", { action: "replace-all", items: (history || []).map(strip) });
    // Keep the UI consistent with what the server now holds.
    setSaved((prev) => (prev || []).map(remap));
    setHistory((prev) => (prev || []).map(strip));
    setCollections(freshCols);
  };

  const doDisable = async () => {
    if (busy) return;
    const session = vaultCtl.getSession();
    setBusy("disable");
    vaultCtl.holdLegacy(true);
    try {
      sfx();
      if (session) await session.dropAll();
      vaultCtl.lockAll(); // wipes keys from memory, vault mode -> off
      if (disableConsent) {
        // Explicitly consented, never silent: write the current library
        // back as ordinary readable rows so other devices see it again.
        await writePlaintextLibrary();
        vaultCtl.setLocalOnly(false);
        toast("Private Vault is off. Your library was written back as readable data.");
      } else {
        // No consent: the library stays in this browser only. Readable
        // syncing is paused until it's explicitly resumed in Settings —
        // nothing is written back as plaintext on its own.
        vaultCtl.setLocalOnly(true);
        toast("Private Vault is off. Your library stays in this browser only — resume readable syncing in Settings if you want it on Cerebrum's servers.");
      }
      setDisableStep(false);
      setDisableConsent(false);
      setPurgeNeeded(false);
    } catch (e) {
      toast(vaultCtl.errorMessage(e, "Couldn't turn off Private Vault."), { tone: "error" });
    } finally {
      vaultCtl.holdLegacy(false);
      setBusy("");
    }
  };

  // Explicit consent to readable syncing after a no-consent disable.
  // This is the intentionally-designed action that lifts the local-only
  // block — nothing else does.
  const doResumeReadable = async () => {
    if (busy) return;
    setBusy("resume");
    try {
      sfx();
      await writePlaintextLibrary();
      vaultCtl.setLocalOnly(false);
      toast("Readable syncing resumed. Your library is on Cerebrum's servers as readable data again.");
    } catch (e) {
      toast("Couldn't resume readable syncing. Your library is still only in this browser.", { tone: "error" });
    } finally {
      setBusy("");
    }
  };

  return (
    <Section
      title="Private Vault"
      footer="Private Vault encrypts your saved papers, investigations, and collection names on this device before they sync, so Cerebrum's servers store them without being able to read them. This part of Cerebrum has not been independently audited."
    >
      {mode === "off" && (<>
        <Row
          label="Private Vault"
          desc="Keep your saved papers, investigations, and collection names private: they're encrypted on your device with your recovery phrase, and Cerebrum's servers can't read them."
          control={<UIButton P={P} variant="ghost" onClick={startEnable} disabled={busy === "enable"} style={pillBtn}>{busy === "enable" ? "Working…" : "Make my library private"}</UIButton>}
          last={!needE2ee && !enableStep && !vaultCtl.localOnly}
        />
        {vaultCtl.localOnly && (
          <Row
            label="Readable syncing paused"
            desc="Your library is only in this browser. Nothing is written to Cerebrum's servers as readable data until you say so."
            control={<UIButton P={P} variant="ghost" onClick={doResumeReadable} disabled={busy === "resume"} style={pillBtn}>{busy === "resume" ? "Resuming…" : "Resume readable syncing"}</UIButton>}
            last={!needE2ee && !enableStep}
          />
        )}
        {needE2ee && (
          <div style={noteBox}>
            <div style={warnLine}>
              <Icon name="warning" size={15} style={{ color: STATUS.warn, flexShrink: 0, marginTop: 1 }} />
              <span>Private Vault uses the same recovery phrase as encrypted conversations, and this device doesn't have one yet. Set up encrypted conversations above first, then come back here.</span>
            </div>
            <UIButton P={P} variant="ghost" onClick={() => { sfx(); setNeedE2ee(false); }} style={ghostBtn}>OK</UIButton>
          </div>
        )}
        {enableStep === "warnings" && (
          <div style={noteBox}>
            <div style={{ ...fieldLabel, fontSize: FONT_SIZES.small, color: P.ink, marginBottom: 10 }}>Before you turn this on, three things you should know:</div>
            <div style={warnLine}>
              <Icon name="warning" size={15} style={{ color: STATUS.bad, flexShrink: 0, marginTop: 1 }} />
              <span>If you lose your recovery phrase and lose all your devices, your saved papers and investigations are gone forever. Cerebrum cannot get them back — there is no backdoor, and support can't override this.</span>
            </div>
            <div style={warnLine}>
              <Icon name="warning" size={15} style={{ color: STATUS.warn, flexShrink: 0, marginTop: 1 }} />
              <span>Anything you saved before today was readable from Cerebrum's servers. Those items stay labeled that way, honestly — encryption can't rewrite history.</span>
            </div>
            <div style={{ ...warnLine, marginBottom: 14 }}>
              <Icon name="warning" size={15} style={{ color: STATUS.warn, flexShrink: 0, marginTop: 1 }} />
              <span>Server backups may keep old readable copies until the backup retention window passes.</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <UIButton P={P} variant="ghost" onClick={() => { sfx(); setEnableStep("phrase"); }} style={pillBtn}>I understand — continue</UIButton>
              <UIButton P={P} variant="ghost" onClick={() => { sfx(); setEnableStep(null); }} style={ghostBtn}>Not now</UIButton>
            </div>
          </div>
        )}
        {enableStep === "phrase" && (
          <div style={noteBox}>
            <div style={fieldLabel}>Type your 24-word recovery phrase</div>
            <div style={{ ...warnLine, marginBottom: 10 }}>
              <span>This proves the phrase is really yours, and it's the phrase your vault will be locked with. It never leaves this device.</span>
            </div>
            <textarea
              aria-label="Type your 24-word recovery phrase"
              value={typedPhrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              rows={3} autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder="Enter the 24 words in order, separated by spaces"
              style={textArea}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doEnable} disabled={!typedPhrase.trim() || busy === "enable"} style={{ ...pillBtn, opacity: !typedPhrase.trim() ? 0.45 : 1 }}>
                {busy === "enable" ? "Working…" : "Make my library private"}
              </button>
              <UIButton P={P} variant="ghost" onClick={() => { sfx(); setEnableStep("warnings"); setTypedPhrase(""); }} style={ghostBtn}>Back</UIButton>
            </div>
          </div>
        )}
        {enableStep === "migrating" && (
          <div style={noteBox}>
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-font)", lineHeight: 1.5 }}>
              Making your library private — encrypting everything on this device, uploading it, then removing the old readable copies. Keep this tab open.
            </div>
          </div>
        )}
      </>)}
      {mode === "locked" && (<>
        <Row
          label="Private Vault"
          desc="Private Vault is locked on this device."
          control={statusPill("Locked", STATUS.warn)}
        />
        {vaultCtl.migPending && (
          <Row
            label="Finish turning on Private Vault"
            desc="The vault was created but your library didn't finish moving into it. Finish now — your library stays exactly as it is until the encrypted upload succeeds."
            control={<button onClick={doFinishMigration} disabled={busy === "finish"} style={pillBtn}>{busy === "finish" ? "Finishing…" : "Finish"}</button>}
          />
        )}
        <Row
          label="Unlock with recovery phrase"
          desc="Type your 24-word recovery phrase to unlock the vault on this device and resume syncing."
          control={<UIButton P={P} variant="ghost" onClick={() => { sfx(); setShowUnlock((v) => !v); }} style={ghostBtn}>{showUnlock ? "Close" : "Unlock"}</UIButton>}
          last={!showUnlock}
        />
        {showUnlock && (
          <div style={noteBox}>
            <div style={fieldLabel}>Your 24-word recovery phrase</div>
            <textarea
              aria-label="Your 24-word recovery phrase"
              value={unlockPhrase}
              onChange={(e) => setUnlockPhrase(e.target.value)}
              rows={3} autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder="Enter the 24 words in order, separated by spaces"
              style={textArea}
            />
            <button onClick={doUnlock} disabled={!unlockPhrase.trim() || busy === "unlock"} style={{ ...pillBtn, opacity: !unlockPhrase.trim() ? 0.45 : 1 }}>
              {busy === "unlock" ? "Unlocking…" : "Unlock Private Vault"}
            </button>
          </div>
        )}
      </>)}
      {mode === "unlocked" && (<>
        <Row
          label="Private Vault"
          desc="Private Vault is on. Cerebrum's servers cannot read these items."
          control={statusPill("On", STATUS.good)}
        />
        <Row
          label="Rotate vault key"
          desc="Generates a fresh key and re-encrypts everything. Do this if you think a device was compromised — the old key stops working immediately."
          control={<button onClick={doRotate} disabled={busy === "rotate"} style={pillBtn}>{busy === "rotate" ? "Rotating…" : "Rotate"}</button>}
          last={!purgeNeeded && !disableStep}
        />
        {purgeNeeded && (
          <Row
            label="Remove old readable copies"
            desc="The old readable copies of your library are still on Cerebrum's servers. Remove them now."
            control={<button onClick={doPurgeRetry} disabled={busy === "purge"} style={pillBtn}>{busy === "purge" ? "Removing…" : "Remove"}</button>}
            last={!disableStep}
          />
        )}
        <Row
          label="Turn off Private Vault"
          desc="Deletes the encrypted vault from Cerebrum's servers. Your library stays decrypted in this browser."
          control={<button onClick={() => { sfx(); setDisableStep((v) => !v); }} style={{ ...dangerBtn, background: "transparent" }}>{disableStep ? "Keep it on" : "Turn off…"}</button>}
          last={!disableStep}
          destructive={disableStep}
        />
        {disableStep && (
          <div style={noteBox}>
            <div style={{ ...warnLine, marginBottom: 12 }}>
              <Icon name="warning" size={15} style={{ color: STATUS.bad, flexShrink: 0, marginTop: 1 }} />
              <span>Turning it off deletes the encrypted vault from Cerebrum's servers. Your library stays decrypted in this browser, exactly as you see it now.</span>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 12, minHeight: 44 }}>
              <input
                type="checkbox" checked={disableConsent} onChange={(e) => { sfx(); setDisableConsent(e.target.checked); }}
                style={{ width: 20, height: 20, marginTop: 2, accentColor: accent, flexShrink: 0, cursor: "pointer" }}
              />
              <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, lineHeight: 1.5, fontFamily: "var(--cb-font)" }}>
                Also write my library back to my account as readable data, so my other devices see it again. Cerebrum's servers will be able to read it.
              </span>
            </label>
            {!disableConsent && (
              <div style={{ ...warnLine, marginBottom: 12 }}>
                <span>Unchecked, your library stays only in this browser until you save or change something — then normal syncing resumes as readable data.</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doDisable} disabled={busy === "disable"} style={dangerBtn}>
                {busy === "disable" ? "Turning off…" : "Turn off Private Vault"}
              </button>
              <UIButton P={P} variant="ghost" onClick={() => { sfx(); setDisableStep(false); setDisableConsent(false); }} style={ghostBtn}>Keep it on</UIButton>
            </div>
          </div>
        )}
      </>)}
    </Section>
  );
}

function PrivacySettings({ P, accent, at, sfx, Section, Row, Switch, Picker, user }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiDataGet("profile")
      .then((res) => { if (!cancelled && res && res.privacy) setState(res.privacy); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const write = async (patch, key) => {
    if (busy) return;
    setBusy(key);
    const prev = state;
    setState((s) => ({ ...s, ...patch }));
    try {
      await apiDataAction("update-profile", {
        ...(patch.discoverable !== undefined ? { discoverable: patch.discoverable } : {}),
        ...(patch.showAffiliation !== undefined ? { show_affiliation: patch.showAffiliation } : {}),
        ...(patch.dmPolicy !== undefined ? { dm_policy: patch.dmPolicy } : {}),
      });
      sfx();
    } catch (e) {
      // Roll the switch back rather than leaving it showing a setting that
      // did not save. A privacy toggle that lies is worse than one that
      // fails loudly.
      setState(prev);
      toast(e.message || "Couldn't save that setting.", { tone: "error" });
    } finally { setBusy(""); }
  };

  if (!state) {
    // Guests have no profile row, so this never resolves — say so instead
    // of spinning forever.
    if (!user) {
      return (
        <Section title="Privacy" footer="Sign in to control who can find you.">
          <Row label="Privacy settings live here" desc="Sign in and this becomes your discoverability controls." last />
        </Section>
      );
    }
    return (
      <Section title="Privacy">
        <Row label="Loading your privacy settings…" last />
      </Section>
    );
  }

  return (
    <Section
      title="Privacy"
      footer="Cerebrum has no member directory, no institution pages, and no follower lists. Nobody can browse their way to you. They have to search your name or your @username, and these settings decide whether even that works."
    >
      <Row
        label="Let people find me in search"
        desc="When this is off, searching your name or @username returns nothing and your profile link stops working, including for people who already have it. People already following you keep seeing you."
        control={<Switch on={state.discoverable} onChange={(v) => write({ discoverable: v }, "disc")} label="Findable in search" />}
      />
      <Row
        label="Show my institution on my profile"
        desc="Your affiliation is never searchable and never links anywhere, because there are no institution pages on Cerebrum. This only decides whether it appears on your profile at all."
        control={<Switch on={state.showAffiliation} onChange={(v) => write({ showAffiliation: v }, "aff")} label="Show institution" />}
      />
      <Row
        label="Who can start a conversation with you"
        desc={state.dmPolicy === "anyone"
          ? "Anyone signed in can message you out of the blue."
          : "Only people you follow can open a new conversation. Conversations you're already in stay open either way."}
        control={
          <Picker
            value={state.dmPolicy}
            options={[["following", "People I follow"], ["anyone", "Anyone"]]}
            onChange={(v) => write({ dmPolicy: v }, "dm")}
            ariaLabel="Who can start a conversation with you"
          />
        }
        last
      />
    </Section>
  );
}

function LocalSlider({ label, value, min, max, step, format, onCommit, accent, P }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: FONT_SIZES.small, color: P.ink2 }}>{label}</span>
        <span style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)" }}>{format(local)}</span>
      </div>
      <div style={{ minHeight: 44, display: "flex", alignItems: "center" }}>
        <input type="range" min={min} max={max} step={step} value={local} onChange={(e) => setLocal(parseFloat(e.target.value))} onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit} style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
      </div>
    </div>
  );
}

function SystemStatus({ P, accent }) {
  const [rows, setRows] = useState(null);
  const check = useCallback(async () => {
    // Commit 70 — these were all GETs, which only ever proved "the file is
    // deployed". A user hit "Calls aren't set up on the server" while this
    // panel cheerfully reported signaling as live, because the thing that
    // was failing was the WRITE path and nothing here ever wrote.
    //
    // The signaling probe is now a POST with deliberately invalid ids. It
    // exercises origin, session, rate limit, payload validation, the
    // self-healing schema, and the thread-membership query — everything a
    // real ring does except the final insert — and a healthy server answers
    // 403 ("not authorized for this call"), which is a pass. A 500 here
    // means the call path is genuinely broken, which is what we needed to
    // be able to see.
    const probes = [
      ["Calling: signaling", "/api/callsignal", "callsignal.js", "POST"],
      ["Calling: ring delivery", "/api/data?resource=incoming-calls", "data.js"],
      ["Calling: network relay", "/api/iceservers", "iceservers.js"],
      ["Trending feed", "/api/trending", "trending.js"],
      // Commit 76 — the card-imagery engine, checked end to end rather
      // than by existence. This is the probe that would have caught "no
      // images in Trending" before it shipped: it asks for a picture of
      // something every source should know about and reports which one
      // actually answered. (Renamed in Commit 92 — this was labelled
      // "Illustrations", which is now the name of a feature that no
      // longer exists. It has always been the photo resolver behind
      // trending cards, which is very much still here.)
      ["Card imagery", "/api/image?q=spiral%20galaxy&debug=1", "image.js", null, "image"],
    ];
    const out = [];
    for (const [label, url, file, method, kind] of probes) {
      let state = "down", detail = "";
      try {
        const res = method === "POST"
          ? await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ threadId: "__probe__", clientId: "__probe__", type: "bye", payload: {} }),
            })
          : await fetch(url);
        // Commit 77 — how "not deployed" actually presents on Cloudflare
        // Pages, learned from a real 405 in the wild.
        //
        // Pages falls back to the static asset handler for any path no
        // Function claims. That handler answers a GET with index.html
        // (HTTP 200 — which is why these probes cheerfully reported "live"
        // for an endpoint that did not exist) and answers a POST with
        // 405 Method Not Allowed, because you cannot POST to a static
        // file. Neither is a 404. So:
        //   • 405 on the POST probe  -> the Function file is missing
        //   • HTML body on a GET     -> the Function file is missing
        // Both now say so by name instead of showing a raw status code.
        const ctype = res.headers.get("content-type") || "";
        if (res.status === 404 || (method === "POST" && res.status === 405)) {
          state = "missing";
          detail = file + " isn't deployed, Cloudflare is serving the app shell for this path";
        }
        else if (res.ok && !ctype.includes("json")) {
          state = "missing";
          detail = file + " isn't deployed: this path returned the page, not the API";
        }
        // 401/403 mean the endpoint EXISTS and answered — it just wants a
        // session or rejected this probe's fake ids. For "is it deployed?"
        // that is a pass, and treating it as a failure would be a false
        // alarm for every signed-out visitor.
        else if (kind === "image" && res.ok) {
          // A 200 with no picture in it is not a healthy illustration
          // engine, it is the exact failure being diagnosed. Report which
          // source answered, or that none did.
          const d = await res.json().catch(() => null);
          const hits = ((d && d.sources) || []).filter((x) => x.result === "hit");
          const errs = ((d && d.sources) || []).filter((x) => x.result === "error");
          if (d && d.image && d.image.url) { state = "ok"; detail = "via " + (d.image.source || "?"); }
          else if (errs.length) { state = "down"; detail = errs[0].source + ": " + (errs[0].error || "error"); }
          else { state = "down"; detail = "no source returned a picture"; }
          // Keep the failure detail next to the warn dot: a "via X" from a
          // surviving source must not overwrite e.g. "openverse: 500".
          if (hits.length && state === "down") detail += " · via " + hits[0].source;
        }
        else if (res.ok || res.status === 401 || res.status === 403 || res.status === 400) { state = "ok"; }
        else {
          state = "down";
          // Carry the server's own explanation through — "HTTP 500" tells
          // nobody anything, and this panel is where someone is sent when
          // a call fails.
          let msg = "";
          try { msg = (await res.json()).error || ""; } catch (cbErr) { console.error("[Cerebrum] settings.jsx if: msg = (await res.json()).error || ''; }:", cbErr); }
          detail = msg ? msg.slice(0, 90) : "HTTP " + res.status;
        }
      } catch { state = "down"; detail = "no response"; }
      out.push({ label, state, detail, file });
    }
    setRows(out);
  }, []);
  useEffect(() => { check(); }, [check]);
  const tone = (st) => (st === "ok" ? STATUS.good : st === "missing" ? STATUS.bad : STATUS.warn);
  return (
    <div>
      {(rows || []).map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px solid ${P.line}` }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: tone(r.state), flexShrink: 0 }} />
          <span style={{ fontSize: FONT_SIZES.small, color: P.ink, flex: 1 }}>{r.label}</span>
          <span style={{ fontSize: FONT_SIZES.caption, color: r.state === "ok" ? P.faint : tone(r.state), fontFamily: "var(--cb-font)" }}>
            {r.state === "ok" ? "live" : r.detail || r.state}
          </span>
        </div>
      ))}
      {!rows && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "12px 0" }}>Checking…</div>}
      <UIButton P={P} variant="ghost" onClick={check} style={{ minHeight: 44,
        marginTop: 14, padding: "8px 16px", borderRadius: 9999, cursor: "pointer",
        background: "transparent", border: `1px solid ${P.line2}`, color: P.ink2,
        fontSize: FONT_SIZES.caption, fontWeight: 600, fontFamily: "var(--cb-font)",
      }}>Re-check</UIButton>
    </div>
  );
}

function ConfigStatus({ P, accent }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const load = useCallback(async () => {
    setState({ status: "loading", data: null });
    try {
      const r = await fetch("/api/config", { credentials: "include" });
      if (r.status === 403) return setState({ status: "forbidden", data: null });
      if (!r.ok) return setState({ status: "error", data: null, detail: "HTTP " + r.status });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) return setState({ status: "missing", data: null });
      try {
        setState({ status: "ready", data: await r.json() });
      } catch {
        setState({ status: "error", data: null, detail: "unreadable response" });
      }
    } catch (e) {
      /* Fetch itself threw — network down, content blocker, or the browser
         refused the request. Surface the reason so the panel diagnoses
         itself instead of just saying "couldn't read". */
      const msg = (e && (e.message || String(e))) || "network error";
      setState({ status: "error", data: null, detail: "request failed: " + msg });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.status === "loading") {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "12px 0" }}>Checking configuration…</div>;
  }
  if (state.status === "forbidden") {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "12px 0", lineHeight: 1.6 }}>
      Configuration is visible to the account listed in FOUNDER_EMAIL. If that should be you, check that the variable is set in Cloudflare and matches the address you signed in with.
    </div>;
  }
  if (state.status === "missing") {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "12px 0", lineHeight: 1.6 }}>
      /api/config isn't answering. It may not be deployed yet.
    </div>;
  }
  if (state.status !== "ready" || !state.data) {
    return <div style={{ fontSize: FONT_SIZES.small, color: P.faint, padding: "12px 0" }}>
      Couldn't read the configuration just now{state.detail ? ` (${state.detail})` : ""}. <button onClick={load} style={{ background: "none", border: "none", color: accent, cursor: "pointer", font: "inherit", textDecoration: "underline", padding: 0 }}>Try again</button>
    </div>;
  }

  const groups = [];
  for (const v of state.data.vars || []) {
    let g = groups.find((x) => x.name === v.group);
    if (!g) { g = { name: v.group, items: [] }; groups.push(g); }
    g.items.push(v);
  }
  const padded = (state.data.vars || []).filter((v) => v.trimmedDiffers);
  const bindings = state.data.bindings || {};

  const pill = (ok, label) => (
    <span style={{
      flexShrink: 0, fontSize: FONT_SIZES.micro, fontWeight: 700, fontFamily: "var(--cb-font)",
      padding: "2px 9px", borderRadius: RADIUS.pill,
      color: ok ? accent : P.faint,
      background: ok ? withAlpha(accent, 0.12) : (P.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
      border: `1px solid ${ok ? withAlpha(accent, 0.3) : P.line}`,
    }}>{label}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {padded.length > 0 && (
        <div style={{
          padding: "12px 16px", borderRadius: RADIUS.md,
          border: `1px solid ${withAlpha(STATUS.bad, 0.4)}`, background: withAlpha(STATUS.bad, 0.08),
          fontSize: FONT_SIZES.caption, color: P.ink, lineHeight: 1.6, fontFamily: "var(--cb-font)",
        }}>
          <strong>{padded.map((v) => v.name).join(", ")}</strong> {padded.length === 1 ? "has" : "have"} a space or newline around the value. That is invisible in the Cloudflare dashboard and will fail every request. Re-paste without the trailing character.
        </div>
      )}

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[["Database", bindings.DB], ["Workers AI", bindings.AI], ["Shared rate limit", bindings.RATE_LIMIT_D1]].map(([label, ok]) => (
          <span key={label} style={{
            display: "inline-flex", alignItems: "center", gap: 7, fontSize: FONT_SIZES.caption,
            padding: "5px 11px", borderRadius: RADIUS.pill, fontFamily: "var(--cb-font)",
            color: ok ? P.ink : P.faint,
            border: `1px solid ${ok ? withAlpha(accent, 0.3) : P.line}`,
            background: ok ? withAlpha(accent, 0.08) : "transparent",
          }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? accent : P.faint }} />
            {label}
          </span>
        ))}
      </div>

      {groups.map((g) => (
        <div key={g.name}>
          <div style={{ fontSize: FONT_SIZES.caption, ...TYPE.label, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-font)", marginBottom: SP.sm }}>{g.name}</div>
          {g.items.map((v, i) => (
            <div key={v.name} style={{
              display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 0",
              borderTop: i > 0 ? `1px solid ${P.line}` : "none",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT_SIZES.caption, fontWeight: 600, color: v.present ? P.ink : P.ink2, fontFamily: "var(--cb-font)" }}>{v.name}</div>
                <div style={{ fontSize: FONT_SIZES.micro, color: P.faint, marginTop: 3, lineHeight: 1.5, fontFamily: "var(--cb-font)" }}>
                  {v.present ? v.does : v.breaks}
                </div>
              </div>
              {pill(v.present, v.present ? "set" : "not set")}
            </div>
          ))}
        </div>
      ))}

      <button onClick={load} style={{ minHeight: 44,
        alignSelf: "flex-start", background: "none", border: `1px solid ${P.line2}`,
        color: P.ink2, cursor: "pointer", fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-font)",
        padding: "6px 16px", borderRadius: RADIUS.pill,
      }}>Re-check</button>
    </div>
  );
}

function SettingsView({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, typewriter, setTypewriter, muted, setMuted, soundMode, setSoundMode, animationMode, setAnimationMode, animSpeed, setAnimSpeed, sfx, setSessions, setSaved, saved, history, setHistory, highContrast, setHighContrast, fontSize, setFontSize, reducedTransparency, setReducedTransparency, autoplay, setAutoplay, dyslexicFont, setDyslexicFont, lineSpacing, setLineSpacing, focusHighlight, setFocusHighlight, citationStyle, setCitationStyle, user, onSignOut, onAccountDeleted, onOpenAuth, initialTab, close, dataDensity, setDataDensity, collections, setCollections, vaultCtl, proStatus, onOpenPro, onProChanged }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(initialTab || "answers");
  // Wave 3 — the three destructive confirmations used to be inline
  // expanders inside their rows (Delete/Cancel pairs that shifted the
  // whole list down and broke the one-row-one-action anatomy). They are
  // real Dialog sheets now, opened from quiet label rows.
  const [clearOpen, setClearOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Commit 67
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState("");
  const highlightTimer = useRef(null);
  const [notify, setNotify] = useState(() => notifyPref());
  const [notifPerm, setNotifPerm] = useState(() => {
    try { return "Notification" in window ? Notification.permission : "unsupported"; } catch { return "unsupported"; }
  });
  // Commit 75 — founder diagnostics. Loaded only on the Account tab.
  const [founderStatus, setFounderStatus] = useState(null);
  useEffect(() => {
    // Founder's eyes only (Dusty's standing order): non-founder accounts
    // never even ask the server for owner status.
    if (tab !== "account" || !user || !user.isFounder) return;
    let dead = false;
    apiDataGet("founder-status").then((d) => { if (!dead && d) setFounderStatus(d); }).catch(() => {});
    return () => { dead = true; };
  }, [tab, user]);
  const setNotifyKind = (k, v) => {
    const next = { ...notify, [k]: v };
    setNotify(next); setNotifyPref(next); sfx();
  };

  // Commit 67 — watched-topic management on the History & Data tab.
  const [watchlist, setWatchlist] = useState([]);
  const [wlLoading, setWlLoading] = useState(false);
  const loadWatchlist = useCallback(async () => {
    if (!user) { setWatchlist([]); return; }
    setWlLoading(true);
    try {
      const d = await apiDataGet("watchlist");
      setWatchlist(d && Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      // Never leave the loading state stuck on: a failed fetch shows an
      // empty watchlist rather than "Loading your watchlist…" forever.
      setWatchlist([]);
    } finally {
      setWlLoading(false);
    }
  }, [user]);
  // Only fetched when the tab is actually open — this costs a live
  // literature query per topic upstream, and paying for it on every visit
  // to Settings regardless of which tab you wanted would be rude to both
  // the user and Europe PMC.
  useEffect(() => { if (tab === "privacy") loadWatchlist(); }, [tab, loadWatchlist]);

  // Commit 67 — reset every preference to its default.
  //
  // Deliberately drives the React setters rather than deleting the cb_*
  // cookies and reloading: each setter is already wired to write its own
  // cookie AND apply its live effect (font swap, density, contrast class),
  // so going through them means the page reflects the reset instantly and
  // there is exactly one place that knows how each preference is stored.
  // A cookie-wipe-and-reload would drift the moment a preference gains a
  // side effect.
  function resetAllSettings() {
    // Every value below is copied from that preference's own useState
    // initializer in App() — the cookie-absent default. Getting one wrong
    // would make "reset" quietly set a NEW value rather than restore the
    // original, which is worse than having no reset at all.
    setPaletteName("Sage");          // cb_pal
    setAccentName("Sage");          // cb_accent
    setCustomAccent("");            // cb_ca
    setAnswerLength("medium");      // cb_len
    setFactCheck(true);             // cb_fc !== "0"
    setMuted(false);                // cb_muted !== "1"
    setSoundMode("pulse");          // cb_snd
    setAnimationMode("cinematic");  // cb_anim2
    setAnimSpeed(1);                // cb_animS
    setHighContrast(false);         // cb_hc !== "1"
    setFontSize("medium");          // cb_fs
    setReducedTransparency(false);  // cb_rt !== "1"
    setAutoplay(false);             // cb_ap === "1"
    setDyslexicFont(false);         // cb_df !== "1"
    setLineSpacing("normal");       // cb_ls
    setFocusHighlight(false);       // cb_fh !== "1"
    setCitationStyle("vancouver");  // cb_cite
    setDataDensity("comfortable");  // cb_density
    setTypewriter(true);            // cb_tw !== "0"
    const allOn = { call: true, message: true, watch: true };
    setNotify(allOn); setNotifyPref(allOn);
    try { localStorage.removeItem("cb_tts_voice"); } catch (cbErr) { console.error("[Cerebrum] settings.jsx: localStorage.removeItem('cb_tts_voice'); }:", cbErr); } // TTS voice lives in localStorage, not a cookie
    setResetOpen(false);
    sfx();
    toast("Settings reset to defaults.");
  }
  const [delBusy, setDelBusy] = useState(false);
  // v6.7: the tab bar's sliding underline used to assume all 6 tabs were
  // equal width (`left`/`width` as `index/count` and `1/count` percentages)
  // — true on desktop, where flex:1 with enough room does divide them
  // evenly, but on a narrow phone viewport there isn't enough width for
  // "Sound & motion"/"Privacy & data" to fit at their natural size, and the
  // fixed `flex:1` sizing plus no way to scroll meant the bar just
  // overflowed the dialog with the last tab ("History & Data") clipped
  // clean off the edge — genuinely unreachable, not just visually off.
  // Making the bar horizontally scrollable fixes reachability; measuring
  // the active tab's real DOM position (instead of assuming equal widths)
  // keeps the underline correct at both sizes instead of just re-breaking
  // it for the scrollable case.
  const tabBtnRefs = useRef({});
  const [tabUnderline, setTabUnderline] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const el = tabBtnRefs.current[tab];
    if (el) {
      setTabUnderline({ left: el.offsetLeft, width: el.offsetWidth });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [tab, isMobile]);

  async function submitDeleteAccount() {
    setDelBusy(true);
    try { await apiAuth("delete-account", {}); onAccountDeleted(); close(); }
    catch (err) { toast(err.message || "Couldn't delete account.", { tone: "error" }); setDelBusy(false); }
  }

  // Commit 67 — Notifications is new. Cerebrum raises three kinds of
  // desktop notification (calls, messages, watched-topic alerts) and until
  // now had no in-app control over any of them; see notifyPref/cbNotify.
  // Each tab carries an icon because the desktop layout below is a vertical
  // rail, and a rail of bare words reads as a list of links rather than as
  // navigation.
  /* ══════════════════════════════════════════════════════════════
     Commit 88 — four tabs, not seven.

     Seven sections held about twenty-five settings, so every single one
     was thin: General was four rows, Audio & Voice was three. On a 1000px
     window that rendered as a small block of controls with six hundred
     pixels of empty black beneath it, sitting beside a SECOND vertical
     navigation column immediately to the right of the app's primary one.
     Two rails and a void is what an unfinished settings screen looks
     like, and no amount of alignment fixes a page that has nothing on it.

     Regrouped by the question being asked rather than by the mechanism:
     Answers (what comes back, and how it is read aloud), Appearance (how
     it looks, including everything that was under Accessibility — the
     split between "appearance" and "accessibility" was ours, not the
     user's; someone turning up contrast is doing the same job as someone
     picking a theme), Notifications & data, and Account.

     Nothing was removed. SETTINGS_INDEX below still maps every individual
     row to its tab, so search jumps to the right place.
     ══════════════════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════════════
     Wave 3 — the six sections. The old five-tab map split "appearance"
     from "accessibility" (a distinction that was ours, not the user's)
     and filed sound under Answers, motion under Appearance, notifications
     under their own tab, and diagnostics next to library management.
     These are grouped by the question being asked: who am I here, what
     comes back, how does it look, how does it sound and move, who sees
     what and where my data lives, and what's under the hood.

     Nothing was removed. SETTINGS_INDEX below still maps every individual
     row to its section, so search jumps to the right place.
     ══════════════════════════════════════════════════════════════ */
  const TABS = [
    ["account", "Account", "user"],
    ["answers", "Answers", "settings"],
    ["appearance", "Appearance", "eye"],
    ["sound", "Sound & motion", "volumeOn"],
    ["privacy", "Privacy & data", "shield"],
    ["about", "About", "question"],
  ];

  // Commit 67 — settings search.
  //
  // The sections grew from five to six, so someone is even less likely to
  // guess which one holds "reduce transparency". This index is maintained
  // by hand rather than derived from the rendered tree: deriving it would
  // mean rendering every section's contents on every keystroke to read
  // the labels back out, and a hand-list is honest about the fact that a
  // new setting has to be registered here to be findable.
  const SETTINGS_INDEX = [
    ["Answer length", "answers", "concise standard detailed response verbosity"],
    ["Check answers against their sources", "answers", "verify verification accuracy claims fact check"],
    ["Animated typing", "answers", "typewriter reveal progressive"],
    // Commit 100 — the privacy controls are findable by the words people
    // actually search for when they go looking for them, which is rarely
    // the word on the switch.
    ["Let people find me in search", "privacy", "privacy discoverable hidden invisible directory find people search"],
    ["Show my institution on my profile", "privacy", "privacy affiliation university college hide institution"],
    ["Who can start a conversation with you", "privacy", "privacy dm direct message strangers block messages"],
    ["Theme", "appearance", "dark light palette colour color"],
    ["Accent color", "appearance", "colour highlight brand"],
    ["Motion", "sound", "background animation motion particles effects reduce"],
    ["Animation speed", "sound", "motion speed particles rate"],
    ["Reduce transparency", "sound", "glass blur frosted solid"],
    ["Data density", "appearance", "compact comfortable spacing padding layout"],
    ["Desktop notifications", "privacy", "permission browser alerts push"],
    ["Incoming calls", "privacy", "ring call video audio"],
    ["Direct messages", "privacy", "inbox dm chat message"],
    ["Watched topics", "privacy", "papers literature alerts new research"],
    ["High contrast", "appearance", "contrast vision legibility"],
    ["Text size", "appearance", "font size larger bigger zoom"],
    ["Line spacing", "appearance", "leading line height readability"],
    ["Focus indicators", "appearance", "keyboard ring outline focus"],
    ["Dyslexia friendly font", "appearance", "opendyslexic typeface reading"],
    ["Auto read answers", "sound", "speech tts read aloud voice"],
    ["Sound effects", "sound", "mute clicks sfx sounds"],
    ["Search ambience", "sound", "tone background ambient sound"],
    ["Text to speech", "answers", "voice narration tts"],
    ["Saved conversations", "privacy", "history conversations clear delete"],
    // E2EE Phase 1.4 — encrypted messaging settings.
    ["Encrypted messaging", "privacy", "encryption e2ee secure devices recovery phrase"],
    ["Recovery phrase", "privacy", "recovery phrase backup restore"],
    ["Devices", "privacy", "devices remove revoke"],
    ["Saved articles", "privacy", "papers sources saved storage"],
    ["Watched topics list", "privacy", "watchlist unwatch topics manage"],
    ["Export workspace", "privacy", "backup download json export"],
    ["Import workspace", "privacy", "restore upload json import"],
    ["Reset all settings", "privacy", "defaults restore factory reset"],
    ["Clear all data", "privacy", "erase wipe delete everything storage"],
    ["Keyboard shortcuts", "about", "hotkeys keys shortcuts"],
    ["System status", "about", "health uptime api diagnostics"],
    ["Configuration", "about", "env environment variables cloudflare"],
    ["Version", "about", "build number release"],
    ["Sign out", "account", "logout leave session"],
    ["Delete account", "account", "remove erase danger"],
    ["Membership", "account", "pro lite free subscription billing quota usage"],
  ];
  const searchHits = query.trim().length < 2 ? [] : (() => {
    const q = query.trim().toLowerCase();
    return SETTINGS_INDEX
      .map(([label, tabId, kw]) => {
        const l = label.toLowerCase();
        // Rank a prefix match on the label itself above a hit that only
        // matched a keyword, so typing "text" surfaces "Text size" before
        // "Text to speech"'s keyword blob.
        const score = l.startsWith(q) ? 0 : l.includes(q) ? 1 : kw.includes(q) ? 2 : -1;
        return { label, tabId, score };
      })
      .filter((h) => h.score >= 0)
      .sort((a2, b2) => a2.score - b2.score)
      .slice(0, 7);
  })();
  const tabLabel = (id) => (TABS.find((t) => t[0] === id) || [null, id])[1];
  const jumpTo = (hit) => {
    sfx();
    setTab(hit.tabId);
    setQuery("");
    // Flash the row so the eye lands on it — arriving on a tab of twenty
    // controls with no indication which one you searched for is barely
    // better than not searching. The previous timer is cleared so quick
    // successive jumps don't erase the new highlight early.
    setHighlight(hit.label);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(""), 2400);
  };

  /* ── Building blocks. Pass 4 — Settings is a sober preference table,
     not a stack of panels: each section is a compact caption followed by
     rows separated by hairline dividers, on the page background. Nothing
     here is glass, and nothing pretends to be a card. ── */
  const divider = P.dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";

  const Section = ({ title, footer, children }) => (
    <div style={{ marginBottom: 28 }}>
      {/* Section headers are small caps captions — they name the table
          that follows rather than competing with it. */}
      {title && <div style={{ fontSize: FONT_SIZES.caption, ...TYPE.label, fontWeight: 700, color: P.faint, marginBottom: SP.sm, textTransform: "uppercase", letterSpacing: TRACKING.eyebrow, fontFamily: "var(--cb-font)" }}>{title}</div>}
      <div>{children}</div>
      {footer && <div style={{ fontSize: FONT_SIZES.small, color: P.faint, marginTop: 8, lineHeight: 1.5, fontFamily: "var(--cb-font)" }}>{footer}</div>}
    </div>
  );

  // Commit 67 — `highlight` is the label that settings-search just jumped
  // to. The row gets a ring and a wash for a couple of seconds so the eye
  // lands on it; without that, search drops you on a tab of twenty controls
  // with no idea which one you were looking for.
  /* Commit 84 — delegates to UIRow. The only thing this still owns is
     the search-jump highlight, which is Settings-specific. */
  const Row = ({ icon, label, desc, control, onClick, last, destructive, searchKey }) => {
    // The membership row's label is JSX (badge + tier name), so a plain
    // string comparison can never match it. searchKey gives such rows a
    // stable string the settings-search highlight can find.
    const lit = highlight && (highlight === label || (searchKey && highlight === searchKey));
    return (
      <UIRow
        P={P} accent={accent} label={label} desc={desc} last={last} paletteName={paletteName}
        onClick={onClick} tone={destructive ? "bad" : undefined}
        control={control || (onClick ? <span style={{ color: P.faint, fontSize: FONT_SIZES.subhead }}>›</span> : null)}
        style={{
          /* Pass 4 — compact preference-table rows: tighter padding and
             no side gutters, so the rows read as one ledger. */
          padding: "9px 2px", minHeight: 44,
          ...(lit ? {
            background: withAlpha(accent, 0.16),
            boxShadow: `inset 0 0 0 1px ${withAlpha(accent, 0.6)}, inset 3px 0 0 ${accent}`,
            transition: "background-color 0.35s ease, box-shadow 0.35s ease",
          } : { transition: "background-color 0.35s ease, box-shadow 0.35s ease" }),
        }}
      />
    );
  };

  const Switch = ({ on, onChange, label }) => (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => { sfx(); onChange(!on); }}
      style={{ width: 52, height: 44, background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 9999, position: "relative", flexShrink: 0, display: "block", background: on ? accent : P.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)", transition: "background 280ms ease" }}>
        <span style={{ position: "absolute", top: 2, left: 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </span>
    </button>
  );

  const Picker = ({ value, options, onChange, ariaLabel }) => (
    <UISelect P={P} accent={accent} value={value} options={options}
      onChange={(v) => { sfx(); onChange(v); }} ariaLabel={ariaLabel} style={{ fontSize: 16 }} />
  );

  return (
    // position/zIndex here are load-bearing — see pageView's own comment
    // (makeStyles) for why a plain static box never wins a stacking fight
    // against LivingBackground's absolutely-positioned canvas, opaque
    // background or not, past the first screenful of scroll.
    <div role="region" aria-label="Settings" style={{ flex: 1, minHeight: "100%", background: P.bg, display: "flex", flexDirection: "column", overflowY: "auto", position: "relative", zIndex: Z.content }}>
      {/* 62px of top padding on mobile clears the fixed menu button — see
          pageViewInner's comment; Settings sets its own padding and so
          needed the same correction independently. */}
      {/* Pass 4 — Settings is a single sober preference table, capped at
          760px on every viewport. A wider column turned the short tabs
          into a small block of controls beside a void; 760 keeps the table
          dense and readable. */}
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: isMobile ? "62px 18px 48px" : "34px 24px 68px", display: "flex", flexDirection: "column", fontFamily: "var(--cb-font)" }}>

        {/* Header. Settings became a full page (not a dialog) in Commit 62,
            but kept the dialog's horizontally-scrolling tab strip — a
            control that exists because a modal is short on width, on a page
            that has 1020px of it. Desktop now gets a vertical rail; mobile,
            where width really is scarce, keeps the strip. */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ fontSize: FONT_SIZES.display, ...TYPE.heading, color: P.ink, fontFamily: "var(--cb-font)" }}>Settings</div>

            {/* Commit 67 — search. See SETTINGS_INDEX. */}
            <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "0 1 320px", minWidth: 200 }}>
              <span aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: P.faint, display: "inline-flex", pointerEvents: "none" }}>
                <Icon name="search" size={15} />
              </span>
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); }
                  if (e.key === "Enter" && searchHits.length) jumpTo(searchHits[0]);
                }}
                placeholder="Search settings"
                aria-label="Search settings"
                style={{
                  width: "100%", padding: "9px 12px 9px 34px", minHeight: 44, borderRadius: 9999,
                  background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: `1px solid ${P.line}`, color: P.ink, outline: "none",
                  fontSize: 16, fontFamily: "var(--cb-font)",
                }}
              />
              {query.trim().length >= 2 && (
                <div className="cb-fade" style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: Z.header,
                  background: P.bg, border: `1px solid ${P.line2}`, borderRadius: 12,
                  boxShadow: "0 18px 48px rgba(0,0,0,0.35)", overflow: "hidden",
                }}>
                  {searchHits.length === 0 ? (
                    <div style={{ padding: "12px 16px", fontSize: FONT_SIZES.small, color: P.faint }}>
                      Nothing matches that.
                    </div>
                  ) : searchHits.map((h) => (
                    <button key={h.tabId + h.label} onClick={() => jumpTo(h)} className="cb-row" style={{ minHeight: 44,
                      display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10,
                      padding: "12px 16px", background: "transparent", border: "none", cursor: "pointer",
                      textAlign: "left", fontFamily: "var(--cb-font)",
                    }}>
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 600 }}>{h.label}</span>
                      <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.tight, whiteSpace: "nowrap" }}>{tabLabel(h.tabId)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isMobile && (
            <div className="cb-scroll-x" style={{ position: "relative", display: "flex", borderBottom: `1px solid ${P.line}`, marginBottom: 18, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {TABS.map(([id, label]) => (
                <button key={id} ref={(el) => { tabBtnRefs.current[id] = el; }} onClick={() => { sfx(); setTab(id); }}
                  style={{ minHeight: 44, flexShrink: 0, padding: "8px 12px 12px", fontSize: FONT_SIZES.caption, fontWeight: tab === id ? 700 : 500, background: "transparent", color: tab === id ? P.ink : P.faint, border: "none", cursor: "pointer", fontFamily: "var(--cb-font)", letterSpacing: TYPE.heading.letterSpacing, whiteSpace: "nowrap", transition: "color 200ms ease" }}>{label}</button>
              ))}
              <div aria-hidden="true" style={{ position: "absolute", bottom: -1, left: 0, width: 1, height: 2, background: accent, borderRadius: 8, transformOrigin: "0 50%", transform: "translateX(" + tabUnderline.left + "px) scaleX(" + tabUnderline.width + ")", transition: "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)" }} />
            </div>
          )}
        </div>

        {/* Commit 87 — the settings page used to be a 208px rail and a
            content column pinned to the left of a 1180px workspace, so the
            General tab (four rows) rendered as a small block of controls
            with roughly 600px of empty black to its right and below. Two
            vertical navigation columns side by side, then a void. Capping
            the pair and centring it makes the remaining space read as
            margin rather than as a page that failed to load. The real
            long-term fix is fewer, denser tabs — seven sections for about
            twenty-five settings is why any one of them looks empty. */}
        <div style={{ display: "flex", gap: 32, alignItems: "flex-start", width: "100%" }}>
          {/* Desktop rail. Sticky, so the navigation stays reachable on the
              long tabs (Appearance and Accessibility both scroll well past
              a viewport) instead of scrolling away and forcing a trip back
              to the top to change section. */}
          {!isMobile && (
            <nav aria-label="Settings sections" style={{ position: "sticky", top: 44, flex: "0 0 208px", display: "flex", flexDirection: "column", gap: 2 }}>
              {TABS.map(([id, label, icon]) => (
                <button key={id} ref={(el) => { tabBtnRefs.current[id] = el; }} onClick={() => { sfx(); setTab(id); }}
                  aria-current={tab === id ? "page" : undefined}
                  className="cb-row"
                  style={{ minHeight: 44,
                    display: "flex", alignItems: "center", gap: 11, width: "100%",
                    padding: "12px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                    textAlign: "left", fontFamily: "var(--cb-font)",
                    fontSize: FONT_SIZES.small, fontWeight: tab === id ? 700 : 500,
                    letterSpacing: TYPE.heading.letterSpacing,
                    background: tab === id ? withAlpha(accent, 0.11) : "transparent",
                    color: tab === id ? P.ink : P.ink2,
                  }}>
                  <span style={{ display: "inline-flex", color: tab === id ? accent : P.faint, flexShrink: 0 }}>
                    <Icon name={icon} size={16} />
                  </span>
                  {label}
                </button>
              ))}
            </nav>
          )}

        {/* Content */}
        <div key={tab} className="cb-fade" style={{ flex: 1, minWidth: 0, padding: isMobile ? "0 0 16px" : "0 0 16px", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>

          {tab === "account" && (<>
            {!user ? (
              <>
              <Section title="Account" footer="An account syncs your library across devices. Guest mode keeps working forever if you'd rather not.">
                <Row label="You're browsing as a guest" desc="Nothing here leaves this browser." control={
                  <button onClick={() => onOpenAuth("login")} style={{ minHeight: 44, padding: "8px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer" }}>Sign in</button>
                } last />
              </Section>
              <ProAccountSection P={P} accent={accent} at={at} user={user} proStatus={proStatus} onOpenPro={onOpenPro} Section={Section} Row={Row} />
              </>
            ) : (<>
              <Section title="Account">
                <Row label={user.email} desc="Signed in" last />
              </Section>
              {/* Pro membership: status, usage meter, upgrade/manage. */}
              <ProAccountSection P={P} accent={accent} at={at} user={user} proStatus={proStatus} onOpenPro={onOpenPro} Section={Section} Row={Row} />
              {/* Pro API keys. Rendered for Pro members; the server re-checks
                  the Pro gate on every key action, so this is courtesy. */}
              {(proStatus?.tier === "pro" || !!user?.isPro) && (
                <ApiKeyPanel P={P} accent={accent} at={at} Section={Section} Row={Row} />
              )}
              {/* Lite upsell nudge: Lite members see what full Pro unlocks
                  beyond their tier — API keys, investigation templates, and
                  the priority search queue. One row, honest, no dark pattern. */}
              {(proStatus?.tier === "lite" || !!proStatus?.isLite) && !(proStatus?.tier === "pro" || !!user?.isPro) && (
                <Section title="Pro unlocks more" footer="You're on Pro Lite. Full Pro adds the power features below.">
                  <Row label="API access, templates & priority queue"
                    desc="API keys with usage dashboards, 4 investigation templates, and skip-the-line search when it's busy."
                    control={
                      <UIButton P={P} accent={accent} at={at} variant="primary" onClick={onOpenPro} style={{ minHeight: 40, flexShrink: 0 }}>
                        See Pro
                      </UIButton>
                    } last />
                </Section>
              )}
              {/* Founder-only: permanent Pro grants. Rendered only for the
                  founder; the server re-checks FOUNDER_EMAIL on every call. */}
              {user.isFounder && (
                <ProGrantPanel P={P} accent={accent} at={at} Section={Section} Row={Row} onProChanged={onProChanged} />
              )}
              {/* Commit 100 — privacy used to sit here, under the account it
                  governs. It moved to Privacy & data: "who can see me" and
                  "where does my data live" are one question now. */}
              {/* The Password section is gone. Cerebrum signs you in with an
                  emailed code and nothing else; the password endpoints behind
                  this form created a credential that no sign-in path would
                  ever accept, while carrying PBKDF2 verification, an account-
                  existence oracle and an unverified-email signup route that
                  let someone claim an address they did not own. A control
                  that does nothing but add attack surface is not a feature. */}
              {/* Commit 75 — the founder badge depends on a Cloudflare
                  environment variable, and an env var is not part of a git
                  push. This panel exists to make that failure visible in the
                  app instead of over a screenshot. Per Dusty's standing order
                  (2026-09-15), it renders ONLY on the founder account —
                  nobody else ever sees owner verification, not even the
                  "not configured" state. */}
              {/* Owner verification panel: the founder's eyes only. Dusty's standing
                  order — nobody else ever sees this section, including the
                  "not configured" state. The operator IS the founder account. */}
              {user.isFounder && founderStatus && (
                <Section
                  title="Owner verification"
                  footer={
                    !founderStatus.configured
                      ? "Set FOUNDER_EMAIL in Cloudflare Pages → Settings → Environment variables, then redeploy. Pushing code does not set environment variables. That is a separate step in the Cloudflare dashboard."
                      : founderStatus.youAreFounder
                        ? "This account carries the Founder & Owner badge and the verified check."
                        : "FOUNDER_EMAIL is set, but it doesn't match this account's email address. Either change the variable to this account's address, or sign in with the address the variable names."
                  }
                >
                  <Row
                    label="FOUNDER_EMAIL"
                    desc={founderStatus.configured ? `Set to ${founderStatus.configuredValue}` : "Not set on the server"}
                    control={
                      <span style={{
                        fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label,
                        padding: "4px 12px", borderRadius: 9999,
                        color: founderStatus.configured ? (P.dark ? STATUS.good : "#047857") : statusBad(P, paletteName),
                        background: withAlpha(founderStatus.configured ? STATUS.good : STATUS.bad, 0.12),
                      }}>{founderStatus.configured ? "Configured" : "Missing"}</span>
                    }
                  />
                  <Row label="This account" desc={founderStatus.yourEmail || "Not available"} />
                  <Row
                    label="Match"
                    desc={founderStatus.matchedUser ? `Resolves to @${founderStatus.matchedUser}` : "No account matches that address"}
                    control={
                      <span style={{
                        fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label,
                        padding: "4px 12px", borderRadius: 9999,
                        color: founderStatus.youAreFounder ? (P.dark ? STATUS.good : "#047857") : P.faint,
                        background: withAlpha(founderStatus.youAreFounder ? STATUS.good : P.faint, 0.12),
                      }}>{founderStatus.youAreFounder ? "You" : "No"}</span>
                    }
                    last
                  />
                </Section>
              )}

              <Section title="Session">
                <Row label="Sign out" desc="Switches this browser back to guest mode." onClick={() => { onSignOut(); close(); }} last />
              </Section>
              <Section title="Danger zone" footer="Deletes your email, password, library and history from our servers. Immediately, and for good.">
                {/* Wave 3 — the old inline Delete/Cancel expander shifted
                    the whole list down and doubled the row anatomy. One
                    quiet row; the confirmation is a Dialog sheet. */}
                <Row label="Delete account" destructive onClick={() => setDeleteOpen(true)} last />
              </Section>
            </>)}
          </>)}

          {tab === "answers" && (<>
            <Section title="Responses">
              <Row label="Answer length" control={
                <Picker value={answerLength} options={[["short", "Concise"], ["medium", "Standard"], ["long", "Detailed"]]} onChange={setAnswerLength} ariaLabel="Answer length" />
              } />
              <Row label="Check answers against their sources" desc="Before showing an answer, go back through it and confirm each claim really appears in the papers it cites. Adds a few seconds." control={<Switch on={factCheck} onChange={(v) => { sfx(); setFactCheck(v); }} label="Fact check pass" />} />
              {/* RESTORED 2026-09-17: animated typing — the answer reveals
                  over about a second on fresh turns. */}
              <Row label="Animated typing" desc="Answers type themselves in as they are ready" control={<Switch on={typewriter} onChange={(v) => { sfx(); setTypewriter(v); }} label="Animated typing" />} last />
              {/* Citation format lives on each answer's References section,
                  where the decision is made — not duplicated here. */}
            </Section>

            {/* Wave 3 — how an answer is spoken is part of what an answer
                is, so the voice and key pickers live here. Auto-read (the
                when) lives under Sound & motion. */}
            <Section title="Read aloud" footer="The built-in voice is free and needs no setup. Answers are read aloud on this device using your browser's voice.">
              <TtsVoiceSetting P={P} accent={accent} at={at} S={S} sfx={sfx} />
            </Section>

          </>)}

          {tab === "appearance" && (<>
            <Section title="Theme">
              <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap" }}>
                {/* The Pro palette is members-only: it is not offered in the
                    picker at all unless the signed-in account is Pro. */}
                {Object.keys(PALETTES).filter((pn) => !isProPalette(pn) || (user && user.isPro)).map((pn) => (
                  <button key={pn} onClick={() => { sfx(); setPaletteName(pn); }}
                    style={{ flex: "1 1 100px", minWidth: 0, padding: "16px 12px 12px", borderRadius: 8, cursor: "pointer", border: paletteName === pn ? `2px solid ${accent}` : `1px solid ${divider}`, background: PALETTES[pn].bg, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 8, background: PALETTES[pn].surface, border: `1px solid ${PALETTES[pn].line2}` }} />
                      <span style={{ width: 22, height: 22, borderRadius: 8, background: accent }} />
                    </div>
                    <span style={{ fontSize: FONT_SIZES.small, color: PALETTES[pn].ink, fontWeight: paletteName === pn ? 600 : 500, fontFamily: "var(--cb-font)" }}>{pn}</span>
                  </button>
                ))}
              </div>
              {!(user && user.isPro) && (
                <div style={{ padding: "0 12px 12px", fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)", display: "flex", alignItems: "center", gap: 8 }}>
                  <ProBadge />
                  <span>Members also get four Pro themes and deeper search. <button onClick={onOpenPro} style={{ background: "none", border: "none", padding: 0, color: P.dark ? "#34d399" : "#047857", fontSize: FONT_SIZES.caption, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", textDecoration: "underline" }}>see plans</button></span>
                </div>
              )}
            </Section>

            {/* Wave 3 — the Pro reel lives under Sound & motion with the
                rest of the backdrop controls, not beside the palette. */}
            <Section title="Accent color">
              {/* v7.0 redesign: these were full circles — a row of bright
                  candy-colored dots reads more "pick a crayon" than
                  "configure an instrument." Rounded squares (squircles)
                  read as precision swatches/chips instead, matching the
                  radius scale used on every other control in this panel. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "16px 16px", alignItems: "center" }}>
                {Object.keys(ACCENTS).map((an) => (
                  <button key={an} title={an} aria-label={an} onClick={() => { sfx(); setCustomAccent(""); setAccentName(an); }}
                    style={{ width: 44, height: 44, minHeight: 44, borderRadius: 8, background: ACCENTS[an], border: (!customAccent && accentName === an) ? `2px solid ${P.ink}` : "2px solid transparent", cursor: "pointer", boxShadow: (!customAccent && accentName === an) ? `0 0 0 2px ${ACCENTS[an]}` : "none", transition: "border-color 150ms ease, box-shadow 150ms ease" }} />
                ))}
                <label style={{ width: 44, height: 44, minHeight: 44, borderRadius: 8, border: `2px dashed ${P.faint}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }} title="Custom">
                  <input type="color" value={accent} onChange={(e) => setCustomAccent(e.target.value)} style={{ opacity: 0, width: 0, height: 0, position: "absolute" }} />
                  <span style={{ fontSize: FONT_SIZES.subhead, color: P.faint, lineHeight: 1 }}>+</span>
                </label>
              </div>
            </Section>

            {/* Typography and Vision used to live on a separate
                "Accessibility" tab. The split between "appearance" and
                "accessibility" was ours, not the user's: someone turning
                up contrast is doing the same job as someone picking a
                theme. */}
            <Section title="Typography" footer="All changes apply immediately and persist across sessions.">
              <Row label="Text size" control={
                <Picker value={fontSize} options={[["small", "Small"], ["medium", "Default"], ["large", "Large"], ["xlarge", "Extra Large"]]} onChange={(v) => { sfx(); setFontSize(v); }} ariaLabel="Text size" />
              } />
              <Row label="Dyslexia friendly font" desc="OpenDyslexic, designed for easier reading with dyslexia" control={<Switch on={dyslexicFont} onChange={(v) => { sfx(); if (v) ensureDyslexicFont(); setDyslexicFont(v); }} label="Dyslexic font" />} />
              <Row label="Line spacing" desc="Increases space between lines of text" control={
                <Picker value={lineSpacing} options={[["normal", "Normal"], ["relaxed", "Relaxed"], ["loose", "Loose"]]} onChange={(v) => { sfx(); setLineSpacing(v); }} ariaLabel="Line spacing" />
              } last />
            </Section>

            <Section title="Vision">
              <Row label="High contrast" desc="Maximum contrast between text and background" control={<Switch on={highContrast} onChange={(v) => { sfx(); setHighContrast(v); }} label="High contrast" />} />
              <Row label="Focus indicators" desc="Shows a visible ring around the focused element" control={<Switch on={focusHighlight} onChange={(v) => { sfx(); setFocusHighlight(v); }} label="Focus indicators" />} last />
            </Section>

            <Section title="Layout density" footer="Tighter spacing. Good for long source lists.">
              <Row label="Data density" control={
                <Picker value={dataDensity} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} onChange={(v) => { sfx(); setDataDensity(v); }} ariaLabel="Data density" />
              } last />
            </Section>
          </>)}

          {tab === "privacy" && (<>
            {/* Commit 100 — the privacy controls used to sit on the Account
                tab, directly under the identity they govern. They move here
                because "who can see me" and "where does my data live" are
                one question, and the notifications that touch that data are
                part of the same answer. */}
            <PrivacySettings P={P} accent={accent} at={at} sfx={sfx} Section={Section} Row={Row} Switch={Switch} Picker={Picker} user={user} />

            {/* Commit 67. Cerebrum was raising three kinds of desktop
                notification with no way to turn any of them off short of
                revoking the browser permission for all three — see
                notifyPref/cbNotify. */}
            <Section
              title="Desktop notifications"
              footer={
                notifPerm === "unsupported" ? "This browser doesn't support desktop notifications."
                : notifPerm === "denied" ? "Your browser is blocking notifications for this site. Re-allow them in the padlock menu in the address bar: Cerebrum can't undo that from here."
                : notifPerm === "granted" ? "Cerebrum only notifies you while this tab is in the background. Nothing is sent while you're looking at it."
                : "Cerebrum will ask your browser for permission the first time it has something to tell you."
              }
            >
              <Row
                label="Desktop notifications"
                desc={
                  notifPerm === "granted" ? "Allowed by this browser"
                  : notifPerm === "denied" ? "Blocked by this browser"
                  : notifPerm === "unsupported" ? "Not available here"
                  : "Not yet requested"
                }
                control={
                  notifPerm === "default" ? (
                    <button onClick={() => {
                      sfx();
                      try {
                        Notification.requestPermission().then((perm) => setNotifPerm(perm));
                      } catch { setNotifPerm("unsupported"); }
                    }} style={{ minHeight: 44, padding: "7px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.16), color: accent, border: `1px solid ${withAlpha(accent, 0.35)}`, borderRadius: 9999, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
                      Allow
                    </button>
                  ) : (
                    <span style={{
                      fontSize: FONT_SIZES.micro, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label,
                      padding: "4px 12px", borderRadius: 9999,
                      color: notifPerm === "granted" ? (P.dark ? STATUS.good : "#047857") : P.faint,
                      background: withAlpha(notifPerm === "granted" ? STATUS.good : P.faint, 0.12),
                    }}>{notifPerm === "granted" ? "On" : notifPerm === "denied" ? "Blocked" : "Unavailable"}</span>
                  )
                }
                last
              />
            </Section>

            <Section
              title="What to notify me about"
              footer="These are per-browser, like every other preference here. Turning one off stops the notification only. The call still rings in the app, the message still arrives in your Inbox, and the papers still appear on your watchlist."
            >
              <Row label="Incoming calls" desc="Someone is calling you right now" control={
                <Switch on={notify.call} onChange={(v) => setNotifyKind("call", v)} label="Notify me about incoming calls" />
              } />
              <Row label="Direct messages" desc="A new message in a conversation you're part of" control={
                <Switch on={notify.message} onChange={(v) => setNotifyKind("message", v)} label="Notify me about direct messages" />
              } />
              <Row label="Watched topics" desc="New papers indexed on a topic you're watching" control={
                <Switch on={notify.watch} onChange={(v) => setNotifyKind("watch", v)} label="Notify me about watched topics" />
              } last />
            </Section>

            {notifPerm === "granted" && (
              <Section title="Test" footer="Switch tabs after pressing it. Notifications never fire on the page you're looking at.">
                <Row
                  label="Send a test notification"
                  desc="Confirms notifications actually reach your desktop"
                  onClick={() => {
                    sfx();
                    // No `kind`, so this is never filtered by the toggles
                    // above — a test that silently does nothing because of
                    // a setting is worse than no test.
                    setTimeout(() => cbNotify("Cerebrum", "Notifications are working.", "cb-test"), 2500);
                    toast("Switch away from this tab: the test fires in a few seconds.");
                  }}
                  last
                />
              </Section>
            )}

            {/* E2EE Phase 1.4 — encrypted messaging: recovery phrase, devices,
                backups. Lives on Privacy & data because "who can read my
                messages" is a privacy question. */}
            <EncryptionSettings P={P} accent={accent} at={at} sfx={sfx} Section={Section} Row={Row} />
            {/* Private Vault (zero-knowledge saved work): encrypted saved
                papers, investigations, and collection names. Same tab —
                "who can read my library" is the same privacy question. */}
            <PrivateVaultSettings P={P} accent={accent} sfx={sfx} Section={Section} Row={Row}
              user={user} saved={saved} setSaved={setSaved} history={history} setHistory={setHistory}
              collections={collections} setCollections={setCollections} vaultCtl={vaultCtl} />
          </>)}

          {/* Wave 3 — the contents of this old block were split where they
              belong: Vision and Reading live in the Appearance tab now,
              and Auto-read answers moved to Sound & motion. Nothing was
              removed; the rows are just addressed differently. */}

          {/* Commit 88 — folded into Answers: how an answer is spoken is part
              of what an answer is. */}
          {tab === "sound" && (<>
            <Section title="Sounds">
              <Row label="Sound effects" desc="Click sounds and ambient tones while searching" control={<Switch on={!muted} onChange={(v) => setMuted(!v)} label="Sound effects" />} />
              <Row label="Search ambience" desc="Background tone while a search runs" control={
                <Picker value={soundMode} options={[["pulse", "Pulse"], ["shimmer", "Shimmer"], ["warm", "Warm"], ["minimal", "Minimal"]]} onChange={(v) => { setSoundMode(v); Sfx.preview(v); }} ariaLabel="Search ambience" />
              } last />
            </Section>

            {/* Motion lives here, once — it used to also have a duplicate
                on/off toggle over on the Accessibility tab that read a ref
                (`lastAnimModeRef`) never passed into this component, which
                threw a ReferenceError the instant anyone touched it. One
                control, one place, no crash. */}
            <Section title="Motion" footer="Off quiets every animated surface: backgrounds, the search instrument, video crossfades, entrance effects. Your device's Reduce Motion setting is honored automatically either way.">
              <Row label="Motion" desc="Backgrounds, the search instrument, and entrance effects" control={
                <Picker value={animationMode} options={[["off", "Off"], ["subtle", "Subtle"], ["cinematic", "Full"]]} onChange={setAnimationMode} ariaLabel="Motion" />
              } last={animationMode === "off" && !(user && user.isPro)} />
              {/* 2026-10-05: the members-only footage toggle lived here. The
                  workspace no longer plays film behind it (cinema lives at
                  the door only), so the toggle had nothing to switch. */}
              {/* v6.9: was cookie-persisted and threaded all the way down into
                  LivingBackground already, but had no control anywhere to
                  actually change it from its default — this is the first real
                  UI for it, reusing LocalSlider. Hidden when the background
                  is off entirely, since a speed has nothing to apply to at
                  that point. */}
              {animationMode !== "off" && (
                <div style={{ padding: "12px 0 4px" }}>
                  <LocalSlider label="Animation speed" value={animSpeed} min={0.25} max={2} step={0.25}
                    format={(v) => `${v}×`} onCommit={(v) => { sfx(); setAnimSpeed(v); }} accent={accent} P={P} />
                </div>
              )}
              <Row label="Reduce transparency" desc="Makes panels solid instead of frosted glass" control={<Switch on={reducedTransparency} onChange={(v) => { sfx(); setReducedTransparency(v); }} label="Reduce transparency" />} last />
            </Section>

            <Section title="Auto read" footer="Voice selection is on the Answers tab.">
              <Row label="Auto read answers" desc="Reads new answers aloud automatically" control={<Switch on={autoplay} onChange={(v) => { sfx(); setAutoplay(v); }} label="Auto-read" />} last />
            </Section>
          </>)}

          {/* Continues Privacy & data: history, library, watchlist,
              workspace and the two destructive confirmations. A second
              conditional block under the same tab id is deliberate — it
              keeps each block short enough to read at a glance. */}
          {tab === "privacy" && (<>
            <Section title="History & storage" footer="Kept in this browser. They never leave your device. Queries go to our server to run the search: details in Privacy, above.">
              <Row label="Saved conversations" desc={`${(history || []).length} conversation${(history || []).length === 1 ? "" : "s"} kept`} />
              <Row label="Saved articles" desc={`${saved.length} article${saved.length === 1 ? "" : "s"} saved`} last={(history || []).length === 0} />
              {(history || []).length > 0 && (
                <Row label="Clear conversation history" destructive control={
                  <button onClick={() => { if (window.confirm("Clear your conversation history? This can't be undone.")) { setHistory([]); sfx(); } }} style={{ padding: "6px 16px", minHeight: 44, fontSize: FONT_SIZES.small, color: statusBad(P, paletteName), background: "transparent", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--cb-font)" }}>Clear</button>
                } last />
              )}
            </Section>

            {/* Wave 3 — the old "Storage" section's Clear-all-data row used
                the same inline Delete/Cancel expander pattern as the other
                destructive confirmations. It is a Dialog sheet now. */}
            <Section title="Erase" footer="Clears conversations, saved articles, and search history — in this browser and in your account's synced copy. Preferences, watched topics, collections, documents, and device encryption keys are kept.">
              <Row label="Clear all data" destructive onClick={() => setClearOpen(true)} last />
            </Section>

            {/* Commit 67 — watched topics were manageable only from the
                home screen's deck card, which meant no way to review or
                prune them once the deck stopped showing them all. */}
            {user && (
              <Section title="Watched topics" footer="You'll hear when new papers land. Silence means nothing was published.">
                {wlLoading ? (
                  <Row label="Loading your watchlist…" last />
                ) : watchlist.length === 0 ? (
                  <Row label="You're not watching any topics" desc="Finish an answer and press 'Watch this topic' to start." last />
                ) : (
                  watchlist.map((w, i) => (
                    <Row
                      key={w.id}
                      label={w.topic}
                      desc={
                        w.newCount > 0
                          ? `${w.newCount} new paper${w.newCount === 1 ? "" : "s"} since you looked`
                          : (w.live ? "Nothing new yet" : "Couldn't check just now")
                      }
                      control={
                        <UIButton P={P} variant="ghost" onClick={async () => {
                          sfx();
                          setWatchlist((prev) => prev.filter((x) => x.id !== w.id));
                          try { await apiDataAction("unwatch-topic", { topic: w.topic }); }
                          catch { loadWatchlist(); }
                        }} style={{ minHeight: 44, padding: "5px 12px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 9999, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
                          Unwatch
                        </UIButton>
                      }
                      last={i === watchlist.length - 1}
                    />
                  ))
                )}
              </Section>
            )}

            <Section title="Workspace" footer="Everything, as JSON. Reimport it anywhere. Note: this exports your data decrypted — if Private Vault is on, the file is readable by anyone who gets it.">
              <Row label="Export workspace" desc="Download all your data as JSON" control={
                <button onClick={() => {
                  let ttsVoice = "";
                  try { ttsVoice = localStorage.getItem("cb_tts_voice") || ""; } catch (cbErr) { console.error("[Cerebrum] settings.jsx: ttsVoice = localStorage.getItem('cb_tts_voice') || ''; }:", cbErr); }
                  const workspace = {
                    version: APP_VERSION_LABEL,
                    exported: new Date().toISOString(),
                    saved, history,
                    preferences: { paletteName, accentName, customAccent, answerLength, factCheck: factCheck ? "1" : "0", muted: muted ? "1" : "0", soundMode, citationStyle, animationMode, dataDensity, animSpeed, highContrast: highContrast ? "1" : "0", fontSize, reducedTransparency: reducedTransparency ? "1" : "0", autoplay: autoplay ? "1" : "0", dyslexicFont: dyslexicFont ? "1" : "0", lineSpacing, focusHighlight: focusHighlight ? "1" : "0", typewriter: typewriter ? "1" : "0", notify, ttsVoice },
                  };
                  const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `cerebrum-workspace-${Date.now()}.json`;
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  sfx();
                  toast("Workspace exported.");
                }} style={{ minHeight: 44, padding: "6px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Export JSON</button>
              } />
              <Row label="Import workspace" desc="Restore from a previously exported file" control={
                <label style={{ minHeight: 44, display: "inline-flex", alignItems: "center", padding: "6px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: withAlpha(accent, 0.12), color: accent, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
                  Import
                  <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      // Import replaces the current workspace — confirm before
                      // touching anything, then validate enums so a malformed
                      // file can't silently install garbage preferences.
                      let data;
                      try { data = JSON.parse(reader.result); }
                      catch { toast("Couldn't import that file — it isn't valid workspace JSON.", { tone: "error" }); return; }
                      if (!window.confirm("Replace your current workspace (library, history, preferences) with this file? This can't be undone.")) return;
                      try {
                        if (data.saved && Array.isArray(data.saved)) setSaved(data.saved);
                        if (data.history && Array.isArray(data.history)) setHistory(data.history);
                        // Export writes preferences; restore them too so an
                        // import actually brings the workspace back whole.
                        if (data.preferences && typeof data.preferences === "object") {
                          const p = data.preferences;
                          const inSet = (v, set) => set.includes(v);
                          if (typeof p.paletteName === "string") setPaletteName(p.paletteName);
                          if (typeof p.accentName === "string") setAccentName(p.accentName);
                          if (typeof p.customAccent === "string") setCustomAccent(p.customAccent);
                          if (inSet(p.answerLength, ["short", "medium", "long"])) setAnswerLength(p.answerLength);
                          if (p.factCheck === "1" || p.factCheck === "0") setFactCheck(p.factCheck === "1");
                          if (p.muted === "1" || p.muted === "0") setMuted(p.muted === "1");
                          if (inSet(p.soundMode, ["pulse", "shimmer", "warm", "minimal"])) setSoundMode(p.soundMode);
                          if (inSet(p.citationStyle, ["vancouver", "apa", "mla", "chicago", "bibtex"])) setCitationStyle(p.citationStyle);
                          if (inSet(p.animationMode, ["off", "subtle", "cinematic"])) setAnimationMode(p.animationMode);
                          if (inSet(p.dataDensity, ["comfortable", "compact"])) setDataDensity(p.dataDensity);
                          if (typeof p.animSpeed === "number" && p.animSpeed >= 0.25 && p.animSpeed <= 4) setAnimSpeed(p.animSpeed);
                          if (p.highContrast === "1" || p.highContrast === "0") setHighContrast(p.highContrast === "1");
                          if (inSet(p.fontSize, ["small", "medium", "large", "xlarge"])) setFontSize(p.fontSize);
                          if (p.reducedTransparency === "1" || p.reducedTransparency === "0") setReducedTransparency(p.reducedTransparency === "1");
                          if (p.autoplay === "1" || p.autoplay === "0") setAutoplay(p.autoplay === "1");
                          if (p.dyslexicFont === "1" || p.dyslexicFont === "0") setDyslexicFont(p.dyslexicFont === "1");
                          if (inSet(p.lineSpacing, ["normal", "relaxed", "loose"])) setLineSpacing(p.lineSpacing);
                          if (p.focusHighlight === "1" || p.focusHighlight === "0") setFocusHighlight(p.focusHighlight === "1");
                          if (p.typewriter === "1" || p.typewriter === "0") setTypewriter(p.typewriter === "1");
                          if (p.notify && typeof p.notify === "object") { const n = { call: true, message: true, watch: true }; for (const k of ["call", "message", "watch"]) if (typeof p.notify[k] === "boolean") n[k] = p.notify[k]; setNotify(n); setNotifyPref(n); }
                          if (typeof p.ttsVoice === "string" && p.ttsVoice) { try { localStorage.setItem("cb_tts_voice", p.ttsVoice); } catch (cbErr) { console.error("[Cerebrum] settings.jsx if: localStorage.setItem('cb_tts_voice', p.ttsVoice); }:", cbErr); } }
                        }
                        sfx();
                        toast("Workspace imported.");
                      } catch {
                        toast("Couldn't import that file — it isn't valid workspace JSON.", { tone: "error" });
                      }
                    };
                    reader.readAsText(file);
                  }} />
                </label>
              } last />
            </Section>

            {/* Commit 67 — there was no way back. Every control on the
                Appearance and Sound & motion tabs writes a cookie, and a
                person who changed eight of them experimenting had to
                remember and reverse each one by hand. */}
            <Section title="Preferences" footer="Preferences only. Your library and history are untouched.">
              <Row label="Reset all settings" desc="Puts every preference back to its default" onClick={() => setResetOpen(true)} last />
            </Section>
          </>)}

          {/* Wave 3 — diagnostics and credits are no longer filed next to
              library management. About is where you look when something
              feels wrong or you want to know what you're running. */}
          {tab === "about" && (<>
            <Section title="Keyboard shortcuts">
              <div style={{ padding: "4px 0" }}>
                {[[kbdLabel("K"), "Search"], [kbdLabel("J"), "New investigation"], [kbdLabel("B"), "Saved articles"], [kbdLabel("/"), "Settings"], [kbdLabel("D"), "Toggle light / dark"], ["Esc", "Back to search"]].map(([key, desc], i, arr) => (
                  <div key={desc} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${divider}` : "none" }}>
                    <span style={{ fontSize: FONT_SIZES.body, color: P.ink, fontWeight: 500, fontFamily: "var(--cb-font)" }}>{desc}</span>
                    <kbd style={{ fontSize: FONT_SIZES.small, fontFamily: "var(--cb-font)", color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "3px 8px", borderRadius: 8, fontWeight: 500 }}>{key}</kbd>
                  </div>
                ))}
              </div>
            </Section>

            {/* Commit 59 — surfaced here rather than hidden behind a
                developer flag: on this project a feature can be fully built
                and still appear broken because one backend file didn't make
                it into the repo, and until now the only symptom was silence. */}
            <Section title="System status">
              <SystemStatus P={P} accent={accent} />
            </Section>

            {/* Commit 91 — presence of every environment variable the app
                reads, in one place. Founder-only. */}
            <Section title="Configuration" footer="Which environment variables Cloudflare is actually serving. Values are never shown, only whether one is present.">
              <ConfigStatus P={P} accent={accent} />
            </Section>

            <Section title="About">
              <Row label="Version" control={<span style={{ fontSize: FONT_SIZES.body, color: P.faint, fontFamily: "var(--cb-font)" }}>{APP_VERSION_LABEL}</span>} />
              <Row label="Built by" control={<span style={{ fontSize: FONT_SIZES.body, color: accent, fontWeight: 500 }}>Vaticay</span>} last />
            </Section>
          </>)}
        </div>
        </div>
      </div>

      {/* Wave 3 — the destructive confirmations. Sheets on mobile, small
          dialogs on desktop, via the Dialog primitive (focus trap, Escape,
          scroll lock). Each restates exactly what will happen and what
          will not, and each has one primary action. */}
      {clearOpen && (
        <Dialog label="Clear all data" onClose={() => setClearOpen(false)} zIndex={240}>
          <p style={{ fontSize: FONT_SIZES.body, fontWeight: 450, color: P.ink, lineHeight: 1.6, margin: "0 0 8px", fontFamily: "var(--cb-font)" }}>
            Clear your conversations, saved articles, and search history — in this browser and in your account's synced copy.
          </p>
          <p style={{ fontSize: FONT_SIZES.small, fontWeight: 450, color: P.faint, lineHeight: 1.6, margin: 0, fontFamily: "var(--cb-font)" }}>
            Preferences, watched topics, collections, documents, and this device's encryption keys are kept. This can't be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20, flexWrap: "wrap" }}>
            <UIButton P={P} variant="ghost" onClick={() => setClearOpen(false)} style={{ padding: "12px 16px", minHeight: 44, fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Keep my data</UIButton>
            <UIButton P={P} variant="ghost" onClick={() => { setSessions([]); setSaved([]); setHistory([]); setClearOpen(false); sfx(); }} style={{ padding: "12px 16px", minHeight: 44, fontSize: FONT_SIZES.small, fontWeight: 700, background: "#d13438", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Clear everything</UIButton>
          </div>
        </Dialog>
      )}
      {resetOpen && (
        <Dialog label="Reset all settings" onClose={() => setResetOpen(false)} zIndex={240}>
          <p style={{ fontSize: FONT_SIZES.body, fontWeight: 450, color: P.ink, lineHeight: 1.6, margin: "0 0 8px", fontFamily: "var(--cb-font)" }}>
            Put every preference back to its default — theme, accent, sounds, motion, answer style, notifications, everything on the Appearance, Sound & motion, and Answers tabs.
          </p>
          <p style={{ fontSize: FONT_SIZES.small, fontWeight: 450, color: P.faint, lineHeight: 1.6, margin: 0, fontFamily: "var(--cb-font)" }}>
            Your library, history and watchlist are untouched.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20, flexWrap: "wrap" }}>
            <UIButton P={P} variant="ghost" onClick={() => setResetOpen(false)} style={{ padding: "12px 16px", minHeight: 44, fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Cancel</UIButton>
            <button onClick={() => { resetAllSettings(); setResetOpen(false); }} style={{ padding: "12px 16px", minHeight: 44, fontSize: FONT_SIZES.small, fontWeight: 700, background: accent, color: at, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Reset settings</button>
          </div>
        </Dialog>
      )}
      {deleteOpen && (
        <Dialog label="Delete account" onClose={() => setDeleteOpen(false)} zIndex={240}>
          <p style={{ fontSize: FONT_SIZES.body, fontWeight: 450, color: P.ink, lineHeight: 1.6, margin: "0 0 8px", fontFamily: "var(--cb-font)" }}>
            Permanently delete your account and all its data — email, library, history, everything on our servers.
          </p>
          <p style={{ fontSize: FONT_SIZES.small, fontWeight: 450, color: P.faint, lineHeight: 1.6, margin: 0, fontFamily: "var(--cb-font)" }}>
            Immediately, and for good. If you have an active subscription,{" "}
            <button onClick={async () => { try { const r = await apiProPost("create-portal", {}); window.location.href = r.url; } catch { toast("Couldn't open billing. Try again?", { tone: "error" }); } }} style={{ background: "none", border: "none", padding: 0, color: accent, cursor: "pointer", fontSize: "inherit", fontWeight: 600, fontFamily: "var(--cb-font)", textDecoration: "underline" }}>cancel it in the billing portal</button>{" "}
            first. Deletion doesn't stop billing.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20, flexWrap: "wrap" }}>
            <UIButton P={P} variant="ghost" onClick={() => setDeleteOpen(false)} style={{ padding: "12px 16px", minHeight: 44, fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Keep my account</UIButton>
            <button onClick={async () => { await submitDeleteAccount(); }} disabled={delBusy} style={{ padding: "12px 16px", minHeight: 44, fontSize: FONT_SIZES.small, fontWeight: 700, background: "#d13438", color: "#fff", border: "none", borderRadius: 8, cursor: delBusy ? "default" : "pointer", fontFamily: "var(--cb-font)", opacity: delBusy ? 0.6 : 1 }}>{delBusy ? "Deleting…" : "Delete my account"}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
export { SettingsView };
