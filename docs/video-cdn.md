# Cinematic video CDN migration (R2)

The cinematic library — 64 H.264 clips, 44 VP9 renditions, 65 poster stills,
~528MB under `public/assets/cinematic/` — currently ships inside every Pages
deploy because Vite copies `public/` verbatim into `dist/`. That makes the
site bundle ~538MB and burns bandwidth on every visitor, every deploy.

The fix moves the clips to Cloudflare R2 and serves them from a CDN base
URL. **The cinematic treatment itself does not change**: same clips, same
baked grade, same poster-first film layer, same VP9-first rendition logic.
Only where the bytes come from changes.

## Current status (2026-09-20)

- ✅ `scripts/migrate-videos-r2.mjs` — upload + manifest script, dry-run verified
- ✅ `scripts/video-cdn-manifest.json` — 173 old-path → CDN-URL mappings (generated with a placeholder base; regenerate after the real domain is chosen)
- ✅ `__CB_VIDEO_CDN__` build define in `vite.config.js` (env `VITE_VIDEO_CDN_BASE`, empty = same-origin as today)
- ✅ `docs/video-cdn-frontend-map.md` — exact find/replace the frontend worker applies in `src/CerebrumApp.jsx`
- ⏳ **Needs Dusty: run the migration with R2 credentials** (no Cloudflare token exists in this environment)

## Step-by-step (Dusty)

1. **Create the bucket** (once, interactive shell):
   ```
   npx wrangler r2 bucket create cerebrum-video
   ```
2. **Put a domain in front of it.** Two options:
   - *Recommended:* custom domain `video-cdn.askcerebrum.org` → R2 bucket
     (Cloudflare dashboard → R2 → bucket → Settings → Custom Domains). Free,
     same-network, no egress weirdness.
   - *Quick test:* the bucket's public `https://pub-<hash>.r2.dev` URL
     (R2 → bucket → Settings → Public access).
3. **Authenticate** on the machine that runs the upload:
   ```
   npx wrangler login
   ```
   or set `CLOUDFLARE_API_TOKEN` (needs R2 write scope).
4. **Upload** (~528MB, one time; idempotent, safe to rerun):
   ```
   R2_BUCKET=cerebrum-video \
   VIDEO_CDN_BASE=https://video-cdn.askcerebrum.org \
   node scripts/migrate-videos-r2.mjs --upload
   ```
   This rewrites `scripts/video-cdn-manifest.json` with the real base URL.
5. **Spot-check** before wiring the app:
   ```
   curl -sI https://video-cdn.askcerebrum.org/assets/cinematic/science-03.mp4 | head -5
   curl -sI https://video-cdn.askcerebrum.org/assets/cinematic/science-03.webm | head -5
   ```
   Expect `200`, `content-type: video/mp4` / `video/webm`, and `cf-cache-status`.
6. **Frontend worker** applies `docs/video-cdn-frontend-map.md` in
   `src/CerebrumApp.jsx` (wraps the clip literals in `videoUrl()`, adds the
   IntersectionObserver gate).
7. **Build with the base baked in:**
   ```
   VITE_VIDEO_CDN_BASE=https://video-cdn.askcerebrum.org npm run build
   ```
   (Runtime override also supported: `window.__CB_VIDEO_CDN__`.)
8. **Verify in production**: intro/intro-door film, home background reel, Pro
   reel, and Document Mode all play; DevTools Network shows video requests
   going to the CDN host, not `askcerebrum.org`.
9. **Only then** consider deleting `public/assets/cinematic/` from the repo
   (deploy drops ~528MB). Keep `manifest.json` (attribution) somewhere — e.g.
   move it to `docs/` — because the credits table in-app reads from it…
   (verify before deleting; grep for `cinematic/manifest.json` first).

## Rollback

Set `VITE_VIDEO_CDN_BASE` empty (or unset `window.__CB_VIDEO_CDN__`) and
rebuild — `videoUrl()` falls back to same-origin `/assets/cinematic/` paths,
which keep working as long as the local files are still in `public/`.

## CSP note

`media-src` in `public/_headers` already includes `https:`, so clips served
from any HTTPS CDN host are allowed with no header change. Posters load via
`img-src 'self' data: blob: https:` — also fine.
