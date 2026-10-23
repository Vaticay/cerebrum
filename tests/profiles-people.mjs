/**
 * Profiles and People Search tests (2026-10-23 huge audit fix lane).
 *
 * Pins, against the real modules and the real data handler on an in
 * memory database:
 *   - the at sign normalization, client query and server stored handle
 *     alike (Bug 1)
 *   - relevance ranking: exact handle, then prefix, then whole word,
 *     then token match, then interest, then substring, with follower
 *     count playing no part (Bug 10), plus token matching in either
 *     order and with initials
 *   - the profile route classification for /people/<handle> (Bug 8)
 *   - the follower exception when an account opts out of discovery:
 *     an existing follower still sees the profile, can unfollow, and
 *     can reopen an existing thread, while everyone else still gets
 *     the shared not found response (Bug 7)
 *   - search rows carrying avatars, interests, an interest match flag,
 *     and a server supplied canMessage flag (Bugs 9 and 11)
 *
 * Run with: node tests/profiles-people.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function group(name) { console.log(`\n${name}`); }

// ══════════════════════════════════════════════════════════════════════
group("Route classification: one real profile URL (Bug 8)");

const { classifyRoute, profileHandleFromPath, profilePathForHandle } = await import(join(root, "src/routeClassify.js"));

await test("/people/<handle> is a profile route carrying the handle", () => {
  assert.deepEqual(classifyRoute("/people/asmith"), { kind: "profile", handle: "asmith" });
});
await test("/profile/<handle> is accepted as the same profile route", () => {
  assert.deepEqual(classifyRoute("/profile/asmith"), { kind: "profile", handle: "asmith" });
});
await test("a leading at sign and a trailing slash fold away", () => {
  assert.deepEqual(classifyRoute("/people/@asmith/"), { kind: "profile", handle: "asmith" });
});
await test("junk under /people stays a 404", () => {
  assert.equal(classifyRoute("/people/").kind, "notfound");
  assert.equal(classifyRoute("/people/a b").kind, "notfound");
  assert.equal(classifyRoute("/people/asmith/extra").kind, "notfound");
});
await test("profilePathForHandle builds the shareable link", () => {
  assert.equal(profilePathForHandle("asmith"), "/people/asmith");
  assert.equal(profilePathForHandle("@asmith"), "/people/asmith");
  assert.equal(profileHandleFromPath("/people/asmith"), "asmith");
});

// ══════════════════════════════════════════════════════════════════════
group("At sign normalization and relevance ranking (Bugs 1 and 10)");

const { normalizePeopleQuery, peopleSearchRank } = await import(join(root, "functions/api/data.js"));

await test("the at sign is stripped the way stored handles are stored", () => {
  assert.equal(normalizePeopleQuery("@asmith"), "asmith");
  assert.equal(normalizePeopleQuery("@@asmith"), "asmith");
  assert.equal(normalizePeopleQuery("  @asmith "), "asmith");
  assert.equal(normalizePeopleQuery("ann smith"), "ann smith");
});

const ann = { username: "asmith", name: "Ann Smith", interests: ["sleep medicine"] };
const annabelle = { username: "annabelle", name: "Annabelle Lee", interests: [] };
const joann = { username: "joann", name: "Jo Ann Park", interests: [] };
const hannah = { username: "hannah", name: "Hannah Reed", interests: [] };

await test("exact handle ranks first, prefix next, whole word next, substring last", () => {
  assert.equal(peopleSearchRank(ann, "@asmith").rank, 0);
  assert.equal(peopleSearchRank(ann, "ann").rank, 1);
  assert.equal(peopleSearchRank(annabelle, "ann").rank, 1);
  assert.equal(peopleSearchRank(joann, "ann").rank, 2);
  assert.equal(peopleSearchRank(hannah, "ann").rank, 5);
  assert.ok(peopleSearchRank(ann, "ann").rank < peopleSearchRank(joann, "ann").rank);
  assert.ok(peopleSearchRank(joann, "ann").rank < peopleSearchRank(hannah, "ann").rank);
});
await test("token matching finds a name in either order and with initials", () => {
  assert.equal(peopleSearchRank(ann, "Smith Ann").rank, 3);
  assert.equal(peopleSearchRank(ann, "S Ann").rank, 3);
  assert.equal(peopleSearchRank(ann, "A Smith").rank, 3);
  // "Ann S" is also a literal prefix of the stored name, so the prefix
  // rank claims it first. Either way it finds the same account.
  assert.ok(peopleSearchRank(ann, "Ann S").rank <= 3);
  assert.equal(peopleSearchRank(ann, "Bob Smith"), null);
});
await test("research interests match and are flagged as interest matches", () => {
  const hit = peopleSearchRank(ann, "sleep");
  assert.equal(hit.rank, 4);
  assert.equal(hit.matchedInterest, true);
  const byName = peopleSearchRank(ann, "ann");
  assert.equal(byName.matchedInterest, false);
});
await test("a non match returns null", () => {
  assert.equal(peopleSearchRank(ann, "zebra"), null);
});

// ══════════════════════════════════════════════════════════════════════
group("Client wiring pins");

const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/settings.jsx"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");

await test("the client strips the at sign before sending a people search", () => {
  assert.ok(appSrc.includes('query.trim().replace(/^@+/, "")'), "client query is not normalized");
});
await test("the profile header wires the avatar upload in edit mode", () => {
  assert.ok(appSrc.includes("onChange={handleAvatarFile}"), "file input is not wired to handleAvatarFile");
  assert.ok(appSrc.includes("avatarSaving"), "avatar saving state is not rendered");
  assert.ok(appSrc.includes("avatarError"), "avatar error state is not rendered");
});
await test("badges render once on your own profile", () => {
  const start = appSrc.indexOf("function ProfileView(");
  const end = appSrc.indexOf("function NetworkSearchModal", start);
  const seg = appSrc.slice(start, end);
  assert.ok(!seg.includes("Badge shelf"), "the duplicate badge shelf is still rendered");
  assert.ok(seg.includes("<ProfileMarkers"), "the single marker row is missing");
});
await test("no Follow button rides on a people search row, and no founder card is pinned", () => {
  const start = appSrc.indexOf("function NetworkSearchModal");
  const end = appSrc.indexOf("function PublicProfile", start);
  const seg = appSrc.slice(start, end);
  assert.ok(!seg.includes("cb-founder-card"), "the founder card is still in the results surface");
  assert.ok(!seg.includes("toggleFollow(r)"), "a row still carries a Follow toggle");
  assert.ok(seg.includes("r.canMessage"), "rows do not read the server may message flag");
  assert.ok(seg.includes("r.avatar_base64"), "rows do not render real avatars");
});
await test("the stale mock comment above NetworkSearchModal is gone", () => {
  const start = appSrc.indexOf("function NetworkSearchModal");
  const before = appSrc.slice(Math.max(0, start - 1200), start);
  assert.ok(!before.includes("mock roster"), "the stale mock comment is still there");
  assert.ok(before.includes("search users endpoint"), "the replacement comment does not describe the real endpoint");
});
await test("main.jsx dispatches the profile route into the app", () => {
  assert.ok(mainSrc.includes('kind === "profile"'), "Root does not handle the profile kind");
  assert.ok(mainSrc.includes("profileHandle={route.handle}"), "Root does not pass the handle into the app");
});
await test("settings copy matches the follower exception behavior", () => {
  assert.ok(settingsSrc.includes("People already following you keep seeing your profile"), "settings copy does not promise the follower exception");
  assert.ok(settingsSrc.includes("stops working for anyone who does not already follow you"), "settings copy does not scope the link behavior");
});

// ══════════════════════════════════════════════════════════════════════
group("Mobile audit items (October 23 mobile lane)");

await test("the public profile sheet has a visible close control, sheet corners, and swipe down dismissal", () => {
  const start = appSrc.indexOf("function PublicProfile");
  const end = appSrc.indexOf("/* Commit 100 — InstitutionModal is deleted.", start);
  const seg = appSrc.slice(start, end);
  assert.ok(seg.includes('aria-label="Close profile"'), "the sheet renders no visible close control");
  assert.ok(seg.includes("borderRadius: isMobile ? `${RADIUS.lg}px ${RADIUS.lg}px 0 0` : RADIUS.lg"), "the mobile sheet does not take the sheet corner form used by the other bottom sheets");
  assert.ok(seg.includes("onSheetTouchEnd"), "swipe down dismissal is not wired");
  assert.ok(seg.includes("dy > 90"), "the swipe threshold is missing");
  assert.ok(seg.includes("Block this person") && seg.includes("Report this person"), "block and report controls are missing from the public profile");
  assert.ok(seg.includes("Research interests"), "the public profile does not lead with research interests");
});
await test("people search does not auto focus on touch widths", () => {
  assert.ok(appSrc.includes("autoFocus={!peopleIsMobile}"), "the search field still auto focuses unconditionally");
  assert.ok(appSrc.includes("const peopleIsMobile = winW <= 900;"), "the mobile guard is missing");
});
await test("people rows protect the institution line and drop the follower count from the subtitle", () => {
  const start = appSrc.indexOf("function NetworkSearchModal");
  const end = appSrc.indexOf("function PublicProfile", start);
  const seg = appSrc.slice(start, end);
  assert.ok(seg.includes("const subtitle = [r.degree, r.affiliation].filter(Boolean).join"), "the subtitle still carries the follower count");
  assert.ok(seg.includes('overflowWrap: "anywhere"'), "the subtitle cannot wrap to a second line");
});
await test("own profile external links carry a 44 tall hit area", () => {
  const start = appSrc.indexOf("function ProfileView(");
  const end = appSrc.indexOf("function NetworkSearchModal", start);
  const seg = appSrc.slice(start, end);
  assert.ok(seg.includes('minHeight: 44, padding: "10px 2px"'), "the external links have no height floor");
  assert.ok(!seg.includes('role="tablist"'), "a duplicated workspace tab row survived on the profile");
});

// ══════════════════════════════════════════════════════════════════════
group("Functional: the real handler on an in memory database");

{
  const { DatabaseSync } = await import("node:sqlite");
  const { createHash } = await import("node:crypto");
  const { onRequest } = await import(join(root, "functions/api/data.js"));

  const sqlite = new DatabaseSync(":memory:");
  const wrapStmt = (sql) => {
    let vals = [];
    const stmt = {
      bind: (...v) => { vals = v; return stmt; },
      first: async () => { const r = sqlite.prepare(sql).get(...vals); return r === undefined ? null : r; },
      all: async () => ({ results: sqlite.prepare(sql).all(...vals) }),
      run: async () => { const info = sqlite.prepare(sql).run(...vals); return { success: true, meta: { changes: Number(info.changes || 0) } }; },
    };
    return stmt;
  };
  const db = {
    prepare: (sql) => wrapStmt(sql),
    exec: async (sql) => { sqlite.exec(sql); return { results: [] }; },
    batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
  const env = { DB: db };
  const tokenFor = { usr_seek: "token-seek", usr_other: "token-other" };
  const call = async (userId, method, path, body) => {
    const headers = {};
    if (userId) headers.Cookie = "cb_sess=" + tokenFor[userId];
    if (method === "POST") { headers["Content-Type"] = "application/json"; headers.Origin = "https://askcerebrum.org"; }
    const req = new Request("https://askcerebrum.org/api/data" + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const res = await onRequest({ request: req, env, waitUntil: () => {} });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, email_lower TEXT, username TEXT, name TEXT, affiliation TEXT, show_affiliation INTEGER, discoverable INTEGER, plan TEXT, created_at INTEGER)");
  sqlite.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER, expires_at INTEGER)");
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const now = Date.now();
  const seedUsers = [
    ["usr_seek", "seek@example.com", "seeker", "Seeker One"],
    ["usr_other", "other@example.com", "other", "Other One"],
    ["usr_ann", "ann@example.com", "asmith", "Ann Smith"],
    ["usr_belle", "belle@example.com", "annabelle", "Annabelle Lee"],
    ["usr_jo", "jo@example.com", "joann", "Jo Ann Park"],
    ["usr_han", "han@example.com", "hannah", "Hannah Reed"],
    ["usr_hid", "hid@example.com", "hidden1", "Hidden Person"],
  ];
  for (const [id, email, username, name] of seedUsers) {
    sqlite.prepare("INSERT INTO users (id, email, email_lower, username, name, show_affiliation, discoverable) VALUES (?, ?, ?, ?, ?, 1, 1)").run(id, email, email, username, name);
  }
  for (const [uid, tok] of Object.entries(tokenFor)) {
    sqlite.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash(tok), uid, now, now + 3600000);
  }
  // Warm up: the first call self creates the social tables and columns.
  await call("usr_seek", "GET", "?resource=inbox");
  const ins = (sql, ...v) => sqlite.prepare(sql).run(...v);
  ins("UPDATE users SET interests = ?, avatar_base64 = ? WHERE id = 'usr_ann'", JSON.stringify(["sleep medicine"]), "data:image/jpeg;base64,AAAA");
  ins("UPDATE users SET discoverable = 0 WHERE id = 'usr_hid'");
  // Ann follows the seeker, so the seeker may message her. Popularity is
  // stacked on Annabelle on purpose: ranking must ignore it.
  ins("INSERT INTO follows (follower_id, following_id, created_at) VALUES ('usr_ann', 'usr_seek', ?)", now);
  for (let i = 0; i < 5; i++) ins("INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, 'usr_belle', ?)", "fan" + i, now);
  // The seeker already follows the hidden account, and they already
  // have a thread together.
  ins("INSERT INTO follows (follower_id, following_id, created_at) VALUES ('usr_seek', 'usr_hid', ?)", now);
  ins("INSERT INTO threads (id, kind, name, created_at) VALUES ('th_hid', 'dm', NULL, ?)", now);
  ins("INSERT INTO thread_participants (thread_id, user_id) VALUES ('th_hid', 'usr_seek')");
  ins("INSERT INTO thread_participants (thread_id, user_id) VALUES ('th_hid', 'usr_hid')");

  await test("searching with the at sign finds the handle (Bug 1)", async () => {
    const res = await call("usr_seek", "GET", "?resource=search-users&q=" + encodeURIComponent("@asmith"));
    assert.equal(res.status, 200);
    assert.deepEqual((res.json.items || []).map((x) => x.id), ["usr_ann"]);
  });

  await test("ranking orders exact and prefix matches ahead of whole word and substring, ignoring follower counts (Bug 10)", async () => {
    const res = await call("usr_seek", "GET", "?resource=search-users&q=ann");
    const ids = (res.json.items || []).map((x) => x.id);
    assert.ok(ids.indexOf("usr_ann") !== -1 && ids.indexOf("usr_belle") !== -1, "prefix matches missing: " + ids.join(","));
    assert.ok(ids.indexOf("usr_ann") < ids.indexOf("usr_jo"), "whole word match outranks a prefix match: " + ids.join(","));
    assert.ok(ids.indexOf("usr_belle") < ids.indexOf("usr_jo"), "whole word match outranks Annabelle: " + ids.join(","));
    assert.ok(ids.indexOf("usr_jo") < ids.indexOf("usr_han"), "substring match outranks a whole word match: " + ids.join(","));
    const exact = await call("usr_seek", "GET", "?resource=search-users&q=asmith");
    assert.equal(exact.json.items[0].id, "usr_ann");
  });

  await test("token search finds a reversed name and a surname initial", async () => {
    const rev = await call("usr_seek", "GET", "?resource=search-users&q=" + encodeURIComponent("Smith Ann"));
    assert.ok((rev.json.items || []).some((x) => x.id === "usr_ann"), "reversed name did not match");
    const init = await call("usr_seek", "GET", "?resource=search-users&q=" + encodeURIComponent("Ann S"));
    assert.ok((init.json.items || []).some((x) => x.id === "usr_ann"), "surname initial did not match");
  });

  await test("rows carry the avatar, the interests, and an honest canMessage flag (Bugs 9 and 11)", async () => {
    const res = await call("usr_seek", "GET", "?resource=search-users&q=sleep");
    const annRow = (res.json.items || []).find((x) => x.id === "usr_ann");
    assert.ok(annRow, "the interest match did not return Ann");
    assert.equal(annRow.matchedInterest, true);
    assert.deepEqual(annRow.interests, ["sleep medicine"]);
    assert.equal(annRow.avatar_base64, "data:image/jpeg;base64,AAAA");
    assert.equal(annRow.canMessage, true, "Ann follows the seeker, so messaging should be allowed");
    const han = await call("usr_seek", "GET", "?resource=search-users&q=hannah");
    const hanRow = (han.json.items || []).find((x) => x.id === "usr_han");
    assert.ok(hanRow, "Hannah missing");
    assert.equal(hanRow.canMessage, false, "Hannah does not follow the seeker, so messaging should read as unavailable");
  });

  await test("the public profile returns research interests (Bug 9)", async () => {
    const res = await call("usr_seek", "GET", "?resource=public-profile&id=usr_ann");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.user.interests, ["sleep medicine"]);
    assert.equal(res.json.user.cover, undefined, "the dead cover field is still returned");
  });

  await test("a profile link resolves by handle for a signed out visitor, with interests", async () => {
    const res = await call(null, "GET", "?resource=public-profile&username=asmith");
    assert.equal(res.status, 200);
    assert.equal(res.json.limited, true);
    assert.equal(res.json.user.username, "asmith");
    assert.deepEqual(res.json.user.interests, ["sleep medicine"]);
    const hidden = await call(null, "GET", "?resource=public-profile&username=hidden1");
    assert.equal(hidden.status, 404, "a hidden account answered a signed out link");
  });

  await test("an existing follower still sees an opted out profile, and nobody else does (Bug 7)", async () => {
    const follower = await call("usr_seek", "GET", "?resource=public-profile&id=usr_hid");
    assert.equal(follower.status, 200, "the existing follower was shut out");
    const stranger = await call("usr_other", "GET", "?resource=public-profile&id=usr_hid");
    assert.equal(stranger.status, 404, "a non follower could see the hidden profile");
  });

  await test("an existing thread with an opted out account still opens (Bug 7)", async () => {
    const res = await call("usr_seek", "POST", "", { action: "start-thread", target_id: "usr_hid" });
    assert.equal(res.status, 200);
    assert.equal(res.json.thread_id, "th_hid");
    assert.equal(res.json.created, false);
    const fresh = await call("usr_other", "POST", "", { action: "start-thread", target_id: "usr_hid" });
    assert.equal(fresh.status, 404, "a stranger could open new contact with a hidden account");
  });

  await test("an existing follower can unfollow an opted out account, then is treated as a stranger (Bug 7)", async () => {
    const un = await call("usr_seek", "POST", "", { action: "toggle-follow", target_id: "usr_hid" });
    assert.equal(un.status, 200, "unfollowing a hidden account was refused");
    assert.equal(un.json.following, false);
    const again = await call("usr_seek", "POST", "", { action: "toggle-follow", target_id: "usr_hid" });
    assert.equal(again.status, 404, "a new follow of a hidden account was allowed");
    const profile = await call("usr_seek", "GET", "?resource=public-profile&id=usr_hid");
    assert.equal(profile.status, 404, "the former follower still sees the hidden profile");
  });
}

console.log(`\nprofiles-people: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
