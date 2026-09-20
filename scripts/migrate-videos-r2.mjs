/**
 * Migrate the cinematic video library to Cloudflare R2.
 *
 * THE PROBLEM
 * public/assets/cinematic/ holds 64 H.264 clips + 44 VP9 renditions + 65
 * poster stills (~529MB). Vite copies public/ verbatim into dist/, so every
 * Pages deploy ships the whole library inside the site bundle — the single
 * biggest bandwidth line on the project. The fix is to host the clips on R2
 * (cheap, cacheable, global) and serve them from a CDN base URL, while the
 * cinematic treatment itself stays exactly as designed (same clips, same
 * grade, same poster-first film layer — see docs/video-cdn-frontend-map.md
 * for the client-side half).
 *
 * USAGE
 *   # Dry run (default): validates env + files, writes the manifest, uploads nothing.
 *   node scripts/migrate-videos-r2.mjs
 *
 *   # Real upload (needs Cloudflare credentials — see below).
 *   node scripts/migrate-videos-r2.mjs --upload
 *
 * ENV
 *   R2_BUCKET        R2 bucket name (required). Create once:
 *                      npx wrangler r2 bucket create cerebrum-video
 *   R2_PREFIX        Key prefix inside the bucket (default: assets/cinematic).
 *   VIDEO_CDN_BASE   Public base URL the clips will be served from, no
 *                    trailing slash (required for the manifest), e.g.
 *                      https://video-cdn.askcerebrum.org
 *                    or the bucket's public r2.dev URL during testing.
 *                    This is the same value later baked into the app via
 *                    VITE_VIDEO_CDN_BASE at build time.
 *   CLOUDFLARE_API_TOKEN  API token with R2 write scope, or run `npx wrangler
 *                    login` once on the machine that does the upload.
 *
 * OUTPUT
 *   scripts/video-cdn-manifest.json — { oldPath: cdnUrl } for every clip,
 *   rendition and poster, plus the bucket/prefix/base it was built from.
 *   The frontend worker consumes it via docs/video-cdn-frontend-map.md.
 *
 * SAFETY
 *   - Never deletes or modifies anything under public/assets/cinematic/.
 *     The local copies stay until the CDN is verified serving, then removal
 *     is a deliberate follow-up (and a deploy-size win), not this script.
 *   - Uploads are idempotent: keys are content-stable filenames, so rerunning
 *     just overwrites the same objects.
 */

import { execFile } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CINEMATIC_DIR = join(root, "public/assets/cinematic");
const MANIFEST_PATH = join(here, "video-cdn-manifest.json");

const BUCKET = process.env.R2_BUCKET || "";
const PREFIX = (process.env.R2_PREFIX || "assets/cinematic").replace(/^\/+|\/+$/g, "");
const CDN_BASE = (process.env.VIDEO_CDN_BASE || "").replace(/\/+$/, "");
const DO_UPLOAD = process.argv.includes("--upload");

const MIME = { ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".webp": "image/webp" };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(" ")} failed:\n${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function collectFiles() {
  const files = [];
  async function walk(dir, rel) {
    for (const name of await readdir(dir)) {
      const full = join(dir, name);
      const key = rel ? `${rel}/${name}` : name;
      const st = await stat(full);
      if (st.isDirectory()) { await walk(full, key); continue; }
      if (/\.(mp4|webm|jpg|webp)$/i.test(name)) files.push({ full, key, bytes: st.size });
    }
  }
  await walk(CINEMATIC_DIR, "");
  files.sort((a, b) => a.key.localeCompare(b.key));
  return files;
}

async function preflight() {
  const problems = [];
  if (!BUCKET) problems.push("R2_BUCKET is not set (e.g. export R2_BUCKET=cerebrum-video).");
  if (!CDN_BASE) problems.push("VIDEO_CDN_BASE is not set (e.g. export VIDEO_CDN_BASE=https://video-cdn.askcerebrum.org).");
  try {
    await stat(CINEMATIC_DIR);
  } catch {
    problems.push(`Cinematic dir missing: ${CINEMATIC_DIR}.`);
  }
  if (DO_UPLOAD) {
    try {
      const out = await run("npx", ["wrangler", "r2", "bucket", "list"]);
      if (!out.split("\n").some((l) => l.trim() === BUCKET || l.includes(BUCKET))) {
        problems.push(`Bucket "${BUCKET}" not found via wrangler. Create it: npx wrangler r2 bucket create ${BUCKET}`);
      }
    } catch (e) {
      problems.push(
        "wrangler could not talk to Cloudflare. In a non-interactive shell set CLOUDFLARE_API_TOKEN " +
        "(https://developers.cloudflare.com/fundamentals/api/get-started/create-token/, needs R2 write scope), " +
        "or run `npx wrangler login` on an interactive machine.\n" + String(e.message).split("\n").slice(0, 4).join("\n")
      );
    }
  }
  if (problems.length) {
    console.error("migrate-videos-r2: cannot proceed:\n- " + problems.join("\n- "));
    process.exit(1);
  }
}

async function main() {
  await preflight();
  const files = await collectFiles();
  if (!files.length) {
    console.error("migrate-videos-r2: no video/poster files found — nothing to do.");
    process.exit(1);
  }
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  console.log(
    `migrate-videos-r2: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, ` +
    `bucket=${BUCKET} prefix=${PREFIX} base=${CDN_BASE} mode=${DO_UPLOAD ? "UPLOAD" : "dry-run"}`
  );

  const manifestFiles = {};
  const failures = [];
  let uploaded = 0;

  for (const f of files) {
    const r2Key = `${PREFIX}/${f.key}`;
    const cdnUrl = `${CDN_BASE}/${r2Key}`;
    const oldPath = `/assets/cinematic/${f.key}`;
    manifestFiles[oldPath] = cdnUrl;
    if (!DO_UPLOAD) continue;
    const ext = f.key.slice(f.key.lastIndexOf(".")).toLowerCase();
    const args = ["wrangler", "r2", "object", "put", `${BUCKET}/${r2Key}`, "--file", f.full, "--remote"];
    if (MIME[ext]) args.push("--content-type", MIME[ext]);
    try {
      await run("npx", args);
      uploaded++;
      if (uploaded % 10 === 0) console.log(`  …${uploaded}/${files.length} uploaded`);
    } catch (e) {
      failures.push({ key: r2Key, error: String(e.message).split("\n")[0] });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    bucket: BUCKET,
    prefix: PREFIX,
    cdnBase: CDN_BASE,
    uploaded: DO_UPLOAD,
    fileCount: files.length,
    totalBytes,
    files: manifestFiles,
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`migrate-videos-r2: manifest written → scripts/video-cdn-manifest.json (${files.length} mappings)`);

  if (!DO_UPLOAD) {
    console.log("migrate-videos-r2: dry run — nothing uploaded. Re-run with --upload once R2 credentials are available.");
    return;
  }
  console.log(`migrate-videos-r2: ${uploaded}/${files.length} objects uploaded.`);
  if (failures.length) {
    console.error(`migrate-videos-r2: ${failures.length} FAILED:`);
    for (const f of failures) console.error(`  - ${f.key}: ${f.error}`);
    process.exit(1);
  }
  console.log(
    "migrate-videos-r2: all uploads succeeded.\n" +
    "Next: 1) spot-check a URL with curl -sI, 2) set VITE_VIDEO_CDN_BASE=" + CDN_BASE +
    " and rebuild, 3) confirm the film plays from the CDN in production, 4) only then " +
    "consider removing public/assets/cinematic (see docs/video-cdn.md)."
  );
}

await main();
