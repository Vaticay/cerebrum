# Cerebrum Design Intelligence Report

**Date:** 2026-09-15
**Scope:** Research-only. No application code. Every section gives the technique, why it matters, the Cerebrum-specific direction, and a source URL.
**Stack:** React + Vite frontend, Cloudflare Pages Functions backend.
**Ground truth:** Dusty's iPhone. Nothing is "fixed" until the production SHA is serving and behavior is verified on device.

How to use this document: read §1 (tells) and §11 (typography) first — they are system-wide rules that touch every surface. Then work the blueprint at the end in priority order.

---

## 1. The specific "AI dashboard" visual tells — and how to kill them

### 1.1 What the data says

The strongest single source is `unslop-ui`, a scanner + skill grounded in an analysis of **47 subreddits / 3.2M posts** about what people flag as AI slop. Its findings, which match the practitioner consensus in the other sources:

- The tells are a *cluster*, not one choice: purple-to-blue gradients, Inter used with no brand-specific typographic decision, centered hero + three identical feature cards, untouched shadcn/Tailwind defaults, glassmorphism everywhere, sparkle badges, gradient headline text, emoji feature cards, redundant eyebrow/label/sublabel stacks, generic rounded-card grids with no information hierarchy.
- **Critical warning:** the 2026 tell is no longer just the purple gradient. It is a **warm cream background + serif display font (Instrument Serif, Fraunces) + sage/forest green accent** — the current Claude/Anthropic house style. Swapping purple for cream-and-serif is trading one default for another and gets clocked just as fast.
- A tell is an *unspecified default*, not a banned color. If Cerebrum genuinely chose purple, that is not slop — but the choice must be stated and traceable to a brand decision.
- The scanner deliberately does **not** flag: mesh/aurora/blob backgrounds (barely register as real complaints), bento grids and glassmorphism (low and contested), dark mode itself (only unprompted neon glow is a tell), shadcn/Tailwind themselves (only their *untouched defaults* are the tell).

### 1.2 Cerebrum-specific direction

1. **Adopt one deliberate visual system and state it in one paragraph** before any build: a named direction (e.g. "editorial dark, nature-documentary cinematic" — *not* "modern and clean"), one dominant color decision, one type decision (Dusty already fixed this: one unified typeface, no mixed fonts), and a layout intent per surface (what the user should do first determines structure). Structure follows the goal, never a template — this is what kills the hero+three-card skeleton.
2. **The fix is never "swap purple for green."** It is: one coherent type system, one grid, one dominant color with real contrast roles, deliberate information hierarchy, and a few purposeful motion moments. Defaults replaced with other defaults is not de-slopping.
3. **Audit mechanically, then by eye.** A scanner (like `devibe_scan.py`) catches color/font/gradient defaults, but not layout coherence, spacing consistency, or text overflowing its container — which is exactly where previous Cerebrum QA failed on iPhone (clipped tabs, overlapping pills, DOI overflow). Run the mechanical scan, then verify the layout by eye on device.
4. **Dusty's own taste overrides any playbook.** His promo cut uses typewriter reveals the generic advice would ban. The research informs; his stated preferences decide.

**Sources:**
- https://github.com/jcarterjohnson/vibecoded-design-tells/blob/HEAD/skill/SKILL.md
- https://github.com/funboy322/avoid-ai-design
- https://github.com/martinrossouw/taste-engine
- https://github.com/nawnie/aiwf_llm-skill-pack/blob/HEAD/skills/aiwf-avoid-ai-design/SKILL.md

---

## 2. Information architecture for a scientific research product

### 2.1 The principle: one question, one thread, one trail

A research tool is not a dashboard. Its IA is a **single thread of inquiry**: question → synthesized answer → verifiable evidence trail. Card-soup layouts (grids of equal-weight feature cards) fail because every item shouts at the same volume; a research product must instead give the user one clear path through increasing depth.

### 2.2 Techniques

