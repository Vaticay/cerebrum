/**
 * inbox.jsx — Inbox / messaging UI.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * InboxView: DM thread list + active thread view (E2EE, voice notes, attachments).
 * ReportConductModal: shared by InboxView and VideoHuddle (exported).
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { apiDataAction, toast, REPORT_REASONS, apiDataGet, cbNotify, cbBlip, avatarSkin, relativeTime, statusBad } from "./appUtils.js";
import { withAlpha, STATUS, FONT_SIZES, RADIUS, TRACKING, TYPE, Z, Icon, UIButton } from "./designSystem.jsx";
import { ensureE2EEDevice, decryptThreadMessages, getSafetyNumber, getRecoveryPhrase, isPeerEncryptionReady, upgradeThread, markSafetyNumberVerified, clearSafetyNumberVerified, encryptMessage } from "./e2ee/messaging.js";
import { safeHref } from "./textUtils.js";
import { Dialog, ModalChrome } from "./flowcharts.jsx";

function ReportConductModal({ P, accent, at, kind, targetLabel, threadId, reportedUserId, messageId, onClose }) {
  const [reason, setReason] = useState("harassment");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // The success auto-close timer must not fire after a manual close —
  // otherwise onClose runs twice.
  const closeTimerRef = useRef(null);
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const title = kind === "message" ? "Report message" : kind === "call" ? "Report this call" : `Report ${targetLabel || "this person"}`;

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiDataAction("file-report", {
        kind, reason, note: note.trim(),
        reported_user_id: reportedUserId || null,
        thread_id: threadId || null,
        message_id: messageId || null,
      });
      setSubmitted(true);
      closeTimerRef.current = setTimeout(() => { closeTimerRef.current = null; onClose(); }, 1600);
    } catch (err) {
      toast(err.message || "Couldn't send that report.", { tone: "error" });
      setSubmitting(false);
    }
  };

  return (
    <Dialog label={title} onClose={onClose} zIndex={310} width={420}
      panelStyle={{
        background: P.dark ? "rgba(15, 17, 26, 0.96)" : "rgba(255, 255, 255, 0.98)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${P.line}`,
        borderRadius: 8, padding: "26px", outline: "none", fontFamily: "var(--cb-font)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}
    >
        {submitted ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: withAlpha(STATUS.good, 0.12), color: STATUS.good, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <Icon name="check" size={18} />
            </div>
            <div style={{ fontSize: FONT_SIZES.body, fontWeight: 600, color: P.ink }}>Report received</div>
            <div style={{ fontSize: FONT_SIZES.small, color: P.ink2, marginTop: 6 }}>Thanks for flagging this.</div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, letterSpacing: TYPE.heading.letterSpacing, color: P.ink, fontFamily: "var(--cb-font)" }}>{title}</div>
              <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 13, display: "inline-flex" }}><Icon name="close" size={18} /></button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, marginBottom: 8 }}>Reason</div>
              <div role="radiogroup" aria-label="Report reason" style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {REPORT_REASONS.map((r) => (
                  <UIButton P={P} variant="ghost" key={r.id} type="button" role="radio" aria-checked={reason === r.id} onClick={() => setReason(r.id)} style={{ minHeight: 44,
                    fontSize: FONT_SIZES.caption, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                    fontFamily: "var(--cb-font)", fontWeight: 600, transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                    background: reason === r.id ? withAlpha(accent, 0.16) : "transparent",
                    color: reason === r.id ? accent : P.ink2,
                    border: `1px solid ${reason === r.id ? withAlpha(accent, 0.3) : P.line}`,
                  }}>{r.label}</UIButton>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink2, marginBottom: 6 }}>Anything else? (optional)</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} aria-label="Add context for the review team (optional)" placeholder="Add context for the review team" style={{
                width: "100%", padding: "11px 13px", fontSize: FONT_SIZES.body, borderRadius: 8,
                border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff",
                color: P.ink, fontFamily: "var(--cb-font)", resize: "vertical", outline: "none",
              }} />
            </div>
            <button type="submit" disabled={submitting} style={{
              width: "100%", padding: "12px", fontSize: FONT_SIZES.body, fontWeight: 600,
              background: accent, color: at, border: "none", borderRadius: 8,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
              fontFamily: "var(--cb-font)",
            }}>{submitting ? "Sending…" : "Submit report"}</button>
          </form>
        )}
    </Dialog>
  );
}

function InboxView({ P, accent, at, isMobile, threads, setThreads, initialThreadId, onConsumeInitialThread, onStartHuddle, activeHuddleRoomSeed, onCompose }) {
  const [activeId, setActiveId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  // E2EE Phase 1.4 — legacy divider index, memoized. The old code ran
  // messages.slice(0, i).some(...) per message — O(n²) on long threads.
  // One pass finds the first cipher message with plaintext history before
  // it; the divider renders only there.
  const legacyDividerIdx = useMemo(() => {
    const msgs = (activeThread && activeThread.messages) || [];
    let sawPlaintext = false;
    for (let i = 0; i < msgs.length; i++) {
      const x = msgs[i];
      const isCipher = x.msgKind === "cipher";
      const skipped = x.e2ee && x.e2ee.skipped;
      if (!isCipher && !skipped) sawPlaintext = true;
      else if (isCipher && sawPlaintext) return i;
    }
    return -1;
  }, [activeThread && activeThread.messages]);
  // Message ids already blipped/notified for: the setActiveThread updater
  // below can run twice under StrictMode, so notification side effects
  // there must be idempotent.
  const notifiedMsgIds = useRef(new Set());
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Commit 47: search-as-you-type filter over the already-loaded thread
  // list — no API round trip, this app has a handful of conversations per
  // person at most (same reasoning as the inbox N+1 query comment below),
  // so filtering client-side is both simpler and instant.
  const [threadQuery, setThreadQuery] = useState("");
  // Commit 48: block/report — a small overflow menu on the open thread's
  // header (Block/Unblock, Report this person), plus per-message hover
  // report actions. `reportModal` carries the target: { kind, messageId? } —
  // `kind: "user"` reports activeThread.otherId, `kind: "message"` also
  // carries which message.
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [reportModal, setReportModal] = useState(null);
  const [hoverMsgId, setHoverMsgId] = useState(null);
  // Group creation — name input, people search with multi-select, create.
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupResults, setGroupResults] = useState([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupCreating, setGroupCreating] = useState(false);
  // Group info panel — roster, add/remove people, rename, leave. The Add
  // people search reuses the same search-users endpoint as creation.
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [settingsResults, setSettingsResults] = useState([]);
  const [settingsSearching, setSettingsSearching] = useState(false);
  // settingsBusy: "" | "add" | "rename" | "leave" | "remove:<memberId>"
  const [settingsBusy, setSettingsBusy] = useState("");
  // E2EE Phase 1.4 — per-thread encryption UI. `upgradeInfo` is null when
  // the banner doesn't apply, { checking } while probing, or
  // { ready } once we know whether the peer can upgrade. `safetyChanged`
  // is the loud banner when a verified number stops matching.
  // `safetyModal` is null | { loading } | the getSafetyNumber() result.
  const [upgradeInfo, setUpgradeInfo] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  const [safetyChanged, setSafetyChanged] = useState(false);
  const [safetyModal, setSafetyModal] = useState(null);
  const [safetyBusy, setSafetyBusy] = useState("");
  // Commit 56 — attachments. `attachBusy` covers both the compression pass
  // and the upload, so the composer can't fire twice on a slow phone.
  const msgPaneRef = useRef(null);
  const imageInputRef = useRef(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recRef = useRef(null);
  const recSecondsRef = useRef(0);
  const [lightbox, setLightbox] = useState(null);
  // If the user leaves the inbox mid-recording, InboxView unmounts and the
  // mic would stay open with no UI to stop it. Clean up on unmount.
  useEffect(() => () => { try { stopRecording(); } catch (cbErr) { console.error("[Cerebrum] inbox.jsx: stopRecording(); }:", cbErr); } }, []);

  // Downscales to fit inside 1400px and re-encodes as JPEG before upload.
  // A phone photo is several MB; a message row in D1 has roughly 1MB to
  // work with, so compressing here is what makes image messages possible at
  // all rather than a nice-to-have. 1400px is chosen to keep a figure or a
  // plot legible when opened full-screen — this is a science tool, and an
  // unreadable figure is a failed message.
  async function compressImageFile(file) {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file."));
      r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el); el.onerror = () => rej(new Error("That doesn't look like an image."));
      el.src = dataUrl;
    });
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    // Step the quality down until it fits the server's cap rather than
    // sending something that will be refused — a person who picked a photo
    // should get the photo sent, not an error telling them to go resize it.
    for (const q of [0.82, 0.7, 0.58, 0.45, 0.34]) {
      const out = canvas.toDataURL("image/jpeg", q);
      if (out.length < 650000) return out;
    }
    throw new Error("That image is too detailed to send: try a smaller crop.");
  }

  async function handleImagePick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !activeId) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file.", { tone: "error" }); return; }
    setAttachBusy(true);
    try {
      const data = await compressImageFile(file);
      await sendMessage({ kind: "image", data, title: file.name.slice(0, 120) });
    } catch (err) {
      toast(err.message || "Couldn't attach that image.", { tone: "error" });
    } finally { setAttachBusy(false); }
  }

  // Voice notes record audio AND run speech recognition over the same take,
  // so the message arrives with a transcript attached. That is the whole
  // reason voice notes belong in a research tool rather than being a chat
  // gimmick: a transcript is skimmable, searchable, quotable and readable by
  // someone who can't play audio right now, while the recording keeps the
  // tone and emphasis a transcript loses.
  async function startRecording() {
    // Guard on the ref, not the `recording` state: state hasn't updated
    // yet on a rapid double-click, which used to leak a second
    // MediaRecorder. The placeholder reserves the slot synchronously
    // across the getUserMedia await.
    if (recording || recRef.current || !activeId) return;
    recRef.current = { starting: true, cancelled: false };
    // Show the stop UI immediately: the getUserMedia permission prompt can
    // sit for seconds, and until `recording` flips the toggle button keeps
    // calling startRecording (a no-op) instead of stop — the "can't stop
    // it" bug.
    setRecording(true);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { recRef.current = null; setRecording(false); toast("Microphone access is needed for a voice note.", { tone: "error" }); return; }
    // The user hit stop while the permission prompt was up: do not start
    // a recorder they already cancelled.
    if (!recRef.current || recRef.current.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      recRef.current = null;
      setRecording(false);
      setRecSeconds(0);
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => {
      try { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); } catch { return false; }
    });
    if (!mime) { recRef.current = null; stream.getTracks().forEach((t) => t.stop()); toast("Voice notes aren't supported in this browser.", { tone: "error" }); return; }
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    let transcript = "";
    let sr = null;
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        sr = new SR(); sr.continuous = true; sr.interimResults = false; sr.lang = navigator.language || "en-US";
        sr.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) transcript += ev.results[i][0].transcript; };
        sr.onerror = () => {};
        sr.start();
      }
    } catch (cbErr) { console.error("[Cerebrum] inbox.jsx if: const SR = window.SpeechRecognition || window.webkitSpeechRecognition;:", cbErr); }
    const startedAt = Date.now();
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try { sr && sr.stop(); } catch (cbErr) { console.error("[Cerebrum] inbox.jsx if: sr && sr.stop(); }:", cbErr); }
      const durationMs = Date.now() - startedAt;
      if (durationMs < 700) return; // a mis-tap, not a message
      const blob = new Blob(chunks, { type: mime });
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      if (data.length > 650000) { toast("That voice note is too long to send: try a shorter one.", { tone: "error" }); return; }
      setAttachBusy(true);
      try {
        await sendMessage({ kind: "audio", data, title: "Voice note", meta: { durationMs, transcript: transcript.trim().slice(0, 2000) } });
      } catch (err) { toast(err.message || "Couldn't send that voice note.", { tone: "error" }); }
      finally { setAttachBusy(false); }
    };
    // 90 seconds is the hard ceiling the D1 row size implies at this
    // bitrate; stopping automatically is friendlier than letting someone
    // record for three minutes and then telling them it can't be sent.
    // The count lives in a ref: calling stopRecording() inside the state
    // updater below was a side effect in the updater and double-fired
    // under StrictMode.
    recSecondsRef.current = 0;
    recRef.current = { rec, stream, timer: setInterval(() => {
      recSecondsRef.current += 1;
      const nv = recSecondsRef.current;
      setRecSeconds(nv);
      if (nv >= 90) stopRecording();
    }, 1000) };
    rec.start();
    setRecSeconds(0);
  }

  function stopRecording() {
    const cur = recRef.current;
    if (!cur) return;
    // Stopping during the getUserMedia permission prompt: mark cancelled
    // so the resolver above abandons startup instead of starting a
    // recorder the user already dismissed.
    if (cur.starting) { cur.cancelled = true; }
    clearInterval(cur.timer);
    try { cur.rec.stop(); } catch {
      // If stop() throws (e.g. iOS InvalidStateError), onstop never fires
      // and the mic tracks would leak — stop them directly.
      try { cur.stream && cur.stream.getTracks().forEach((t) => t.stop()); } catch (cbErr) { console.error("[Cerebrum] inbox.jsx if: cur.stream && cur.stream.getTracks().forEach((t) => t.stop()); }:", cbErr); }
    }
    recRef.current = null;
    recSecondsRef.current = 0;
    setRecording(false);
    setRecSeconds(0);
  }

  // Refreshed every time this view mounts (navigating here from the
  // Sidebar), in case something arrived since the last visit — plus light
  // polling every 15s so new threads and new messages in other threads
  // show up in the list without navigating away and back. 15s (not the
  // thread view's 5s) because this is list metadata, not a live
  // conversation; it also keeps the Sidebar unread badge honest.
  useEffect(() => {
    let cancelled = false;
    // Last-seen message id per thread, so a background tab can notify on
    // new arrivals. Seeded on the first poll, never notified for.
    const lastSeenIds = new Map();
    let seeded = false;
    const refresh = () => {
      apiDataGet("inbox").then((data) => {
        if (cancelled || !data?.items) return;
        // Background-tab notifications: a message that lands in a thread
        // you're not looking at should reach you even when this tab is
        // hidden. The open-thread poll covers the active conversation;
        // this covers everything else. cbNotify itself refuses to fire
        // while the tab is visible, and notifiedMsgIds dedupes against the
        // open-thread path.
        if (seeded) {
          for (const t of data.items) {
            const lm = t.lastMessage;
            const lid = lm && (lm.id || (lm.senderId + ":" + lm.createdAt));
            if (!lid || lm.mine) { if (lid) lastSeenIds.set(t.id, lid); continue; }
            if (lastSeenIds.get(t.id) && lastSeenIds.get(t.id) !== lid && !notifiedMsgIds.current.has(lid)) {
              notifiedMsgIds.current.add(lid);
              cbNotify(t.name || "Cerebrum", "New message.", "cb-inbox-" + t.id, "message");
            }
            lastSeenIds.set(t.id, lid);
          }
        } else {
          for (const t of data.items) {
            const lm = t.lastMessage;
            const lid = lm && (lm.id || (lm.senderId + ":" + lm.createdAt));
            if (lid) lastSeenIds.set(t.id, lid);
          }
          seeded = true;
        }
        setThreads(data.items);
      });
    };
    refresh();
    const pollId = setInterval(refresh, 15000);
    return () => { cancelled = true; clearInterval(pollId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group creation — debounced people search, reusing the same
  // search-users endpoint as Find People (2+ chars, excludes blocked).
  useEffect(() => {
    const q = groupQuery.trim();
    if (!groupModalOpen || q.length < 2) { setGroupResults([]); setGroupSearching(false); return; }
    setGroupSearching(true);
    const t = setTimeout(() => {
      apiDataGet("search-users", { q }).then((d) => {
        const items = (d && d.items) || [];
        // Don't show people already added.
        setGroupResults(items.filter((r) => !groupMembers.some((m) => m.id === r.id)));
        setGroupSearching(false);
      }).catch(() => setGroupSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [groupQuery, groupModalOpen, groupMembers]);

  // Group info panel — debounced people search, same endpoint and 2-char
  // floor as creation. Filters out people already in the group so a tap is
  // always a real add.
  useEffect(() => {
    const q = settingsQuery.trim();
    if (!groupInfoOpen || q.length < 2) { setSettingsResults([]); setSettingsSearching(false); return; }
    setSettingsSearching(true);
    const t = setTimeout(() => {
      apiDataGet("search-users", { q }).then((d) => {
        const items = (d && d.items) || [];
        const memberIds = new Set((activeThread?.members || []).map((m) => m.id));
        setSettingsResults(items.filter((r) => !memberIds.has(r.id)));
        setSettingsSearching(false);
      }).catch(() => setSettingsSearching(false));
    }, 250);
    return () => clearTimeout(t);
    // activeThread.members changes as people are added/removed — refilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery, groupInfoOpen, activeThread?.members]);

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name || groupMembers.length < 2 || groupCreating) return;
    setGroupCreating(true);
    try {
      const res = await apiDataAction("start-group-thread", {
        name,
        member_ids: groupMembers.map((m) => m.id),
      });
      // Seed the new thread into the list and open it immediately.
      const newThread = {
        id: res.thread_id, kind: "group", name: res.name || name,
        otherId: null, unread: false, encrypted: false,
        lastMessage: null,
      };
      setThreads((prev) => [newThread, ...prev.filter((t) => t.id !== res.thread_id)]);
      setActiveId(res.thread_id);
      setGroupModalOpen(false);
      setGroupName(""); setGroupQuery(""); setGroupResults([]); setGroupMembers([]);
      toast(`Group "${name}" created.`);
    } catch (e) {
      toast(e.message || "Couldn't create that group.", { tone: "error" });
    } finally {
      setGroupCreating(false);
    }
  };

  // Group member management. Every action below re-checks the membership
  // guard server-side; these handlers just keep the list, header, and
  // subtitle in sync after the server confirms.
  const openGroupInfo = () => {
    if (activeThread?.kind !== "group") return;
    setSettingsName(activeThread.name || "");
    setSettingsQuery("");
    setSettingsResults([]);
    setGroupInfoOpen(true);
  };

  // Re-pull the open thread after roster edits. Groups never carry
  // ciphertext (plaintext-only, no multiparty E2EE), so the thread object
  // can go straight into state without the decrypt pipeline.
  const refreshGroupThread = async () => {
    try {
      const data = await apiDataGet("thread", { thread_id: activeId });
      if (data && !data.error && data.id === activeId) setActiveThread(data);
    } catch {
      // Keep the stale roster rather than blanking the thread.
    }
  };

  const addGroupMembers = async (ids) => {
    if (!activeId || settingsBusy || !ids.length) return;
    setSettingsBusy("add");
    try {
      await apiDataAction("add-group-members", { thread_id: activeId, member_ids: ids });
      await refreshGroupThread();
      setSettingsQuery("");
      toast(ids.length === 1 ? "Added to the group." : `${ids.length} people added.`);
    } catch (e) {
      toast(e.message || "Couldn't add them to the group.", { tone: "error" });
    } finally {
      setSettingsBusy("");
    }
  };

  const removeGroupMember = async (member) => {
    if (!activeId || settingsBusy) return;
    setSettingsBusy("remove:" + member.id);
    try {
      await apiDataAction("remove-group-member", { thread_id: activeId, member_id: member.id });
      await refreshGroupThread();
      toast(`Removed ${member.name || member.username || "them"} from the group.`);
    } catch (e) {
      toast(e.message || "Couldn't remove them.", { tone: "error" });
    } finally {
      setSettingsBusy("");
    }
  };

  const leaveGroup = async () => {
    if (!activeId || settingsBusy) return;
    setSettingsBusy("leave");
    try {
      // No member_id: the server removes the caller (see remove-group-member).
      await apiDataAction("remove-group-member", { thread_id: activeId });
      setGroupInfoOpen(false);
      setThreads((prev) => prev.filter((t) => t.id !== activeId));
      setActiveId(null);
      toast("You left the group.");
    } catch (e) {
      toast(e.message || "Couldn't leave the group.", { tone: "error" });
    } finally {
      setSettingsBusy("");
    }
  };

  const renameGroup = async () => {
    const name = settingsName.trim().slice(0, 80);
    if (!activeId || !name || settingsBusy || name === activeThread?.name) return;
    setSettingsBusy("rename");
    try {
      await apiDataAction("rename-group", { thread_id: activeId, name });
      setActiveThread((t) => (t ? { ...t, name } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, name } : t)));
      toast("Group renamed.");
    } catch (e) {
      toast(e.message || "Couldn't rename the group.", { tone: "error" });
    } finally {
      setSettingsBusy("");
    }
  };

  // A thread just created by "Message" in Find People / an institution hub
  // arrives here as initialThreadId — seeded once, then immediately
  // reported back as consumed so App can clear it. Without that hand-back,
  // the same stale thread id would win this race again next visit,
  // silently overriding "default to my most recent conversation" below.
  useEffect(() => {
    if (initialThreadId) {
      setActiveId(initialThreadId);
      onConsumeInitialThread && onConsumeInitialThread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThreadId]);

  /* Auto-open the first conversation on desktop only.
     On a phone the two panes are one at a time — list, or thread with a
     back arrow — and this effect selected a thread the instant the view
     mounted, so the list was replaced before it could ever be seen. The
     Inbox looked like an app that had exactly one conversation in it and
     no way to reach the others. A phone opens on the list, which is what
     every messaging app does. */
  useEffect(() => {
    if (isMobile) return;
    if (!activeId && !initialThreadId && threads.length > 0) setActiveId(threads[0].id);
  }, [threads, activeId, initialThreadId, isMobile]);

  useEffect(() => {
    setDraft("");
    if (!activeId) { setActiveThread(null); return; }
    let cancelled = false;
    setLoadingThread(true);
    const refresh = (isFirst) => {
      apiDataGet("thread", { thread_id: activeId }).then(async (data) => {
        if (cancelled) return;
        if (isFirst) setLoadingThread(false);
        let thread = data && !data.error ? data : null;
        // E2EE Phase 1.3 — encrypted threads are decrypted client-side
        // before they reach state. Ciphertext never renders: rows become
        // plaintext, honest per-message errors, or silent skips for rows
        // addressed to this user's other devices.
        if (thread && thread.encrypted) {
          try {
            const { deviceId } = await ensureE2EEDevice(apiDataAction);
            if (cancelled) return;
            thread = {
              ...thread,
              messages: await decryptThreadMessages({
                messages: thread.messages,
                myDeviceId: deviceId,
                peerUserId: thread.otherId,
              }),
            };
          } catch (err) {
            // The crypto pipeline itself is unavailable (WASM blocked,
            // storage gone, publish failing). Mark every cipher row as
            // failed instead of showing a blank thread — and don't cache
            // the failure, so the next poll retries instead of giving up.
            if (cancelled) return;
            thread = {
              ...thread,
              messages: (thread.messages || []).map((m) =>
                m.msgKind === "cipher"
                  ? { ...m, e2ee: { ok: false, error: "Encrypted messaging isn't available on this device right now." } }
                  : m
              ),
            };
          }
        }
        // A message that arrives while you're on another tab should reach
        // you the same way any other app's would.
        setActiveThread((prevThread) => {
          const next = thread;
          try {
            const prevMsgs = (prevThread && prevThread.messages) || [];
            const nextMsgs = (next && next.messages) || [];
            if (prevThread && nextMsgs.length > prevMsgs.length) {
              const fresh = nextMsgs[nextMsgs.length - 1];
              // The updater can run twice under StrictMode: dedupe by
              // message id so the blip/notification never double-fires.
              const fid = fresh && (fresh.id || fresh.clientId);
              if (fresh && !fresh.mine && fid && !notifiedMsgIds.current.has(fid)) {
                notifiedMsgIds.current.add(fid);
                if (notifiedMsgIds.current.size > 200) notifiedMsgIds.current.delete(notifiedMsgIds.current.values().next().value);
                cbBlip(660, 0.07, 0.045);
                // Encrypted threads never put content in a notification:
                // the envelope is ciphertext and the plaintext belongs on
                // Generic notifications for every thread: never message content
                // in the OS tray — a shared screen or a locked phone should
                // not read your conversations.
                const body = "New message.";
                cbNotify(fresh.who || next.name || "New message", body, "cb-msg-" + activeId, "message");
              }
            }
          } catch (cbErr) { console.error("[Cerebrum] inbox.jsx:", cbErr); }
          return next;
        });
        // The backend marks this thread read as part of that same GET (see
        // the "thread" resource handler in functions/api/data.js) — mirror it
        // here optimistically so the list's bold/dot treatment and the
        // Sidebar's unread-count badge clear immediately instead of waiting
        // for this view's next full inbox refetch.
        if (data && !data.error) {
          setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, unread: false } : t)));
        }
      });
    };
    refresh(true);
    // Commit 51 — light polling while a thread stays open. Two real gaps
    // needed this, not just read receipts: without it, a message the other
    // person sends while you're already looking at this conversation never
    // shows up until you leave and come back (the fetch above used to run
    // once per activeId and never again), and "Seen" below would only ever
    // catch up the same way. Every poll also re-marks-as-read, which is the
    // right behavior, not a side effect to work around — staying on an open
    // thread should keep counting as "still reading it."
    const pollId = setInterval(() => refresh(false), 5000);
    return () => { cancelled = true; clearInterval(pollId); };
  }, [activeId]);

  // E2EE Phase 1.4 — per-thread encryption UI state. Runs when the open
  // thread's identity/encryption changes (not on every poll: the deps are
  // primitives, so message traffic doesn't retrigger the probes).
  const threadPeerId = activeThread?.otherId;
  const threadIsEncrypted = !!activeThread?.encrypted;
  const threadKind = activeThread?.kind;
  useEffect(() => {
    let cancelled = false;
    setUpgradeInfo(null);
    setSafetyChanged(false);
    if (threadKind !== "dm" || !threadPeerId) return;
    if (threadIsEncrypted) {
      // Encrypted DM: does the live number still match what was verified?
      getSafetyNumber(apiDataAction, threadPeerId)
        .then((s) => { if (!cancelled) setSafetyChanged(!!s.changed); })
        .catch(() => {});
      return;
    }
    // Plaintext DM: is an upgrade on the table? Only when THIS device is
    // set up — otherwise Settings is the entry point, not a banner here.
    setUpgradeInfo({ checking: true });
    (async () => {
      try {
        const mine = await getRecoveryPhrase().catch(() => null);
        if (cancelled) return;
        if (!mine) { setUpgradeInfo(null); return; }
        const ready = await isPeerEncryptionReady(apiDataAction, threadPeerId).catch(() => false);
        if (!cancelled) setUpgradeInfo({ checking: false, ready: !!ready });
      } catch {
        if (!cancelled) setUpgradeInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId, threadKind, threadPeerId, threadIsEncrypted]);

  const doUpgradeThread = async () => {
    if (upgrading || !activeId) return;
    setUpgrading(true);
    try {
      await upgradeThread(apiDataAction, activeId);
      toast("Encrypted messaging is on for this conversation.");
      // Optimistic: the 5s poll would catch up, but the badge and banner
      // should flip now.
      setActiveThread((t) => (t ? { ...t, encrypted: true } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, encrypted: true } : t)));
      setUpgradeInfo(null);
    } catch (e) {
      toast(e.message || "Couldn't turn on encrypted messaging.", { tone: "error" });
    } finally {
      setUpgrading(false);
    }
  };

  const openSafetyModal = async () => {
    if (!threadPeerId) return;
    setMenuOpen(false);
    setSafetyModal({ loading: true });
    try {
      const s = await getSafetyNumber(apiDataAction, threadPeerId);
      setSafetyModal({ loading: false, ...s });
    } catch (e) {
      setSafetyModal(null);
      toast(e.message || "Couldn't load the security numbers.", { tone: "error" });
    }
  };

  const doMarkSafetyVerified = async () => {
    if (safetyBusy || !threadPeerId) return;
    setSafetyBusy("verify");
    try {
      await markSafetyNumberVerified(apiDataAction, threadPeerId);
      const s = await getSafetyNumber(apiDataAction, threadPeerId);
      setSafetyModal({ loading: false, ...s });
      setSafetyChanged(false);
      toast("Marked as verified.");
    } catch (e) {
      toast(e.message || "Couldn't save that.", { tone: "error" });
    } finally {
      setSafetyBusy("");
    }
  };

  const doForgetSafetyVerified = async () => {
    if (safetyBusy || !threadPeerId) return;
    setSafetyBusy("forget");
    try {
      await clearSafetyNumberVerified(threadPeerId);
      const s = await getSafetyNumber(apiDataAction, threadPeerId);
      setSafetyModal({ loading: false, ...s });
      toast("Verification cleared.");
    } catch (e) {
      toast(e.message || "Couldn't clear that.", { tone: "error" });
    } finally {
      setSafetyBusy("");
    }
  };

  const sendMessage = async (attachment) => {
    const text = draft.trim();
    // An attachment is a complete message on its own — a photo of a gel or
    // a ten-second voice note doesn't need a caption to be worth sending.
    if ((!text && !attachment) || !activeId || sending) return;
    const isEncrypted = !!activeThread?.encrypted;
    // E2EE Phase 1 is text-only: the server rejects attachments in
    // encrypted threads, so the UI refuses up front with a clear reason
    // instead of letting the send fail at the network.
    if (isEncrypted && attachment) {
      toast("Attachments aren't encrypted yet. Send them in an unencrypted conversation for now.", { tone: "error" });
      return;
    }
    setSending(true);
    setDraft("");
    try {
      // Commit 57 — a short confirmation blip on send. Silence after
      // pressing send leaves a half-second of "did that go?"; every
      // messaging app answers that with a sound, and it costs one
      // oscillator. Honors the app's mute setting like every other tone.
      cbBlip(880, 0.07, 0.05);
      if (isEncrypted) {
        // One envelope per peer device (each device gets its own Olm
        // session); the rows land as separate cipher messages and each of
        // the peer's devices decrypts its own. Fail-closed: encryptMessage
        // throws when any device can't be reached, and nothing is sent.
        const { envelopes, deviceId } = await encryptMessage({
          apiAction: apiDataAction,
          peerUserId: activeThread.otherId,
          plaintext: text,
        });
        for (const env of envelopes) {
          await apiDataAction("send-message", {
            thread_id: activeId, text: env.text, sender_device_id: deviceId,
          });
        }
        // The local echo shows what was typed, not the ciphertext — the
        // next poll replaces it with the server rows, decrypted the same
        // way (own-echo path).
        const localMsg = {
          id: "local-" + Date.now(), text, mine: true, who: "You",
          msgKind: "cipher", senderDeviceId: deviceId,
          createdAt: Date.now(), e2ee: { ok: true, text },
        };
        setActiveThread((t) => (t ? { ...t, messages: [...t.messages, localMsg] } : t));
        setThreads((prev) => prev.map((t) => (t.id === activeId ? {
          ...t,
          lastMessage: { encrypted: true, mine: true, text, createdAt: Date.now() },
        } : t)));
        return;
      }
      const res = await apiDataAction("send-message", {
        thread_id: activeId, text,
        ...(attachment ? {
          attachment_kind: attachment.kind,
          attachment_title: attachment.title || "",
          attachment_data: attachment.data || "",
          attachment_url: attachment.url || "",
          attachment_meta: attachment.meta || null,
        } : {}),
      });
      setActiveThread((t) => (t ? { ...t, messages: [...t.messages, { ...res.message, who: "You" }] } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, lastMessage: res.message } : t)));
    } catch (e) {
      setDraft(text);
      toast(e.message || "Couldn't send that message.", { tone: "error" });
    } finally {
      setSending(false);
    }
  };

  // Commit 48: flips the block for activeThread.otherId and mirrors the
  // result into both activeThread (so the composer/Huddle gate below reacts
  // immediately) and the thread list (so re-opening this conversation from
  // the sidebar doesn't need a fresh fetch to know it's blocked).
  const toggleBlock = async () => {
    if (!activeThread?.otherId || blockBusy) return;
    setBlockBusy(true);
    setMenuOpen(false);
    try {
      const res = await apiDataAction("toggle-block", { target_id: activeThread.otherId });
      setActiveThread((t) => (t ? { ...t, blocked: res.blocked } : t));
      setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, blocked: res.blocked } : t)));
      toast(res.blocked ? "Blocked. They can no longer message or call you." : "Unblocked.");
    } catch (e) {
      toast(e.message || "Couldn't update that block.", { tone: "error" });
    } finally {
      setBlockBusy(false);
    }
  };

  const subtitle = activeThread
    ? (activeThread.kind === "group"
      // Group subtitle: member names, truncated. The full roster is one
      // tap away in the header (member count → member list popover).
      ? ((activeThread.members || []).filter((m) => !m.mine).map((m) => m.name).slice(0, 4).join(", ") +
        ((activeThread.members || []).length > 5 ? ` +${(activeThread.members || []).length - 5} more` : ""))
      : (// Commit 100 — was [otherEmail, otherAffiliation]. The email is no
      // longer sent by the server at all, and the affiliation now arrives
      // already filtered by that person's show_affiliation setting. The
      // handle is what belongs here: public, stable, and the thing that
      // tells two people with the same name apart.
      [activeThread.otherUsername ? "@" + activeThread.otherUsername : null, activeThread.otherAffiliation].filter(Boolean).join(" · ")))
    : "";

  // Read receipts — DMs show "Seen"/"Delivered" on your last message;
  // groups show "Seen by N" (count of other members whose lastReadAt is
  // at or past your last message). Same placement as every real messaging
  // app: only the single most recent message *you* sent.
  let lastMineMessage = null;
  if (activeThread?.messages) {
    for (let i = activeThread.messages.length - 1; i >= 0; i--) {
      if (activeThread.messages[i].mine) { lastMineMessage = activeThread.messages[i]; break; }
    }
  }
  const seenLastMine = !!(
    lastMineMessage && activeThread?.kind === "dm" &&
    activeThread.otherLastReadAt && activeThread.otherLastReadAt >= lastMineMessage.createdAt
  );
  // Group read receipts: how many other members have read my last message.
  let groupSeenCount = 0;
  let groupSeenNames = [];
  if (lastMineMessage && activeThread?.kind === "group" && Array.isArray(activeThread.members)) {
    const seen = activeThread.members.filter((m) => !m.mine && m.lastReadAt && m.lastReadAt >= lastMineMessage.createdAt);
    groupSeenCount = seen.length;
    groupSeenNames = seen.map((m) => m.name || m.username || "Someone");
  }

  // Mobile: show one pane at a time (list, or the open thread with a way
  // back) instead of squeezing both into one narrow column.
  const showList = !isMobile || !activeId;
  const showThread = !isMobile || !!activeId;

  const filteredThreads = threadQuery.trim()
    // Unnamed threads carry the peer's identity in otherUsername /
    // otherAffiliation instead of name — matching only name made them
    // unfindable in search.
    ? threads.filter((t) => ((t.name || "") + " " + (t.otherUsername || "") + " " + (t.otherAffiliation || "")).toLowerCase().includes(threadQuery.trim().toLowerCase()))
    : threads;

  return (
    <>
    {/* Commit 56 — was height:"100%". Its parent chain (S.pageView inside
        S.appMain) only ever sets minHeight, and a percentage height
        resolves against a parent's *height*, not its min-height — so this
        collapsed to the height of its own content. On screen that meant the
        conversation stopped a few hundred pixels down with the composer
        floating mid-page and the bottom half of the window empty, which is
        the single thing that made this screen look unfinished next to
        everything else. A viewport-relative height is resolvable no matter
        what the ancestors declare; dvh (not vh) so mobile browser chrome
        collapsing doesn't leave the composer under the address bar. */}
    <div style={{ height: "100dvh", maxHeight: "100dvh", display: "flex", flexDirection: isMobile ? "column" : "row" }}>
      {showList && (
        <div style={{ width: isMobile ? "100%" : 300, flexShrink: 0, borderRight: isMobile ? "none" : `1px solid ${P.line}`, display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "22px 22px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: FONT_SIZES.heading, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-font)" }}>Inbox</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button onClick={() => setGroupModalOpen(true)} aria-label="New group" title="New group" style={{ width: 44, height: 44, borderRadius: "50%", border: "none", cursor: "pointer", background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="network" size={16} />
            </button>
            <button onClick={onCompose} aria-label="New message" title="New message" style={{ width: 44, height: 44, borderRadius: "50%", border: "none", cursor: "pointer", background: withAlpha(accent, 0.12), color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="edit" size={15} />
            </button>
            </div>
          </div>
          {threads.length > 0 && (
            <div style={{ padding: "0 22px 12px" }}>
              <input
                value={threadQuery}
                onChange={(e) => setThreadQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 9999, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-font)", fontSize: 16 }}
              />
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
            {/* Commit 100 — "No conversations yet." followed by a <br> was
                the last hand-written empty state left in this file, and it
                sat in the narrowest column on the screen where a bare grey
                sentence reads as a rendering failure. It also had one job it
                was not doing: after this commit, whether a stranger can
                reach you is a setting, so the empty inbox is the natural
                place to say what that setting currently is. */}
            {threads.length === 0 && (
              <div style={{ padding: "16px 12px", lineHeight: 1.6 }}>
                <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, marginBottom: 5 }}>No conversations yet</div>
                <div style={{ fontSize: FONT_SIZES.caption, color: P.faint }}>
                  Search for someone in Find people and start one. By default only people you follow can open a conversation with you.
                </div>
                <button onClick={onCompose} className="cb-press" style={{ minHeight: 44,
                  marginTop: 12, padding: "7px 16px", borderRadius: RADIUS.pill, cursor: "pointer",
                  background: withAlpha(accent, 0.12), color: accent, border: "none",
                  fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-font)", fontWeight: 700,
                }}>Find someone</button>
              </div>
            )}
            {threads.length > 0 && filteredThreads.length === 0 && (
              <div style={{ padding: "16px 12px", fontSize: FONT_SIZES.caption, color: P.faint }}>No conversations match "{threadQuery}".</div>
            )}
            {filteredThreads.map((t) => {
              const initials = (t.name || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              const preview = !t.lastMessage
                ? "No messages yet"
                : t.lastMessage.encrypted
                  ? (t.lastMessage.mine ? "You: " : "") + "Encrypted message"
                  : (t.lastMessage.mine ? "You: " : "") + (t.lastMessage.text || (t.lastMessage.attachmentTitle ? `Attached: ${t.lastMessage.attachmentTitle}` : ""));
              // Commit 47: bold name/preview + an accent dot for a genuinely
              // unread thread (t.unread, backed by the real last_read_at
              // column now — see functions/api/data.js) instead of every
              // row rendering identically regardless of read state.
              return (
                <button key={t.id} onClick={() => setActiveId(t.id)} className="cb-row" style={{ minHeight: 44,
                  width: "100%", textAlign: "left", padding: "11px 12px 11px 4px", borderRadius: 0, border: "none",
                  borderBottom: `1px solid ${P.line}`, cursor: "pointer",
                  background: activeId === t.id ? withAlpha(accent, 0.08) : "transparent",
                  boxShadow: activeId === t.id ? `inset 2px 0 0 ${accent}` : "none",
                  display: "flex", gap: 10, alignItems: "flex-start", fontFamily: "var(--cb-font)",
                }}>
                  <span style={{ width: 36, height: 36, borderRadius: "50%", ...avatarSkin(t.name || t.id), display: "flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.small, fontWeight: 700, fontFamily: "var(--cb-font)", flexShrink: 0 }}>{initials}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {t.unread && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
                        <span style={{ fontSize: FONT_SIZES.small, fontWeight: t.unread ? 800 : 600, color: P.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                        {/* E2EE Phase 1.4 — list badge ONLY when the server
                            says encrypted. Same promise as the header badge. */}
                        {t.encrypted && <Icon name="lock" size={11} style={{ color: STATUS.good, flexShrink: 0 }} title="Encrypted" />}
                        {t.kind === "group" && <Icon name="network" size={12} style={{ color: P.faint, flexShrink: 0 }} title="Group" />}
                      </span>
                      <span style={{ fontSize: FONT_SIZES.micro, color: P.faint, flexShrink: 0, fontFamily: "var(--cb-font)" }}>{relativeTime(t.lastMessage?.createdAt)}</span>
                    </span>
                    <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: t.unread ? P.ink2 : P.faint, fontWeight: t.unread ? 600 : 400, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showThread && (
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
          {activeThread ? (<>
            <div style={{ padding: "16px 24px", borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {isMobile && (
                  <button onClick={() => setActiveId(null)} aria-label="Back to conversations" style={{ background: "none", border: "none", color: P.ink2, cursor: "pointer", padding: 4, display: "inline-flex", flexShrink: 0 }}>
                    <Icon name="arrowRight" size={16} style={{ transform: "rotate(180deg)" }} />
                  </button>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {activeThread.kind === "group" ? (
                      // The name + member count are the way in: tapping them
                      // opens the group info panel (roster, add/remove,
                      // rename, leave). DMs keep the plain text name.
                      <button onClick={openGroupInfo} aria-label={`Group info for ${activeThread.name}`} style={{ background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, fontFamily: "var(--cb-font)", color: P.ink, textAlign: "left" }}>
                        <span style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeThread.name}</span>
                        {activeThread.memberCount ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, background: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", padding: "3px 8px", borderRadius: 9999, flexShrink: 0, fontFamily: "var(--cb-font)" }}>
                            <Icon name="network" size={11} /> {activeThread.memberCount}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <div style={{ fontSize: FONT_SIZES.body, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeThread.name}</div>
                    )}
                    {/* E2EE Phase 1.4 — the badge renders ONLY when the server
                        says this thread is encrypted. No badge on plaintext
                        threads, ever: a badge is a promise. */}
                    {activeThread.encrypted && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT_SIZES.micro, fontWeight: 700, color: STATUS.good, background: withAlpha(STATUS.good, 0.12), padding: "3px 8px", borderRadius: 9999, flexShrink: 0, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.labelTight }}>
                        <Icon name="lock" size={11} /> Encrypted
                      </span>
                    )}
                  </div>
                  {subtitle && <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, fontFamily: "var(--cb-font)" }}>{subtitle}</div>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {/* Commit 57 — "Huddle" was internal vocabulary on the most
                    important button in a conversation. Nobody arrives at a
                    science tool knowing what a huddle is; everyone knows a
                    phone icon and a camera icon. Both open the same call
                    surface; the audio one starts with the camera off. */}
                <button
                  onClick={() => { if (!activeThread.blocked) onStartHuddle(activeThread.name, activeId, { audioOnly: true }); }}
                  disabled={activeThread.blocked}
                  aria-label="Start an audio call" title="Audio call"
                  style={{
                    background: withAlpha(accent, 0.1), border: "none", borderRadius: "50%", color: accent,
                    cursor: activeThread.blocked ? "default" : "pointer", opacity: activeThread.blocked ? 0.4 : 1,
                    width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                ><Icon name="phone" size={16} /></button>
                <button
                  onClick={() => { if (!activeThread.blocked) onStartHuddle(activeThread.name, activeId); }}
                  disabled={activeThread.blocked}
                  aria-label={activeThread.blocked ? "You've blocked this person: calling unavailable" : activeHuddleRoomSeed === activeId ? "Return to call" : "Start a video call"}
                  title={activeThread.blocked ? "You've blocked this person" : activeHuddleRoomSeed === activeId ? "Return to call" : "Video call"}
                  style={{
                    background: withAlpha(accent, activeHuddleRoomSeed === activeId ? 0.22 : 0.1), border: "none", borderRadius: "50%", color: accent,
                    cursor: activeThread.blocked ? "default" : "pointer", opacity: activeThread.blocked ? 0.4 : 1,
                    width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                ><Icon name="camera" size={16} /></button>
                {/* Commit 48: block/report menu — DM-only (see user_blocks'
                    scope note in schema.sql: groups have no membership-
                    removal flow to pair blocking with yet), and only once
                    the thread fetch has actually resolved who "the other
                    person" is. */}
                {activeThread.kind === "dm" && activeThread.otherId && (
                  <div style={{ position: "relative" }}>
                    <UIButton P={P} variant="ghost" onClick={() => setMenuOpen((v) => !v)} aria-label="Conversation options" aria-haspopup="true" aria-expanded={menuOpen} style={{ width: 44, height: 44, borderRadius: 8, border: "none", background: menuOpen ? withAlpha(accent, 0.12) : "transparent", color: P.ink2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="moreVertical" size={17} />
                    </UIButton>
                    {menuOpen && (<>
                      <div onClick={() => setMenuOpen(false)} aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: Z.dropdown }} />
                      <div style={{
                        position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: Z.dropdownMenu, minWidth: 200,
                        background: P.dark ? "rgba(22,24,34,0.98)" : "#fff", border: `1px solid ${P.line}`, borderRadius: 8,
                        boxShadow: "0 12px 32px rgba(0,0,0,0.22)", padding: 6, display: "flex", flexDirection: "column",
                      }}>
                        <UIButton P={P} variant="ghost" onClick={toggleBlock} disabled={blockBusy} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: P.ink, fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.small, fontWeight: 500, cursor: blockBusy ? "default" : "pointer", textAlign: "left" }}>
                          <Icon name="block" size={15} style={{ minHeight: 44, color: P.ink2, flexShrink: 0 }} /> {activeThread.blocked ? "Unblock" : "Block"} {activeThread.name}
                        </UIButton>
                        <button onClick={() => { setMenuOpen(false); setReportModal({ kind: "user" }); }} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: statusBad(P), fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.small, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                          <Icon name="flag" size={15} style={{ flexShrink: 0 }} /> Report {activeThread.name}
                        </button>
                        {/* E2EE Phase 1.4 — safety numbers. Only on encrypted
                            DMs: there's nothing to verify on a plaintext
                            thread. */}
                        {activeThread.encrypted && (
                          <UIButton P={P} variant="ghost" onClick={openSafetyModal} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: P.ink, fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.small, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                            <Icon name="shield" size={15} style={{ color: P.ink2, flexShrink: 0 }} /> Verify encryption
                          </UIButton>
                        )}
                      </div>
                    </>)}
                  </div>
                )}
              </div>
            </div>
            {activeThread.blocked && (
              <div style={{ padding: "12px 24px", background: withAlpha(STATUS.bad, 0.08), borderBottom: `1px solid ${P.line}`, fontSize: FONT_SIZES.caption, color: P.ink2, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="block" size={14} style={{ color: statusBad(P), flexShrink: 0 }} />
                You've blocked {activeThread.name}. Neither of you can message or call here until you unblock.
              </div>
            )}
            {/* E2EE Phase 1.4 — safety number changed on an encrypted DM.
                Loud, and it doesn't go away until the user checks: a
                changed number can mean a new device — or someone else. */}
            {safetyChanged && activeThread.encrypted && !activeThread.blocked && (
              <div style={{ padding: "12px 24px", background: withAlpha(STATUS.bad, 0.1), borderBottom: `1px solid ${P.line}`, fontSize: FONT_SIZES.caption, color: P.ink, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Icon name="warning" size={15} style={{ color: statusBad(P), flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 220, fontFamily: "var(--cb-font)", lineHeight: 1.5 }}>
                  The security numbers changed — {activeThread.name}'s devices changed. Make sure this was them before continuing.
                </span>
                <button onClick={openSafetyModal} style={{ minHeight: 44, padding: "6px 13px", fontSize: FONT_SIZES.caption, fontWeight: 700, background: withAlpha(STATUS.bad, 0.14), color: STATUS.bad, border: `1px solid ${withAlpha(STATUS.bad, 0.4)}`, borderRadius: 9999, cursor: "pointer", fontFamily: "var(--cb-font)", whiteSpace: "nowrap" }}>
                  Check numbers
                </button>
              </div>
            )}
            {/* E2EE Phase 1.4 — per-thread upgrade prompt. Only when this
                device is set up AND the peer is ready; otherwise the banner
                would nag about something the user can't act on. */}
            {upgradeInfo && !upgradeInfo.checking && !activeThread.encrypted && !activeThread.blocked && (
              <div style={{ padding: "12px 24px", background: withAlpha(accent, 0.07), borderBottom: `1px solid ${P.line}`, fontSize: FONT_SIZES.caption, color: P.ink2, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Icon name="lock" size={14} style={{ color: accent, flexShrink: 0 }} />
                {upgradeInfo.ready ? (<>
                  <span style={{ flex: 1, minWidth: 220, fontFamily: "var(--cb-font)", lineHeight: 1.5 }}>
                    Turn on encrypted messaging for this conversation — only you and {activeThread.name} will be able to read new messages.
                  </span>
                  <button onClick={doUpgradeThread} disabled={upgrading} style={{ minHeight: 44, padding: "6px 13px", fontSize: FONT_SIZES.caption, fontWeight: 700, background: withAlpha(accent, 0.16), color: accent, border: `1px solid ${withAlpha(accent, 0.35)}`, borderRadius: 9999, cursor: upgrading ? "default" : "pointer", fontFamily: "var(--cb-font)", whiteSpace: "nowrap", opacity: upgrading ? 0.6 : 1 }}>
                    {upgrading ? "Turning on…" : "Turn on"}
                  </button>
                </>) : (
                  <span style={{ fontFamily: "var(--cb-font)", lineHeight: 1.5 }}>
                    Waiting for {activeThread.name} to set up encrypted messaging.
                  </span>
                )}
              </div>
            )}
            {/* Commit 87 — messages sat at the TOP of the pane.
                A conversation with four messages rendered them in the top
                quarter of a 900px column with the rest empty below, which
                is how no messaging app anywhere behaves and is most of why
                this screen read as a mock-up. `justifyContent: flex-end`
                keeps a short thread resting on the composer, exactly as it
                does everywhere else, and has no effect once the thread is
                long enough to scroll. */}
            <div ref={msgPaneRef} style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 14, minHeight: 0 }}>
              {activeThread.messages.length === 0 && (
                <div style={{ textAlign: "center", color: P.faint, fontSize: FONT_SIZES.small, marginTop: 20 }}>No messages yet. Say hello.</div>
              )}
              {activeThread.messages.map((m, i) => {
                const key = m.id || i;
                // E2EE Phase 1.3 — display model for cipher rows. Rows
                // addressed to another of this user's devices vanish
                // silently; failed decryptions render as an honest inline
                // error; raw ciphertext never reaches the DOM.
                if (m.e2ee && m.e2ee.skipped) return null;
                const isCipher = m.msgKind === "cipher";
                const e2eeOk = isCipher && m.e2ee && m.e2ee.ok;
                const displayText = isCipher ? (e2eeOk ? m.e2ee.text : null) : m.text;
                const e2eeError = isCipher && !e2eeOk
                  ? ((m.e2ee && m.e2ee.error) || "Couldn't decrypt this message.")
                  : null;
                const bubbleText = displayText || e2eeError;
                // Commit 56 — a date separator whenever the day changes, so
                // a conversation that spans weeks stops reading as one
                // undifferentiated column of bubbles with no sense of when
                // anything was said.
                const prev = i > 0 ? activeThread.messages[i - 1] : null;
                const dayOf = (ts) => (ts ? new Date(ts).toDateString() : "");
                const showDay = !!m.createdAt && dayOf(m.createdAt) !== dayOf(prev && prev.createdAt);
                const dayLabel = (() => {
                  if (!m.createdAt) return "";
                  const d = new Date(m.createdAt), now = new Date();
                  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
                  if (days === 0) return "Today";
                  if (days === 1) return "Yesterday";
                  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
                })();
                const timeLabel = m.createdAt ? new Date(m.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
                // E2EE Phase 1.4 — legacy divider. The first encrypted
                // message after plaintext history gets a marker: everything
                // above it was readable by the server, everything below it
                // wasn't. Skipped rows (other-device) don't count as
                // history either way.
                const showLegacyDivider = isCipher && i === legacyDividerIdx;
                return (
                <React.Fragment key={key}>
                {showLegacyDivider && (
                  <div style={{ alignSelf: "center", margin: "12px 0 4px", padding: "6px 16px", fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.tight, border: `1px solid ${P.line}`, borderRadius: 9999, background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="lock" size={11} style={{ flexShrink: 0 }} />
                    Messages before encryption — these were readable by the server
                  </div>
                )}
                {showDay && (
                  <div style={{ alignSelf: "center", margin: "10px 0 2px", fontSize: FONT_SIZES.micro, fontWeight: 600, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.tight }}>{dayLabel}</div>
                )}
                <div className="cb-msg-bubble" style={{ maxWidth: 460, alignSelf: m.mine ? "flex-end" : "flex-start" }}
                  onMouseEnter={() => setHoverMsgId(key)} onMouseLeave={() => setHoverMsgId((h) => (h === key ? null : h))}
                >
                  {/* Group threads show who said what — DMs don't need it, you
                      already know who you're talking to. */}
                  {activeThread?.kind === "group" && !m.mine && m.who && (
                    <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: accent, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.tight, marginBottom: 3, paddingLeft: 2 }}>{m.who}</div>
                  )}
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 5, flexDirection: m.mine ? "row-reverse" : "row" }}>
                    <div style={{ minWidth: 0 }}>
                      {bubbleText && (
                        <div style={{
                          padding: "12px 16px", fontSize: FONT_SIZES.small, lineHeight: 1.6,
                          borderRadius: m.mine ? "16px 16px 2px 16px" : "16px 16px 16px 2px",
                          color: m.mine ? at : P.ink,
                          background: m.mine ? accent : P.line,
                          border: m.mine ? "none" : (P.dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.05)"),
                          ...(e2eeError ? { fontStyle: "italic", opacity: 0.72 } : {}),
                        }}>{bubbleText}</div>
                      )}
                      {/* Image: shown at real size in the thread (a figure
                          you have to click to evaluate is a figure you
                          won't evaluate), click to open full-screen. */}
                      {m.attachmentKind === "image" && m.attachmentData && (
                        <img
                          src={m.attachmentData}
                          alt={m.attachmentTitle || "Attached image"}
                          onClick={() => setLightbox(m.attachmentData)}
                          role="button" tabIndex={0} aria-label={(m.attachmentTitle || "Attached image") + ". Activate to view full size."}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightbox(m.attachmentData); } }}
                          style={{
                            marginTop: m.text ? 8 : 0, display: "block", maxWidth: "100%", maxHeight: 340,
                            borderRadius: 12, cursor: "zoom-in", border: `1px solid ${P.line}`, objectFit: "cover",
                          }}
                        />
                      )}
                      {/* Voice note: the player and, underneath it, the
                          transcript captured while recording. The transcript
                          is the point — it makes the note skimmable, and
                          readable at all by someone who can't play audio. */}
                      {m.attachmentKind === "audio" && m.attachmentData && (
                        <div style={{
                          marginTop: m.text ? 8 : 0, padding: "12px 12px", borderRadius: 12, minWidth: 220,
                          background: m.mine ? withAlpha(at, 0.14) : (P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"),
                          border: `1px solid ${m.mine ? withAlpha(at, 0.25) : P.line}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Icon name="mic" size={14} style={{ color: m.mine ? at : accent, flexShrink: 0 }} />
                            <audio controls src={m.attachmentData} style={{ height: 32, maxWidth: 210 }} />
                          </div>
                          {m.attachmentMeta && m.attachmentMeta.transcript && (
                            <div style={{ marginTop: 8, fontSize: FONT_SIZES.caption, lineHeight: 1.55, color: m.mine ? at : P.ink2, opacity: 0.92 }}>
                              “{m.attachmentMeta.transcript}”
                            </div>
                          )}
                        </div>
                      )}
                      {/* A shared paper. Distinct from a plain link: it keeps
                          the citation metadata, so a source sent in a DM
                          still reads like a source. */}
                      {m.attachmentKind === "paper" && m.attachmentTitle && (
                        <a
                          href={safeHref(m.attachmentUrl || "#")} target="_blank" rel="noopener noreferrer"
                          style={{
                            marginTop: m.text ? 8 : 0, padding: "12px 16px", borderRadius: 12, display: "block",
                            background: withAlpha(accent, 0.08), border: `1px solid ${withAlpha(accent, 0.28)}`, textDecoration: "none",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                            <Icon name="bookOpen" size={13} style={{ color: accent, flexShrink: 0 }} />
                            <span style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: accent, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.tight }}>Paper</span>
                          </div>
                          <div style={{ fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, lineHeight: 1.4 }}>{m.attachmentTitle}</div>
                          {m.attachmentMeta && (m.attachmentMeta.journal || m.attachmentMeta.year) && (
                            <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, marginTop: 4 }}>
                              {[m.attachmentMeta.journal, m.attachmentMeta.year].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </a>
                      )}
                      {m.attachmentKind !== "image" && m.attachmentKind !== "audio" && m.attachmentKind !== "paper" && m.attachmentTitle && (
                        <div style={{
                          marginTop: 8, padding: "12px 16px", borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
                          background: withAlpha(accent, 0.06), border: `1px solid ${withAlpha(accent, 0.2)}`,
                        }}>
                          <Icon name="external" size={15} style={{ color: accent, flexShrink: 0 }} />
                          <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 500 }}>Attached: {m.attachmentTitle}</span>
                        </div>
                      )}
                    </div>
                    {/* Commit 48: per-message report — someone else's message
                        only (m.id is always set for a real row; the || i
                        fallback key above never has one), faded in on hover
                        rather than a permanent extra icon on every bubble. */}
                    {!m.mine && m.id && (
                      <button
                        onClick={() => setReportModal({ kind: "message", messageId: m.id })}
                        aria-label="Report this message" title="Report this message"
                        className="cb-msg-report"
                        style={{
                          opacity: hoverMsgId === key ? 1 : 0, transition: "opacity 0.15s ease",
                          background: "none", border: "none", color: P.faint, cursor: "pointer", padding: 4, flexShrink: 0,
                        }}
                      >
                        <Icon name="flag" size={13} />
                      </button>
                    )}
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginTop: 4,
                    justifyContent: m.mine ? "flex-end" : "flex-start",
                    fontSize: FONT_SIZES.micro, color: P.faint,
                  }}>
                    {/* A message with no time on it is a message you can't
                        place in a conversation. */}
                    {timeLabel && <span style={{ fontFamily: "var(--cb-font)" }}>{timeLabel}</span>}
                    {m.mine && m.id && lastMineMessage?.id === m.id && activeThread?.kind === "dm" && (
                      <span>· {seenLastMine ? "Seen" : "Delivered"}</span>
                    )}
                    {m.mine && m.id && lastMineMessage?.id === m.id && activeThread?.kind === "group" && (
                      <span title={groupSeenNames.length > 0 ? `Seen by ${groupSeenNames.join(", ")}` : "No one has seen this yet"}>
                        · {groupSeenCount > 0 ? `Seen by ${groupSeenCount}` : "Sent"}
                      </span>
                    )}
                  </div>
                </div>
                </React.Fragment>
                );
              })}
            </div>
            <div style={{ padding: "16px 24px 16px", borderTop: `1px solid ${P.line}` }}>
              {activeThread.blocked ? (
                <div style={{ textAlign: "center", fontSize: FONT_SIZES.caption, color: P.faint, padding: "8px 0" }}>
                  You've blocked {activeThread.name}. Unblock above to send a message.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImagePick} style={{ display: "none" }} aria-hidden="true" />
                  {/* While recording, the composer becomes the recorder —
                      one obvious thing to look at and one obvious way out,
                      rather than a record button competing with a text field
                      nobody is going to use mid-sentence. */}
                  {recording ? (
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderRadius: 9999,
                      background: withAlpha(STATUS.bad, 0.1), border: `1px solid ${withAlpha(STATUS.bad, 0.35)}`,
                    }}>
                      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS.bad, animation: "cbMicPulse 1.4s ease-in-out infinite" }} />
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink, fontWeight: 600 }}>Recording</span>
                      <span style={{ fontSize: FONT_SIZES.small, color: P.ink2, fontFamily: "var(--cb-font)" }}>
                        {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:{String(recSeconds % 60).padStart(2, "0")}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: FONT_SIZES.caption, color: P.faint }}>Max 90s</span>
                    </div>
                  ) : (<>
                  <UIButton P={P} variant="ghost"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={attachBusy || sending}
                    aria-label="Attach an image" title="Attach an image"
                    style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: "transparent", border: `1px solid ${P.line}`, color: P.ink2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  ><Icon name={attachBusy ? "refresh" : "image"} size={16} className={attachBusy ? "cb-spin" : undefined} /></UIButton>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Message ${activeThread.name}…`}
                    aria-label="Reply"
                    disabled={sending}
                    style={{ flex: 1, padding: "12px 16px", borderRadius: 9999, border: `1px solid ${P.line}`, background: P.dark ? "rgba(255,255,255,0.03)" : "#fff", color: P.ink, fontFamily: "var(--cb-font)", fontSize: FONT_SIZES.small }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }}
                  />
                  </>)}
                  {/* Record / stop. Recording is the one action here that
                      benefits from being a toggle rather than press-and-hold:
                      a research note is often 30-60 seconds, and holding a
                      button that long while thinking is genuinely awkward. */}
                  <UIButton P={P} variant="ghost"
                    onClick={() => (recording ? stopRecording() : startRecording())}
                    disabled={attachBusy || sending}
                    aria-label={recording ? "Send voice note" : "Record a voice note"}
                    title={recording ? "Stop and send" : "Record a voice note"}
                    style={{
                      width: 40, height: 40, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: recording ? STATUS.bad : "transparent",
                      border: recording ? "none" : `1px solid ${P.line}`,
                      color: recording ? "#fff" : P.ink2,
                    }}
                  ><Icon name={recording ? "send" : "mic"} size={16} /></UIButton>
                  {!recording && <button onClick={() => sendMessage()} disabled={!draft.trim() || sending} aria-label="Send" className="cb-magnetic" style={{ width: 44, height: 44, borderRadius: "50%", background: accent, color: at, border: "none", cursor: draft.trim() && !sending ? "pointer" : "default", opacity: draft.trim() && !sending ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name="send" size={16} />
                  </button>}
                </div>
              )}
            </div>
          </>) : (
            /* Commit 100 — this pane is the largest single area on the
               Inbox and it held one grey sentence, centred, with nothing
               else. "Nothing here yet." in the middle of a 900px column is
               indistinguishable from a page that failed to load. */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 32, gap: 10 }}>
              {loadingThread ? (
                <div style={{ color: P.faint, fontSize: FONT_SIZES.small, fontFamily: "var(--cb-font)" }}>Opening thread…</div>
              ) : threads.length === 0 ? (
                <>
                  <div style={{
                    width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: withAlpha(accent, 0.1), color: accent, marginBottom: 2,
                  }}><Icon name="mail" size={20} /></div>
                  <div style={{ fontSize: FONT_SIZES.subhead, fontWeight: 700, color: P.ink, fontFamily: "var(--cb-font)", letterSpacing: TYPE.heading.letterSpacing }}>Your conversations live here</div>
                  <div style={{ fontSize: FONT_SIZES.small, color: P.faint, lineHeight: 1.65, maxWidth: 380 }}>
                    Messages, shared papers, and calls with other researchers. Nothing you say here is used to train anything or shown on your profile.
                  </div>
                  <button onClick={onCompose} className="cb-press" style={{ minHeight: 44,
                    marginTop: 8, padding: "9px 24px", borderRadius: RADIUS.pill, cursor: "pointer",
                    background: accent, color: at, border: "none",
                    fontSize: FONT_SIZES.caption, fontFamily: "var(--cb-font)", fontWeight: 700,
                  }}>Find someone to message</button>
                </>
              ) : (
                <div style={{ color: P.faint, fontSize: FONT_SIZES.small }}>Pick a conversation on the left.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
    {/* Full-screen image view. A figure shared in a conversation has to be
        inspectable at full size — a 340px-tall thumbnail is a notification
        that an image exists, not the image. */}
    {lightbox && (
      <Dialog label="Attached image" onClose={() => setLightbox(null)} zIndex={260}
        scrimStyle={{ background: "rgba(0,0,0,0.9)", padding: 28 }}
        panelStyle={{ background: "transparent", border: "none", boxShadow: "none", borderRadius: 0, overflow: "visible", alignItems: "center", justifyContent: "center", cursor: "zoom-out", maxHeight: "92dvh", width: "auto" }}
      >
        <img src={lightbox} alt="Attached" role="button" tabIndex={0} aria-label="Attached image. Activate to close."
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightbox(null); } }}
          style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} onClick={() => setLightbox(null)} />
      </Dialog>
    )}
    {reportModal && activeThread && (
      <ReportConductModal
        P={P} accent={accent} at={at}
        kind={reportModal.kind}
        targetLabel={activeThread.name}
        threadId={activeId}
        reportedUserId={activeThread.otherId}
        messageId={reportModal.messageId}
        onClose={() => setReportModal(null)}
      />
    )}
    {/* E2EE Phase 1.4 — safety number comparison. The number is symmetric:
        both sides derive the same digits from the same device records, so
        comparing them out of band proves nobody added a device in the
        middle. Plain language throughout: "security numbers", never the
        crypto vocabulary. */}
    {safetyModal && activeThread && (
      <ModalChrome
        label="Verify encryption" eyebrow="Encrypted messaging"
        title={`Verify ${activeThread.name}`}
        onClose={() => setSafetyModal(null)} accent={accent}
        P={P} drawer={isMobile} width={560}
      >
        {(() => {
          // ModalChrome's centered mode is dark instrument-glass; the
          // mobile drawer follows the theme. Text colors follow suit.
          const mInk = isMobile ? P.ink : "#f2f4f2";
          const mDim = isMobile ? P.ink2 : "rgba(242,244,242,0.75)";
          const mFaint = isMobile ? P.faint : "rgba(242,244,242,0.5)";
          const mCard = isMobile ? (P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)") : "rgba(255,255,255,0.04)";
          const mLine = P.line;
          return safetyModal.loading ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: mFaint, fontSize: FONT_SIZES.small, fontFamily: "var(--cb-font)" }}>
              Loading security numbers…
            </div>
          ) : (<>
            {safetyModal.changed && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", borderRadius: 12, background: withAlpha(STATUS.bad, 0.12), border: `1px solid ${withAlpha(STATUS.bad, 0.35)}`, marginBottom: 16 }}>
                <Icon name="warning" size={17} style={{ color: STATUS.bad, flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: FONT_SIZES.small, lineHeight: 1.55, color: mInk, fontFamily: "var(--cb-font)" }}>
                  <strong>The security numbers changed.</strong> {activeThread.name}'s devices changed since you last verified. Make sure this was them — a new phone, a reinstalled app — before continuing. If you can't confirm it, don't send anything sensitive.
                </div>
              </div>
            )}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
              padding: 16, borderRadius: 12, background: mCard,
              border: `1px solid ${mLine}`, marginBottom: 14,
            }}>
              {(safetyModal.number || "").split(" ").map((g, i) => (
                <div key={i} style={{
                  textAlign: "center", padding: "8px 4px", borderRadius: 8,
                  background: isMobile && !P.dark ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)",
                  fontSize: FONT_SIZES.body, fontWeight: 700, letterSpacing: TRACKING.eyebrow,
                  color: mInk, fontFamily: "var(--cb-font)", fontVariantNumeric: "tabular-nums",
                  userSelect: "all",
                }}>{g}</div>
              ))}
            </div>
            <div style={{ fontSize: FONT_SIZES.small, lineHeight: 1.6, color: mDim, fontFamily: "var(--cb-font)", marginBottom: 6 }}>
              Compare these numbers with {activeThread.name} on a call or in person. If they match, your conversation is private — no one else can read it.
            </div>
            <div style={{ fontSize: FONT_SIZES.caption, color: mFaint, fontFamily: "var(--cb-font)", marginBottom: 18 }}>
              Covers {safetyModal.deviceCount} of {activeThread.name}'s device{safetyModal.deviceCount === 1 ? "" : "s"} plus yours. You share one set of numbers per person, across all your devices.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {safetyModal.verified ? (<>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT_SIZES.small, fontWeight: 700, color: STATUS.good, background: withAlpha(STATUS.good, 0.12), padding: "7px 16px", borderRadius: 9999, fontFamily: "var(--cb-font)" }}>
                  <Icon name="check" size={14} /> Verified
                </span>
                <button onClick={doForgetSafetyVerified} disabled={safetyBusy === "forget"} style={{ minHeight: 44, padding: "7px 16px", fontSize: FONT_SIZES.small, fontWeight: 600, background: "transparent", color: mFaint, border: `1px solid ${mLine}`, borderRadius: 9999, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
                  {safetyBusy === "forget" ? "Clearing…" : "Forget verification"}
                </button>
              </>) : (
                <button onClick={doMarkSafetyVerified} disabled={safetyBusy === "verify"} style={{ minHeight: 44, padding: "8px 16px", fontSize: FONT_SIZES.small, fontWeight: 700, background: withAlpha(accent, 0.2), color: accent, border: `1px solid ${withAlpha(accent, 0.4)}`, borderRadius: 9999, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
                  {safetyBusy === "verify" ? "Saving…" : safetyModal.changed ? "I checked — it's them" : "The numbers match"}
                </button>
              )}
            </div>
          </>);
        })()}
      </ModalChrome>
    )}
    {/* Group creation — name the group, search for people, add 2+. Groups
        are plaintext (no multiparty E2EE yet); the modal says so plainly. */}
    {groupModalOpen && (
      <ModalChrome
        label="New group" eyebrow="Inbox"
        title="New group"
        onClose={() => { setGroupModalOpen(false); setGroupName(""); setGroupQuery(""); setGroupResults([]); setGroupMembers([]); }}
        accent={accent} P={P} drawer={isMobile} width={520}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label, marginBottom: 6 }}>GROUP NAME</div>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value.slice(0, 80))}
              placeholder="e.g. Lab journal club"
              aria-label="Group name"
              autoFocus={!isMobile}
              style={{
                width: "100%", padding: "12px 12px", borderRadius: 8, fontSize: 16,
                background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                border: `1px solid ${P.line}`, color: P.ink, outline: "none", fontFamily: "var(--cb-font)",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label, marginBottom: 6 }}>ADD PEOPLE ({groupMembers.length})</div>
            {groupMembers.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {groupMembers.map((m) => (
                  <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 6px 6px 12px", borderRadius: 9999, background: withAlpha(accent, 0.12), border: `1px solid ${withAlpha(accent, 0.3)}`, fontSize: FONT_SIZES.caption, fontWeight: 600, color: P.ink, fontFamily: "var(--cb-font)" }}>
                    {m.name || m.username}
                    <button onClick={() => setGroupMembers((prev) => prev.filter((x) => x.id !== m.id))} aria-label={`Remove ${m.name || m.username}`} style={{ width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.15)", color: P.ink, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              value={groupQuery}
              onChange={(e) => setGroupQuery(e.target.value)}
              placeholder="Search a name or @username"
              aria-label="Search people to add"
              style={{
                width: "100%", padding: "12px 12px", borderRadius: 8, fontSize: 16,
                background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                border: `1px solid ${P.line}`, color: P.ink, outline: "none", fontFamily: "var(--cb-font)",
              }}
            />
            {groupSearching && <div style={{ padding: "12px 4px", fontSize: FONT_SIZES.caption, color: P.faint }}>Searching…</div>}
            {!groupSearching && groupQuery.trim().length >= 2 && groupResults.length === 0 && (
              <div style={{ padding: "12px 4px", fontSize: FONT_SIZES.caption, color: P.faint }}>Nobody matches that.</div>
            )}
            {groupResults.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                {groupResults.map((r) => (
                  <button key={r.id} onClick={() => { setGroupMembers((prev) => [...prev, r]); setGroupQuery(""); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--cb-font)", minHeight: 44 }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: withAlpha(accent, 0.14), color: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.caption, fontWeight: 700, flexShrink: 0 }}>
                      {(r.name || r.username || "?").charAt(0).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || r.username}</span>
                      {r.username && <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint }}>@{r.username}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.5 }}>
            Group messages aren't end-to-end encrypted yet.
          </div>
          <UIButton
            P={P} variant="primary" accent={accent} at={at}
            onClick={createGroup}
            disabled={!groupName.trim() || groupMembers.length < 2 || groupCreating}
            style={{ minHeight: 48, opacity: (!groupName.trim() || groupMembers.length < 2 || groupCreating) ? 0.5 : 1 }}
          >
            {groupCreating ? "Creating…" : `Create group${groupMembers.length >= 2 ? ` (${groupMembers.length + 1} people)` : ""}`}
          </UIButton>
        </div>
      </ModalChrome>
    )}
    {/* Group info panel — the full roster, rename, add people, remove
        people, leave. The plaintext + no-admins-yet lines stay honest:
        groups aren't encrypted and anyone in one can rename or remove. */}
    {groupInfoOpen && activeThread?.kind === "group" && (
      <ModalChrome
        label="Group info" eyebrow="Inbox"
        title="Group info"
        onClose={() => setGroupInfoOpen(false)}
        accent={accent} P={P} drawer={isMobile} width={520}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label, marginBottom: 6 }}>GROUP NAME</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={settingsName}
                onChange={(e) => setSettingsName(e.target.value.slice(0, 80))}
                aria-label="Group name"
                style={{
                  flex: 1, minWidth: 0, padding: "12px 12px", borderRadius: 8, fontSize: 16,
                  background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                  border: `1px solid ${P.line}`, color: P.ink, outline: "none", fontFamily: "var(--cb-font)",
                }}
              />
              <UIButton
                P={P} variant="primary" accent={accent} at={at}
                onClick={renameGroup}
                disabled={!settingsName.trim() || settingsBusy === "rename"}
                style={{ minHeight: 48, padding: "0 18px", opacity: (!settingsName.trim() || settingsBusy === "rename") ? 0.5 : 1 }}
              >
                {settingsBusy === "rename" ? "Saving…" : "Save"}
              </UIButton>
            </div>
          </div>
          <div>
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label, marginBottom: 6 }}>MEMBERS ({(activeThread.members || []).length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
              {(activeThread.members || []).map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", minHeight: 44 }}>
                  <span style={{ width: 32, height: 32, borderRadius: "50%", background: withAlpha(accent, 0.14), color: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.caption, fontWeight: 700, flexShrink: 0 }}>
                    {(m.name || m.username || "?").charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.name || m.username}{m.mine ? " (you)" : ""}
                    </span>
                    {m.username && <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint }}>@{m.username}</span>}
                  </span>
                  {!m.mine && (
                    <UIButton
                      P={P} variant="ghost"
                      onClick={() => removeGroupMember(m)}
                      disabled={settingsBusy === "remove:" + m.id}
                      aria-label={`Remove ${m.name || m.username}`}
                      title={`Remove ${m.name || m.username}`}
                      style={{ width: 44, height: 44, borderRadius: 8, border: "none", background: "transparent", color: P.faint, cursor: settingsBusy === "remove:" + m.id ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      {settingsBusy === "remove:" + m.id ? <span style={{ fontSize: FONT_SIZES.micro }}>…</span> : <Icon name="close" size={13} />}
                    </UIButton>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: FONT_SIZES.micro, fontWeight: 700, color: P.faint, fontFamily: "var(--cb-font)", letterSpacing: TRACKING.label, marginBottom: 6 }}>ADD PEOPLE</div>
            <input
              value={settingsQuery}
              onChange={(e) => setSettingsQuery(e.target.value)}
              placeholder="Search a name or @username"
              aria-label="Search people to add"
              style={{
                width: "100%", padding: "12px 12px", borderRadius: 8, fontSize: 16,
                background: P.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                border: `1px solid ${P.line}`, color: P.ink, outline: "none", fontFamily: "var(--cb-font)",
              }}
            />
            {settingsSearching && <div style={{ padding: "12px 4px", fontSize: FONT_SIZES.caption, color: P.faint }}>Searching…</div>}
            {!settingsSearching && settingsQuery.trim().length >= 2 && settingsResults.length === 0 && (
              <div style={{ padding: "12px 4px", fontSize: FONT_SIZES.caption, color: P.faint }}>Nobody matches that.</div>
            )}
            {settingsResults.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                {settingsResults.map((r) => (
                  <button key={r.id} onClick={() => addGroupMembers([r.id])} disabled={settingsBusy === "add"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none", background: "transparent", cursor: settingsBusy === "add" ? "default" : "pointer", textAlign: "left", fontFamily: "var(--cb-font)", minHeight: 44, opacity: settingsBusy === "add" ? 0.5 : 1 }}>
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: withAlpha(accent, 0.14), color: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: FONT_SIZES.caption, fontWeight: 700, flexShrink: 0 }}>
                      {(r.name || r.username || "?").charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: FONT_SIZES.small, fontWeight: 600, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || r.username}</span>
                      {r.username && <span style={{ display: "block", fontSize: FONT_SIZES.caption, color: P.faint }}>@{r.username}</span>}
                    </span>
                    <span style={{ fontSize: FONT_SIZES.caption, fontWeight: 700, color: accent, flexShrink: 0 }}>{settingsBusy === "add" ? "Adding…" : "Add"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: FONT_SIZES.caption, color: P.faint, lineHeight: 1.5 }}>
            Group messages aren't end-to-end encrypted yet. There are no admins — any member can rename the group or remove people.
          </div>
          <UIButton
            P={P} variant="ghost"
            onClick={leaveGroup}
            disabled={settingsBusy === "leave"}
            style={{ minHeight: 48, color: statusBad(P), border: `1px solid ${withAlpha(statusBad(P), 0.35)}`, opacity: settingsBusy === "leave" ? 0.5 : 1 }}
          >
            {settingsBusy === "leave" ? "Leaving…" : "Leave group"}
          </UIButton>
        </div>
      </ModalChrome>
    )}
    </>
  );
}
export { InboxView, ReportConductModal };
