# Video CDN — frontend find/replace map for `src/CerebrumApp.jsx`

**Owner: frontend worker. Do not apply until R2 upload is done and
spot-checked** (docs/video-cdn.md step 5). The build define
`__CB_VIDEO_CDN__` already exists in `vite.config.js`
(`VITE_VIDEO_CDN_BASE`, empty default = today's same-origin behavior), so
this map is safe to apply even before the CDN is live — with an empty base,
`videoUrl()` returns its input unchanged.

Hard boundary: the cinematic dark identity stays. This changes *where bytes
come from*, never the clips, grade, poster-first behavior, or VP9-first
rendition logic.

## 1. Add the helper (near the other film constants, ~line 4190)

```js
/* Video CDN base. Build-time VITE_VIDEO_CDN_BASE is baked into
   __CB_VIDEO_CDN__ (vite.config.js); window.__CB_VIDEO_CDN__ overrides it at
   runtime (handy for testing). Empty string = same-origin
   /assets/cinematic/ as today. See docs/video-cdn.md. */
function videoUrl(path) {
  const base =
    (typeof window !== "undefined" && window.__CB_VIDEO_CDN__) ||
    (typeof __CB_VIDEO_CDN__ !== "undefined" ? __CB_VIDEO_CDN__ : "") ||
    "";
  return base ? String(base).replace(/\/+$/, "") + path : path;
}
```

## 2. Wrap every cinematic clip literal (mechanical, ~51 sites)

Find (regex): `"/assets/cinematic/science-\d+\.mp4"`
Replace: `videoUrl("/assets/cinematic/science-NN.mp4")` — i.e. wrap the exact
original string, e.g.:

- `"…"/assets/cinematic/science-59.mp4", // Seedling planting…"` →
  `videoUrl("/assets/cinematic/science-59.mp4"), // Seedling planting…`

Sites: the `FILM_SCENES`-style clip arrays (~lines 4194–4288; every
`"/assets/cinematic/science-NN.mp4"` literal). Leave the trailing comments
(`// Seedling planting…`) in place.

Do NOT touch the `.webm` remap in `filmSrc()` (~line 4615): it rewrites the
already-resolved URL's extension, so it keeps working on CDN URLs unchanged.

## 3. Posters

- `filmPoster()` (~line 4584): change
  `return base ? "/assets/cinematic/posters/" + base + ".jpg" : FILM_POSTER;`
  to
  `return base ? videoUrl("/assets/cinematic/posters/" + base + ".jpg") : FILM_POSTER;`
- `FILM_POSTER` / the `"/assets/cinematic/poster.webp"` literal: wrap in
  `videoUrl(...)` the same way.

## 4. Lazy-load: gate the reel behind an IntersectionObserver

The film system already avoids fetching until a slot's turn
(`preload="none"` staging, poster-first paint, stall guards) — what it does
*not* do is wait for the film layer to be near the viewport before assigning
`src` at all. Add this at the CinematicFilm level (~line 4930):

1. In the effect that kicks off the first `slot.loadClip(...)` (~line 5067),
   wrap the initial load in an IntersectionObserver on the reel's container:
   - `rootMargin: "1200px 0px"` — start loading ~2 viewports before the film
     scrolls into view, so the poster→video fade is already warm on arrival.
   - On first intersect: `io.disconnect()` and run the existing initial
     `loadClip` + the warm `preloadClip` of the next clip (~line 5105).
   - Until then the layer shows only the poster div (already the designed
     first-paint state) — no `src` assigned, no bytes fetched.
2. Keep the existing `prefers-reduced-motion` / `filmOff` early-outs above the
   observer: when the film is off, don't even observe.
3. Document Mode's declarative `FilmLayer` usage (the `src` prop path,
   ~line 4818) already only mounts when Document Mode is open — no change
   needed there beyond the `videoUrl()` wrap, which is automatic since its
   `src` comes from the clip lists.
4. The `<video>` elements at ~lines 11322, 15173, 15281, 21368 are
   user/media-call/attachment surfaces, not cinematic clips — out of scope.

Net effect: on pages where the film is below the fold or disabled, zero
video bytes are requested; when it approaches the viewport, today's
poster-first, VP9-preferred, dip-free-dissolve behavior is unchanged.

## 5. Verify after applying

- `npm run build` green; `__CB_VIDEO_CDN__` present in the bundle.
- With `VITE_VIDEO_CDN_BASE=https://video-cdn.askcerebrum.org`:
  DevTools → Network → Media: requests go to the CDN host; posters too.
- With the env var empty: byte-identical behavior to today (same-origin).
- Reduced-motion + film-off paths still fetch nothing.