- **Single-thread answer surface.** The answer is the page. Evidence (papers, excerpts, figures) is the secondary depth layer, reachable by scroll or tab — never a competing grid of widgets beside the answer.
- **Specimen-card hierarchy.** Answer, evidence, and bibliography each get a distinct visual treatment with clear rank (this is the direction of the earlier "specimen card" pass: corner ticks on answer/evidence/bibliography, bibliography index plates). The rank must be readable at a glance on a 360px phone.
- **Persistent bibliography, not a drawer that loses state.** Citations must remain reachable from the answer without losing reading position (§9 covers the 360px patterns).
- **Search is an instrument, not a pill bar.** Dusty explicitly rejected the old pill search bar ("tacky") and the QueryLens dial ("dislikes"), and ordered the search experience reimagined as something innovative and never-seen-before. The research finding: the search instrument should be *one* signature element, not three competing inputs. Whatever replaces it must be a single deliberate choice.
- **Intro is a ceremonial door — no search bar.** Standing rule. The intro establishes the nature-documentary register; the search instrument lives on the other side of it.

### 2.3 Cerebrum-specific direction

- Audit every surface against one question: *what should the user do first here?* Anything that doesn't serve that answer is demoted or removed. The Public Beta 1 QA already found ragged, overlapping chrome (sticky tab bars, floating sparkle buttons, cut-off copy buttons) — that is what "no information hierarchy" looks like in production.
- Avoid the generic research-dashboard trap: left nav rail + stat cards + "Recent searches" grid. If a surface looks like it could be swapped with any SaaS product without changing the labels, the IA is wrong.

**Open research gap:** direct competitive teardowns of Elicit, Consensus, Scite, and Semantic Scholar layouts, plus Hacker News / r/webdev / r/userexperience / Designer News threads on research-product IA, did not surface in this pass. Worth a dedicated teardown before finalizing the answer-thread IA.

---

## 3. Full-viewport video compositing + iPhone safe areas

### 3.1 The layer model (this is the fix for the current P0)

Cerebrum's signature is cinematic real footage behind the interface. The recurring defect class — *"Document Mode is just a grey background then a line of the video playing under it"* — is a compositing failure, not a video failure. The correct layer model:

1. **One background layer pinned to the viewport** — `position: fixed; inset: 0;` (or `position: absolute; inset: 0;` inside a full-height container), `overflow: hidden`. The video is a child of **this layer only**, with `width: 100%; height: 100%; object-fit: cover;` pinned to all four edges.
2. **Veil/scrim and content are sibling layers above it**, never opaque ancestors covering most of the video. A content panel with an opaque background that fills 90% of the screen turns the video into a strip — that is the current Document Mode bug.
3. **The video must never be a child of a content panel** whose height can collapse. If the video lives inside a section whose height is content-driven, any layout change collapses it into a strip or hides it. Viewport-sized background layers have exactly one job: fill the viewport.
4. **Poster beneath the video, always.** The poster is a complete visual fallback. Fade the video in only after usable media data exists (`canplay`/`canplaythrough`); never show an empty gray loading plane.
5. **Pause outgoing/offscreen video after crossfades** to cut battery and decoder cost.

### 3.2 Viewport units and safe areas on iOS

- **Never `100vh` for full-screen mobile surfaces.** Per MDN it currently resolves to the large viewport, so the hero overflows when Safari chrome is visible. Rules from practitioner sources:
  - `100svh` — guaranteed-fit full-screen sections (hero/intro door).
  - `100dvh` — containers that should adapt as chrome collapses (sheets, full-bleed dialogs). Do not use `dvh` for internal element sizing — it causes jitter.
  - `100lvh` — modal max-height when you want the maximum available space.
  - Fallback pattern for older browsers: declare the new unit first, then `100vh`, so unsupported browsers use the fallback.
- **Safe areas require two things together:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` **and** `env(safe-area-inset-*)` padding on every edge-touching surface. Without `viewport-fit=cover`, the `env()` values are 0 on iOS. Pattern: `padding-bottom: calc(1rem + env(safe-area-inset-bottom));`. Use padding (not margin) on containers with backgrounds so the background reaches the screen edge while content stays safe.
- Debug landscape clipping: side padding must use `safe-area-inset-left/right` or the notch cuts text and buttons.

### 3.3 Cerebrum-specific direction

- Document Mode P0: rebuild the mode as viewport-pinned video layer + sibling scrim + sibling content column. The content column gets a *controlled, near-opaque* surface (see §4 on blur cost), not a full opaque panel, and the video layer is never nested inside content flow. Verify on Dusty's iPhone that the video fills the viewport behind the document — no gray plane, no strip.
- The intro door and every full-screen surface get the `svh`/`dvh` treatment with `100vh` fallback and the `viewport-fit=cover` + `env()` pairing audited surface by surface.

**Sources:**
- https://dev.to/ziratsu/add-a-video-background-in-htmlcss-2l0e
- https://www.cssscript.com/lazy-load-video-background/
- https://gist.github.com/julienchazal/7aaaa329df8fbd28dc1f
- https://github.com/eraoutfitters/eraoutfitters.github.io/commit/c6d4b3a4f15276912cb9372c5ccd97352f978332
- https://github.com/coastdigitalgroup/coastai-skills/blob/HEAD/./website-development/mobile-viewport-implementation/SKILL.md
- https://webdesign.tutsplus.com/learn-these-viewport-relative-css-units-100vh-100dvh-100lvh-100svh--cms-108537t
- https://github.com/frvnkfrmchicago/skills-library-v2/blob/HEAD/.claude/skills/mobile-first-enforcing/SKILL.md
- https://github.com/impertio-studio/frontend-design-claude-skill-package/blob/HEAD/skills/source/frontend-errors/frontend-errors-units-rendering-viewport/SKILL.md
- https://github.com/nexuslabs-ai/nexus/issues/105
- https://web.dev/blog/viewport-units
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length

---

## 4. GPU / compositing performance rules

### 4.1 The rules

1. **Animate `transform` and `opacity` only** for interactive motion. Never animate layout properties (width, height, top/left, margin). A documented iOS Safari case study showed ~0.5s modal-close lag from full-screen blur teardown alone.
2. **Never `transition: all`.** It forces the browser to track every property and promotes layers unnecessarily.
3. **`backdrop-filter` over fixed or scrolling content causes continuous recompositing, especially on iOS.** On mobile, replace repeated glass layers with near-opaque surfaces and a single controlled veil. This is the direct fix for "glassmorphism everywhere" — it is both a visual tell (§1) and a performance defect.
4. **`will-change` is temporary and targeted.** Promote the layer right before the animation, remove it after. Too many promoted full-screen layers exhaust mobile GPU memory.
5. **Never read layout inside animation frames.** Cache geometry; recompute only at controlled resize/layout events.
6. **Stop animation loops when `document.hidden`.** Respect `visibilitychange` for every rAF loop, orbit, and video crossfade timer.
7. **Mobile budgets (practitioner targets):** JS bundle < 100KB gzip (mobile parses JS 3–5× slower), first-load page weight < 500KB, CLS < 0.1, lazy-load images < 200KB each, FCP < 2.5s / TTI < 3.5s on 4G.

### 4.2 Cerebrum-specific direction

- Audit every `backdrop-filter` in the codebase; the standing direction is near-opaque surfaces + one veil on mobile. The full-screen blur on overlay open/close is the prime suspect for any iOS lag.
- The background video layer (§3) must be the *only* full-screen composited video; freeze/paused states and poster hold must not keep a decoder alive.
- The search instrument's orbit/ping/dot animations (comet orbit, sonar pings, working dots) run on `transform`/`opacity` only, pause when hidden, and pause entirely under reduced motion (§6).

**Sources:**
- https://github.com/boludo00/bookkeep/issues/36
- https://github.com/chaychun/playground/blob/HEAD/.claude/skills/animation-performance-tiers/SKILL.md
- https://github.com/eisseuropa/netsec.github.io/commit/63993ecd0d48a3d6721c7fd3d8e1557b688fa7d1
- https://github.com/khangnghiem/fast-draft/commit/bfde430dc7e5bff3befaa1b1e80d140d475e818a
- https://github.com/levy-street/world-of-claudecraft/pull/759
- https://github.com/frvnkfrmchicago/skills-library-v2/blob/HEAD/.claude/skills/mobile-first-enforcing/SKILL.md

---

## 5. Mobile Safari video behavior

### 5.1 The attribute + property matrix

For muted inline autoplay, **both** the DOM attributes and the JS properties must be set *before* calling `play()`:

- Attributes: `muted`, `autoplay`, `playsinline`, and legacy `webkit-playsinline`.
- Properties via ref: `video.muted = true; video.defaultMuted = true;` — in React, the JSX `muted` prop alone has proven unreliable in practitioner fixes; reinforce through a video ref before `play()`.

### 5.2 Failure handling

- **Handle rejected `play()` promises.** Low Power Mode can block autoplay even with everything set correctly — catch the rejection and settle on the poster, never on a blank layer or native play icon.
- **Stall guard:** if the video never reaches playable state, retain the poster or move to another source. Never expose a native play button over the cinematic surface.
- **Pause when hidden, resume carefully on foreground.** Hook `visibilitychange`; on return, re-run the muted-inline play sequence rather than assuming playback resumed.
- **Save-data / slow-connection behavior:** consider poster-only mode when `navigator.connection.saveData` is set or the effective connection type is poor. The poster must be good enough to carry the scene alone — it already is, by design (§3).
- **Codec/rendition note:** Cloudflare Pages rejects files over 25MiB; the earlier 4K re-encode pass had to shrink 14 videos back down. Keep every rendition under the limit with margin, and keep the VP9/H.264 ladder small enough that first load stays under the §4 weight budget.

### 5.3 Cerebrum-specific direction

- Every background video in the app (intro door, home, document mode, Pro reel) goes through one shared video-layer primitive that owns: muted-inline setup, ref-reinforced `muted`/`defaultMuted`, `play()` promise handling, stall guard, visibility pause/resume, poster-first fade-in. No ad-hoc `<video>` tags.
- Verify on Dusty's iPhone specifically under Low Power Mode — that is the case the attribute matrix alone doesn't cover.

**Sources:**
- https://github.com/K8Cill/safari-webkit-skill
- https://github.com/runpod-labs/wandler/commit/87a45c3a7ffdb810343821af6014523cc3b4dbd2
- https://github.com/eraoutfitters/eraoutfitters.github.io/commit/c6d4b3a4f15276912cb9372c5ccd97352f978332
- https://github.com/arnold-benzaie/digitalnova/commit/c52b672e03ee7f4e4372b611e735a293e0a88ef4
- https://github.com/wecr8/tendercells/commit/ab10635a989ecf7fad151b725684dcedfa7e454e

---

## 6. Premium reduced-motion alternatives

### 6.1 The principle

Reduced motion must **preserve information, feedback, and visual quality** — not strip the experience down to a gray box. The WCAG guidance and practitioner consensus:

| Instead of… | Use… |
|---|---|
| Spatial travel / parallax across the screen | Short opacity crossfades in place |
| Orbiting / looping loading motion | Discrete state changes + restrained progress indicators (step text, determinate bar) |
| Cinematic footage motion | Freeze on a selected poster frame — the *best* frame, deliberately chosen, not a random pause |
| Sweep/scan animations on the search instrument | Instant state change with a clear label ("Searching 15 databases…") |

- Preserve color, hierarchy, contrast, and texture under reduced motion. The reduced-motion experience should look *designed*, not disabled.
- Honor the OS `prefers-reduced-motion` setting **and** provide an in-product motion toggle — a premium research tool gives the user direct control.
- Never use motion as the only carrier of meaning (a spinner that is the only "working" signal is a failure under reduced motion; pair it with text).

### 6.2 Cerebrum-specific direction

- The intro door: under reduced motion, the cinematic sequence becomes a composed poster-frame reveal with a short crossfade — still dramatic, still nature-documentary, zero travel. Dusty rejected mouse-move parallax already; the reduced-motion path should never have had it anyway.
- The searching instrument (comet orbit, sonar pings, working dots): reduced-motion variant shows determinate progress text with real elapsed time (the AgentTrace direction already taken) instead of looping motion.
- All of this runs through the same primitives as §4's performance rules — pausing loops when hidden and under reduced motion is one code path.

**Sources:**
- https://adrianroselli.com/2018/12/toggling-animations-on-and-off-a-variation.html
- https://css-tricks.com/accessible-web-animation-the-wcag-on-animation-explained/?fbclid=IwAR1T8gPe9C6HVeIYSTvPrVZpB43p1NEieKeGxCquBCA_7u-hKp-rc2ZPDbc
- https://www.boia.org/blog/what-to-know-about-the-css-prefers-reduced-motion-feature
- https://www.w3.org/WAI/WCAG22/quickref/#qr-visual-audio-contrast

---

## 7. Dense technical / editorial content formatting

### 7.1 Typography system (also feeds §11)

- **One versatile family with real shipped weights and italics.** Dusty's standing rule: one unified typeface across the whole site. "Thicker text" (§11) is done with real weights, never shadows.
- **4–6 semantic text roles, not a dozen near-duplicate sizes.** A dense app needs: display, title, body, caption/meta, label/control, mono (data/DOI). Every size/weight choice maps to a role.
- **Measure:** sustained prose 45–75ch, ~65ch target on desktop. On 360px phones this is automatic if padding is sane — the failure mode is fixed-width cards that squeeze prose to 20ch.
- **Leading:** body 1.5–1.65; headings tighten toward 1.1–1.25.
- **Tracking:** display can tighten −0.01em to −0.03em; small caps and labels need positive tracking (+0.05em+). Do **not** over-track ordinary small body text — it makes mobile copy feel thin and scattered (directly fights the "thicker text" goal).

### 7.2 Citations and bibliography

- **Every claim traces to a paper you can open** (standing rule, Dusty's slogan-adjacent law). Citation treatment must make this *visible*: inline citation markers that jump to the bibliography entry, and bibliography entries that open the paper (DOI link) — not dead text.
- **Bibliography as index plates:** numbered, scannable entries with title, authors, venue, year, DOI — the earlier "bibliography index plates" direction. On 360px: stack fields, never truncate the DOI (§9), keep the open-paper action reachable.
- **No fabricated statistics, no fake UI, no inert controls** (standing rules). A citation count shown anywhere must equal the count of papers actually cited — the Wave-4 fix (all counts derive from the cited pool) is the model for every other count in the product.

### 7.3 Cerebrum-specific direction

- The answer thread is an editorial surface: lede → evidence → bibliography. Apply the 4–6 role scale ruthlessly; the previous answer-format defects (stray glyphs, repeated sentences, duplicate citations) were content-integrity bugs, but they *read* as typography bugs. Both get fixed in the same pass.

**Sources:**
- https://github.com/mrtimberme-bot/claude-library/blob/HEAD/skills/typography-expert/SKILL.md
- https://github.com/onewave-ai/claude-skills/blob/HEAD/typography-scale-builder/SKILL.md
- https://github.com/haslien/my-claude-skills/blob/HEAD/.claude/skills/typography/SKILL.md
- https://github.com/byhartvig/agent-skills-collection/blob/HEAD/development-and-testing/dembrandt-skills/modular-scale-typography/SKILL.md

---

## 8. Accessible modals and drawers

### 8.1 The contract (centralize on one primitive)

Stop repairing hand-built fixed panels. One overlay primitive owns this contract:

1. `role="dialog"` (or `alertdialog` for confirmations), `aria-modal="true"`, accessible title.
2. Initial focus into the dialog; Tab/Shift+Tab containment; Escape closes; focus restored to the trigger on close.
3. Background scroll lock — and when locking, **compensate for the removed scrollbar width** so desktop layout doesn't shift.
4. Only the topmost stacked overlay responds to Escape/focus.
5. Portal overlays **outside** application scroll/stacking contexts (React portal to `document.body`).

### 8.2 Mobile-specific

- **No full-screen backdrop blur on iOS** — a controlled dim layer is faster and visually sufficient (§4). This is also the fix for the ~0.5s modal-close lag case study.
- Bottom sheets on mobile: container sized with `dvh`, sticky internals with `svh`, safe-area padding via `env()` (§3). Internal elements never sized in `dvh` (jitter).
- Sheet/dialog max-height in `lvh` to use the full space when chrome is hidden; test on a real iPhone — simulators don't replicate chrome-collapse behavior.

### 8.3 Cerebrum-specific direction

- The existing overlay audit (answer thread, search home, flowchart studio, shared modal system, document mode — revamp priority order already established) converges on the single primitive. Drawers that currently lose scroll position or trap focus get deleted, not patched.

**Sources:**
- https://github.com/legioncodeinc/that-git-life/blob/HEAD/.claude/skills/modal-toast-dialog-stinger/SKILL.md
- https://github.com/aakif-kohari/openprep-ai/commit/e13c1f709a4d570917c2c1433814d6de3418c59f
- https://github.com/kea0811/headless-modal
- https://github.com/khushi897920-lang/hercycle-ai/issues/493
- https://github.com/deen-bridge/dnb-frontend/issues/82
- https://github.com/nexuslabs-ai/nexus/issues/105

---

## 9. Responsive document readers at 360px

### 9.1 Patterns

- **Continuous scroll beats pagination on phones.** PDF readers that force page-flip on a 360px screen fail; the winning mobile pattern (Adobe's Liquid Mode research) is **reflow**: extract the text layer and re-lay it as continuous, phone-width prose — "calm technology" that operates on the periphery instead of demanding pinch-zoom gymnastics.
- **Reflow vs. fidelity is a deliberate choice.** For Cerebrum's document reads (research papers, user uploads): default to reflowed reading text at phone width; offer the original page view as a secondary mode for figures/tables. Never ship *only* a shrunken page canvas that requires horizontal scrolling.
- **Toolbar discipline:** reader chrome (back, title, page/progress, actions) must collapse to one compact bar; secondary actions go in an overflow menu. Minimum touch target ~44px with spacing; thumb-zone for primary actions.
- **Typography in the reader** follows §7: 45–75ch is automatic at 360px with sane padding; body 1.5–1.65 leading; real weights (§11). Respect OS text scaling / 200% browser zoom without clipping or overlap — record as an accessibility acceptance criterion.
- **No horizontal page scrolling for normal controls**; long content wraps without covering controls or losing data; `img, video, table, pre { max-width: 100% }`; wide tables get an explicit pattern (stack-to-cards, horizontal scroll with frozen key column, or priority-column collapse).
- **Inputs:** `font-size ≥ 16px` on all reader inputs/search fields — anything smaller triggers iOS focus zoom, which breaks the reader layout.

### 9.2 Cerebrum-specific direction

- Document Mode is the P0 that combines §3 (video strip defect), §9 (reader patterns), and §11 (thicker text). The repaired mode: viewport video layer behind (§3), reflowed document text as the primary 360px reading surface, one compact reader toolbar with safe-area padding, 16px+ input text, 44px targets.
- The "line of video playing under a gray background" defect dies in the same pass as the reader reflow — both come from the same layer-model fix.

**Sources:**
- https://blog.adobe.com/en/publish/2020/10/12/making-pdfs-mobile-friendly-ai-powered-liquid-mode
- https://www.foleon.com/knowledge/all-about-responsive-design
- https://github.com/steilerdev/cornerstone/issues/360
- https://www.ghacks.net/2014/06/20/improve-readability-pdf-documents-mobile-readers/
- https://github.com/modernnomad-98/project-aegis/blob/HEAD/./.claude/skills/mobile-viewport-craft/SKILL.md
- https://github.com/frvnkfrmchicago/skills-library-v2/blob/HEAD/.claude/skills/mobile-first-enforcing/SKILL.md

---

## 10. Free / Lite / Pro differentiation and upgrade UX

### 10.1 Current tier facts (2026-09-15, do not invent beyond this)

| | Free | Pro Lite — $3.99/mo (approved, not yet built) | Pro — $20/mo or $144/yr |
|---|---|---|---|
| AI answers | 15 per 5-day period | 150 per 5-day period | Unlimited |
| Document reads | 3 per 5-day period | 30 per 5-day period | Unlimited |
| Flowcharts | 1 per 5-day period | 10 per 5-day period | Unlimited |
| Badge / theme / exclusive reel | — | None (no full Pro badge, theme, or reel) | Full Pro badge, theme, exclusive reel |

No annual Lite pricing was chosen. No student promo (canceled by Dusty).

### 10.2 Freemium techniques from the research

1. **Free must demonstrate core value, not behave like a damaged demo.** The free tier's job is to let the user feel the "world behind your question" — caps gate *volume*, never quality of the answer.
2. **Premium capabilities stay visible in the workflow** but never interrupt before the user understands the product. No paywall on first run; no generic nag on load.
3. **Trigger upgrade messaging at genuine need:** (a) usage crosses a warning threshold (~80%), (b) the user attempts a specific capped action, (c) usage is exhausted. Repetitive generic nags train users to dismiss all promotion — one clear, contextual prompt beats five banners.
4. **The Usage tab is the conversion surface.** It must show: exact consumption per capability, remaining capacity, refill time (the 5-day grid: `periodKey()`/`quotaResetsInMs()` already exist in the codebase), and the next tier's *concrete gain* ("Pro Lite gives you 150 answers per 5 days — 10× your current limit").
5. **Frame the tiers as capacity, not punishment.** Pro Lite = capacity (10× free). Pro = the premium unlimited experience with badge, theme, and reel. The upgrade copy sells *more of what the user already loves*, not the removal of an annoyance.
6. **Exhaustion UX:** when a cap hits, the message states what ran out, when it refills, and the one-tap upgrade — then gets out of the way. Never a dead-end screen; the user's existing work (answer thread, documents) stays readable.

### 10.3 Cerebrum-specific direction

- The Usage tab was left incomplete in the quota-grid work — it is the highest-value UI in this section. Design it around all three tiers with exact numbers, refill countdown, and the concrete Lite/Pro gains.
- Upgrade entry points: Usage tab (primary), threshold warning (secondary), exhaustion moment (tertiary). Nowhere else. No banner on the intro door, no interruption of the first search.
- Atomic quota authorization (still unresolved in the backend work) must land before any of this UI is called done — the UI must never show a number the backend can't enforce.

**Sources:**
- https://www.revenuecat.com/blog/growth/freemium-tier-design
- https://Www.appcues.com/blog/free-to-paid-conversion
- https://cxl.com/blog/freemium-conversions/
- https://www.surfe.com/glossary/freemium-model/

---

## 11. Thicker, more substantial mobile typography

### 11.1 The technique (Dusty's "make all the text a lil thicker")

1. **Real font-weight roles, never text shadows or strokes.** Text-shadow "bolding" blurs on iOS and reads as a rendering bug. Assign roles:
   - Body: **450–500** (if the variable font supports it; otherwise 500 static)
   - Controls / labels / buttons: **600**
   - Strong headings: **650–700**
   - Never 300–400 body text over moving footage — low-contrast thin text on video is unreadable and looks broken.
2. **Ship the actual weight files.** A documented iOS Safari failure mode: CSS asks for 600 but only 400 is loaded, so Safari synthesizes faux-bold — and Safari's faux-bold renders differently from Chrome's, producing the "weights way off on iPhone" bug class. If the design calls for 600, the 600 file (or a variable font covering the range) must be in the bundle. Test on a real iPhone, not just desktop Safari.
3. **Rendering flags:** prefer grayscale antialiasing on high-DPI (`-webkit-font-smoothing: antialiased`) for UI text; avoid `subpixel-antialiased` overrides that fight the OS. `text-rendering: optimizeLegibility` is fine for headings, but it can cost performance on long body text — keep it off the reflowed document body (§9).
4. **Don't fight weight with tracking.** Over-tracked small body text (positive letter-spacing on ordinary prose) makes mobile copy feel thin and scattered — the opposite of the goal. Positive tracking is for labels/small-caps only (§7).
5. **Contrast is thickness.** On video backgrounds, a controlled scrim/veil (§3) does more for perceived weight than any font-weight bump. Thin text fails on footage because of contrast, not glyphs.

### 11.2 Cerebrum-specific direction

- One unified typeface (standing rule) with a real weight axis; audit every text style against the role table above. The Public Beta 1 QA's ragged, clipped text gets fixed in the same pass — thickness without layout correctness still reads as slop.
- Over video: no 300/400 text, scrim tuned per scene, weight roles hold.

**Sources:**
- https://theme.co/forum/t/font-weights-and-letter-spacing-way-off-on-ios-safari-and-chrome/70670
- https://community.shopify.com/c/shopify-design/font-not-rendering-properly-on-on-safari-iphone/m-p/2621582
- https://blog.csdn.net/AirDroid_cn/article/details/155563253
- https://github.com/mrtimberme-bot/claude-library/blob/HEAD/skills/typography-expert/SKILL.md

---

## 12. Prioritized modernization blueprint

### P0 — Defect repairs (before any aesthetic release)

1. **Document Mode video-strip defect.** Rebuild on the §3 layer model: viewport-pinned video layer, sibling scrim, sibling content column. No gray loading plane (poster-first). Verify on Dusty's iPhone.
2. **Stray `}` parser warning near `src/CerebrumApp.jsx:5595`.** Confirm and remove; a parser-level warning in the main bundle is a ship-blocker.
3. **Prove the octopus clip is out of all rotations.** Regenerating its poster did not remove the video. Audit every rotation list; verify the clip (and any other removed footage) cannot play.
4. **Atomic quota authorization.** The UI must never display a quota number the backend can't enforce.

### P1 — System-level visual changes

5. **State the visual system in one paragraph** (§1.2) and apply it: one typeface, one color decision, one grid, 4–6 text roles, deliberate hierarchy. De-slop pass across all surfaces using the tell catalog (§1.1).
6. **Typography weight pass** (§11): real weight roles everywhere, actual weight files shipped, no thin text over footage.
7. **Overlay convergence** (§8): one primitive, iOS dim-layer instead of full-screen blur, `dvh`/`svh`/`lvh` + safe-area audit per surface.
8. **Video-layer primitive** (§3 + §5): one shared component owning muted-inline setup, `play()` promise handling, stall guard, visibility pause/resume, poster-first fade-in. Delete ad-hoc `<video>` tags.

### P2 — Surface work

9. **Document Mode reader** (§9): reflowed reading surface at 360px, compact toolbar, 44px targets, 16px inputs, original-page mode for figures.
10. **Answer thread editorial pass** (§7): lede → evidence → bibliography hierarchy, index-plate bibliography, citation counts that equal cited papers.
11. **Usage tab + tier UX** (§10): exact consumption, refill countdown on the 5-day grid, concrete Lite/Pro gains, three upgrade entry points only.
12. **Search instrument reimagining** (§2.2): one signature element replacing the rejected pill bar and dial — a deliberate choice, stated.

### P3 — Motion and polish

13. **Reduced-motion variants** (§6) for intro door, search instrument, and video crossfades + in-product motion toggle.
14. **Performance audit** (§4): kill `transition: all`, audit every `backdrop-filter`, temporary `will-change`, no layout reads in rAF, loops stop when hidden.

### Verification matrix (nothing is "done" until)

- [ ] Production SHA serving the change (version.json), not just pushed.
- [ ] Dusty's iPhone: Document Mode fills viewport with video, no gray plane, no strip — including Low Power Mode.
- [ ] iPhone: no clipped tabs, overlapping pills, DOI overflow, or cut-off buttons at 360px.
- [ ] iPhone: overlays open/close with no ~0.5s lag; focus trap + Escape + scroll lock verified.
- [ ] Usage tab numbers match `/api/pro` quota data exactly; refill countdown correct on the 5-day grid.
- [ ] Reduced-motion OS setting + in-product toggle both produce the designed fallbacks.
- [ ] Never "100% bug-free." "Zero known defects" only after clean audits with limitations stated.

---

## Open research gaps (for a follow-up pass)

- Direct teardowns of Elicit / Consensus / Scite / Semantic Scholar IA.
- Hacker News, r/webdev, r/userexperience, Designer News threads on research-product and premium-app design.
- Linear / Raycast / Vercel engineering design material on dense interfaces (requested; not yet sourced).
- Stronger primary sources for GPU/compositor behavior beyond practitioner case studies.
- Practical free/Lite/Pro comparison-table and Usage-tab examples from shipping products.
