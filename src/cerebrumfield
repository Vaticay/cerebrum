/**
 * The Cerebrum interference field.
 *
 * One renderer for both signature visuals. The background and the core are not
 * two effects that happen to sit on the same screen — they are the same
 * material, drawn by the same shader, in one WebGL context. The core is a
 * region of the field where the contours fold inward and light collects; move
 * the core and the background reorganises around it, because they are computed
 * together.
 *
 * WHAT REPLACED WHAT
 * There used to be two independent OGL renderers: `Orb` on the intro screen
 * and `SoftAurora` in the application, each with its own context, its own
 * shader, its own RAF loop and its own hardcoded colour pair — SoftAurora's
 * blue/green was fixed in the markup and ignored the accent the user had
 * chosen entirely. Neither stopped rendering when the tab was hidden. This is
 * one context, accent-driven, that stops when nobody is looking at it.
 *
 * THE VISUAL IDEA
 * Interference. Three smooth procedural fields at different scales and drift
 * rates are summed; contours are extracted from the sum with a derivative-
 * aware band function, so the lines stay one pixel wide at any zoom and never
 * alias into moiré. Where the summed gradient is shallow the contours spread
 * out and the surface goes quiet; where fields cancel, ridges form and light
 * collects along them. That is genuinely how an interference pattern behaves,
 * which is why it reads as an imaging surface rather than as decoration.
 *
 * HONESTY
 * The field is decorative. It is not derived from search results, model state,
 * confidence, or anything a paper says. The only application data that reaches
 * it is: the accent colour, a coarse mode (arrival / ambient / reading), and a
 * single `energy` value that rises while a request is genuinely in flight and
 * falls when it completes. Nothing here should ever be described to a user as
 * data.
 */

/* Two GLSL versions, built from one body.
 *
 * The contour function depends on screen-space derivatives (fwidth/dFdx), and
 * those are reached differently depending on the context:
 *
 *   WebGL1 — GLSL ES 1.00 plus `#extension GL_OES_standard_derivatives`
 *   WebGL2 — GLSL ES 3.00, where they are core; the ES 1.00 extension is
 *            REJECTED on a WebGL2 context ("extension is not supported"),
 *            so the 1.00 shader cannot simply be reused there
 *
 * Getting this wrong is quiet: the shader fails to compile, OGL's Program
 * throws somewhere unrelated, and the canvas paints one flat colour that looks
 * like a design decision. Hence the explicit compile check in createField.
 *
 * The only syntactic differences that matter here are attribute/varying
 * keywords and the fragment output, so the shared body is written once with
 * two small prologues rather than maintained twice. */
const VERT_100 = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const VERT_300 = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

/* The fragment shader.
 *
 * Kept deliberately compact: every additional octave costs fill rate on the
 * integrated GPUs most people are using, and the composition here comes from
 * the relationship between three fields rather than from piling on detail.
 */
/* The fragment shader body. The `#extension` line is prepended at runtime,
 * not written here: fwidth/dFdx/dFdy are core in WebGL2 (GLSL ES 3.00 and the
 * WebGL2 GLSL ES 1.00 profile) but require an explicit extension directive in
 * WebGL1, and declaring the extension on a context that already has the
 * feature is itself an error on some drivers. This was the bug that made the
 * whole field render as one flat colour: the extension was enabled on the JS
 * side, the directive was missing from the source, the shader failed to
 * compile, and OGL's Program.use() then threw on an undefined uniform list —
 * which surfaces as an error about `forEach`, nowhere near the real cause. */
const FRAG_BODY = `
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uAccent;      // the user's chosen accent, linearised
uniform vec3  uDeep;        // background base
uniform vec2  uPointer;     // damped, -1..1, already smoothed on the CPU
uniform float uEnergy;      // 0..1, real request state only
uniform float uMode;        // 0 = arrival, 1 = ambient, 2 = reading
uniform float uCore;        // 0..1 core presence
uniform vec2  uCorePos;     // core centre in clip space
uniform float uCoreScale;
uniform float uQuality;     // 0..1, lowered on slow devices
uniform float uLight;       // 1.0 when the palette is light

// ── Smooth value noise. Cheap, and smooth enough that contours drawn from
// it never show the grid of the lattice underneath.
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i + vec2(0,0)), f - vec2(0,0)),
                 dot(hash2(i + vec2(1,0)), f - vec2(1,0)), u.x),
             mix(dot(hash2(i + vec2(0,1)), f - vec2(0,1)),
                 dot(hash2(i + vec2(1,1)), f - vec2(1,1)), u.x), u.y);
}

// Domain-warped field. The warp is what turns concentric rings into the
// folded, sculptural shapes the brief asks for.
float field(vec2 p, float t, float freq) {
  vec2 w = vec2(noise(p * 0.6 + t * 0.05), noise(p * 0.6 - t * 0.04));
  p += w * 0.8;
  return noise(p * freq + vec2(0.0, t * 0.03));
}

// Derivative-aware contour band. fwidth keeps the line a constant width in
// screen space however steep the field is, which is what prevents the dense
// repeating lines and shimmer that a naive sin() banding produces.
float contour(float v, float spacing, float weight) {
  float f = v * spacing;
  float d = abs(fract(f) - 0.5);
  float w = fwidth(f) * weight;
  return 1.0 - smoothstep(0.0, w, d);
}

/* The core.
 *
 * The first version blended three metaballs with a large smoothing constant
 * and produced exactly what the brief rules out: a sphere. Roundness is what
 * a smooth union converges to, so the asymmetry has to survive the blend
 * rather than be added on top of it.
 *
 * Three changes give it structure. The whole shape is sheared and squashed
 * before any distance is measured, so no lobe is circular to begin with. The
 * union constant is tightened, so the joins between lobes stay visible as
 * creases rather than melting into one bulge. And a fourth lobe is
 * SUBTRACTED, cutting a bite out of one side — that concavity is what makes
 * it read as a folded membrane rather than a blob, because nothing convex
 * ever looks folded.
 */
float coreShape(vec2 p, float t) {
  // Shear + squash. Applied to the domain, so it deforms every lobe at once.
  p = mat2(1.0, 0.22, -0.14, 0.86) * p;
  p.y *= 1.18;

  float a = length(p - vec2(sin(t * 0.21) * 0.05, cos(t * 0.17) * 0.04)) - 0.30;
  float b = length((p - vec2(0.15 + cos(t * 0.15) * 0.03, -0.11)) * vec2(1.0, 1.35)) - 0.19;
  float c = length((p - vec2(-0.14, 0.13 + sin(t * 0.19) * 0.03)) * vec2(1.3, 1.0)) - 0.16;

  float k = 0.075;   // tight: joins stay as creases
  float m = -log(exp(-a / k) + exp(-b / k) + exp(-c / k)) * k;

  // Concave bite. Smooth subtraction, offset and drifting slowly.
  float cut = length((p - vec2(0.30 + sin(t * 0.13) * 0.02, 0.23)) * vec2(1.0, 1.25)) - 0.15;
  float ks = 0.09;
  float h = clamp(0.5 - 0.5 * (m + cut) / ks, 0.0, 1.0);
  m = mix(m, -cut, h) + ks * h * (1.0 - h);

  return m;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag * 2.0 - uRes) / min(uRes.x, uRes.y);

  float t = uTime;
  // Pointer displacement: small, and applied to the FIELD rather than to
  // anything interactive. Already damped on the CPU, so this is a plain offset.
  vec2 pp = uv + uPointer * 0.055;

  // ── Three interfering fields at different scales and drift rates.
  float f1 = field(pp * 0.85, t * 0.55, 1.6);
  float f2 = field(pp * 1.45 + 4.0, -t * 0.38, 2.3);
  float f3 = uQuality > 0.5 ? field(pp * 2.7 - 2.0, t * 0.22, 3.1) : 0.0;

  // Interference. The subtraction is what creates cancellation ridges.
  float interf = f1 + f2 * 0.75 - f3 * 0.45;

  // ── Core.
  float core = 0.0, coreEdge = 0.0, coreInterior = 0.0;
  if (uCore > 0.001) {
    vec2 cp = (uv - uCorePos) / max(uCoreScale, 0.001);
    float d = coreShape(cp, t);
    core = smoothstep(0.02, -0.06, d);
    // A tight rim, not a halo. The wide smoothstep here read as a generic
    // soft glow around a shape; a narrow band reads as the edge of a
    // material, which is what the rest of the field is made of.
    coreEdge = (1.0 - smoothstep(0.0, 0.012, abs(d))) + (1.0 - smoothstep(0.0, 0.055, abs(d))) * 0.25;
    // Inside the core the same field is compressed and rotated slightly —
    // nested cross-sections through one material, not a different object.
    float ang = t * 0.06 + uEnergy * 0.9;
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 icp = rot * cp * 1.9;
    coreInterior = field(icp, t * (0.5 + uEnergy * 1.4), 2.6) + field(icp * 1.7, -t * 0.4, 3.4) * 0.6;
  }

  // ── Contours. Wider spacing in reading mode: the surface stays present but
  // stops competing with text.
  float modeQuiet = smoothstep(0.0, 2.0, uMode);
  float spacing = mix(7.0, 4.0, modeQuiet);
  float major = contour(interf, spacing, 1.4);
  float minorAmt = (1.0 - modeQuiet) * (uQuality > 0.5 ? 1.0 : 0.0);
  float minor = contour(interf, spacing * 3.0, 1.1) * 0.28 * minorAmt;

  // Ridge light: where the field is flat, contours spread and light pools.
  float grad = length(vec2(dFdx(interf), dFdy(interf))) * 90.0;
  float ridge = exp(-grad * grad * 0.6);

  /* Negative space.
   *
   * The first version used a gentle smoothstep over a mid-frequency noise,
   * which left contours drawn more or less everywhere — an even topographic
   * map, which is closer to wallpaper than to an imaging surface. The brief
   * asks for a few luminous ridges and large quiet areas, and that requires
   * the mask to actually reach zero over big regions.
   *
   * Lower frequency (bigger regions), a much harder edge, and a floor of zero
   * rather than a dim grey. Roughly half the frame is now empty at any moment,
   * and the boundary drifts. */
  float quietRaw = noise(pp * 0.26 + vec2(t * 0.018, -t * 0.011));
  float quiet = smoothstep(-0.06, 0.34, quietRaw);
  // A second, larger mask so the quiet regions themselves vary in depth.
  quiet *= mix(0.55, 1.0, smoothstep(-0.35, 0.25, noise(pp * 0.13 - t * 0.008)));

  /* ── Composition ────────────────────────────────────────────────────
   *
   * Light is accumulated SEPARATELY from the ground, and only composited at
   * the very end. That ordering is what makes one shader work for both
   * polarities: every mask below attenuates "how much light collected here",
   * which is a quantity that means the same thing whether it will later be
   * added to a dark ground or subtracted from a pale one.
   *
   * Doing it the other way round — building a finished dark colour and then
   * inverting it — put the reading guard on the wrong side of the inversion,
   * so on a light palette the guard BRIGHTENED the centre of the screen
   * instead of quietening it, and washed a pale column straight through the
   * middle of the answer.
   */
  vec3 lightAccum = vec3(0.0);

  float lineAmt = (major + minor) * quiet;
  float energyLift = 0.6 + uEnergy * 0.6;

  // Contours, cooled slightly toward blue so the field reads as lit material
  // rather than a wash of the accent colour.
  vec3 lineCol = mix(uAccent, uAccent * 0.55 + vec3(0.10, 0.16, 0.26), 0.4);
  lightAccum += lineCol * lineAmt * 0.52 * energyLift * mix(0.4, 1.0, 1.0 - modeQuiet);

  // Ridge light, squared so it concentrates rather than hazing.
  lightAccum += uAccent * ridge * ridge * quiet * 0.30 * energyLift * (1.0 - modeQuiet * 0.55);

  // A few genuinely bright ridges, from only the flattest regions.
  float peak = smoothstep(0.72, 0.98, ridge) * quiet;
  lightAccum += mix(uAccent, vec3(0.9, 0.95, 1.0), 0.25) * peak * 0.42 * energyLift * (1.0 - modeQuiet * 0.7);

  // A cool counter-tone so empty regions have depth rather than being flat.
  lightAccum += vec3(0.05, 0.09, 0.16) * (1.0 - quiet) * 0.16;

  // ── Core ────────────────────────────────────────────────────────────
  float coreBody = 0.0;
  if (uCore > 0.001) {
    float ci = contour(coreInterior, 9.0, 1.3);
    vec3 interiorCol = mix(uAccent, vec3(0.85, 0.92, 1.0), 0.35);
    coreBody = core * uCore;
    lightAccum += interiorCol * ci * coreBody * 0.42 * (0.7 + uEnergy);   // folded membranes
    lightAccum += uAccent * coreEdge * uCore * 0.42;                      // rim
    lightAccum += interiorCol * pow(core, 3.0) * uCore * 0.10;            // interior bloom
  }

  /* ── Reading protection ──────────────────────────────────────────────
   * "Keep the brightest structures away from reading areas" is a constraint
   * to obey, not a hope. On arrival the headline is on the left, so the left
   * is damped and the core sits in the bright right. In reading mode the
   * answer runs down the middle, so the centre is damped instead.
   * Applied to the accumulated light, so it quietens the field in both
   * polarities. */
  float x01 = uv.x * 0.5 + 0.5;
  float arrivalGuard = mix(0.34, 1.0, smoothstep(0.30, 0.62, x01));
  float readingGuard = mix(0.42, 1.0, smoothstep(0.20, 0.46, abs(uv.x)));
  float guard = mix(arrivalGuard, readingGuard, smoothstep(0.0, 1.0, uMode));

  float vig = 1.0 - smoothstep(0.35, 1.5, length(uv * vec2(1.0, 1.25)));
  lightAccum *= guard * mix(0.6, 1.0, vig);

  // ── Ground, and the final composite ─────────────────────────────────
  vec3 col;
  if (uLight > 0.5) {
    /* Light palette: the same collected light becomes soft shadow on a pale
     * ground. Ridges read as creases in paper rather than as glow, which is
     * what a light scientific surface should look like. The accent tint is
     * preserved rather than being flattened to grey. */
    vec3 ground = vec3(0.955, 0.950, 0.940);
    float lum = dot(lightAccum, vec3(0.299, 0.587, 0.114));
    vec3 tint = lightAccum - vec3(lum);
    col = ground - vec3(lum) * 1.15 + tint * 0.5;
    col -= vec3(0.02, 0.02, 0.018) * coreBody;   // the core sits slightly deeper
  } else {
    col = uDeep;
    col += uDeep * noise(pp * 0.7 + t * 0.01) * 0.35;   // base tonal variation
    col = mix(col, col * 0.35, coreBody * 0.85);        // translucent core body
    col += lightAccum;
    col *= mix(0.74, 1.0, vig);
  }

  /* Back to sRGB. The accent and base tone are converted to linear on the way
   * in so that adding light behaves the way light behaves; the framebuffer is
   * sRGB, and writing linear values straight into it renders everything far
   * darker than intended — with a ground this dark, black. */
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));

  // Dither AFTER the encode, where banding actually happens.
  col += (hash2(frag).x) * 0.004;

  gl_FragColor = vec4(col, 1.0);
}
`;

/** sRGB hex → approximate linear RGB. Keeps the accent from washing out. */
function hexToLinear(hex, fallback = [0.15, 0.5, 0.85]) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return fallback;
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  if (c.some((n) => Number.isNaN(n))) return fallback;
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
}

const MODE_VALUE = { arrival: 0, ambient: 1, reading: 2 };

/**
 * Create the field.
 *
 * Returns a handle with `setState` and `destroy`. All continuous animation
 * state lives in this closure, never in React — the render loop must not cause
 * a re-render, and a component unmounting must not leave a GPU context behind.
 *
 * Resolves to `null` if WebGL is unavailable, so the caller can show the
 * static fallback rather than an empty box.
 */
export async function createField(canvas, initial = {}) {
  if (!canvas) return null;

  let ogl;
  try {
    ogl = await import("ogl");
  } catch {
    return null;
  }
  const { Renderer, Program, Mesh, Triangle } = ogl;

  let renderer, gl, program, mesh;
  try {
    renderer = new Renderer({
      canvas,
      alpha: false,
      antialias: false,        // the contour function is already analytically AA'd
      powerPreference: "low-power",
      // Cap DPR. A 3x retina phone rendering a fullscreen fragment shader at
      // native resolution is the fastest way to make a beautiful effect feel
      // broken, and the contours are resolution-independent by construction.
      dpr: Math.min(window.devicePixelRatio || 1, 1.75),
    });
    gl = renderer.gl;
    // Required for fwidth/dFdx in WebGL1. Without it the contour function
    // silently returns garbage on older devices rather than failing loudly.
    /* Enable derivatives before compiling anything that uses them. Under
     * WebGL1 this is mandatory; under WebGL2 the call is harmless and returns
     * null, which is why the result is only fatal on WebGL1. */
    const derivatives = gl.getExtension("OES_standard_derivatives");
    if (!renderer.isWebgl2 && !derivatives) return null;
  } catch {
    return null;
  }

  const state = {
    accent: initial.accent || "#2f7fe6",
    deep: initial.deep || "#0a1020",
    mode: initial.mode || "arrival",
    energy: 0,
    targetEnergy: 0,
    core: initial.core == null ? 1 : initial.core,
    targetCore: initial.core == null ? 1 : initial.core,
    corePos: initial.corePos || [0, 0],
    targetCorePos: initial.corePos || [0, 0],
    coreScale: initial.coreScale == null ? 1 : initial.coreScale,
    targetCoreScale: initial.coreScale == null ? 1 : initial.coreScale,
    quality: 1,
    paused: false,
    reducedMotion: false,
  };

  /* Compile-time feature detection, and a real error if it fails. A silently
   * broken shader is worse than no shader: the canvas paints one flat colour
   * and everything downstream behaves as though the visual is working. */
  /* The directive is prepended in BOTH contexts.
   *
   * The reasoning that it is unnecessary under WebGL2 is what broke this the
   * first time: OGL compiles GLSL ES 1.00 unless the source opens with
   * `#version 300 es`, and a WebGL2 driver running a 1.00 shader does not
   * reliably expose fwidth/dFdx without the directive — SwiftShader here does
   * not. `enable` on a known extension that is already present is a no-op, so
   * including it always is both correct and simpler than deciding. */
  const useV300 = !!renderer.isWebgl2;
  const fragmentSource = useV300
    ? "#version 300 es\nprecision highp float;\nout vec4 cbFragColor;\n#define gl_FragColor cbFragColor\n" + FRAG_BODY
    : "#extension GL_OES_standard_derivatives : enable\nprecision highp float;\n" + FRAG_BODY;
  const vertexSource = useV300 ? VERT_300 : VERT_100;

  const program_ = new Program(gl, {
    vertex: vertexSource,
    fragment: fragmentSource,
    uniforms: {
      uRes: { value: [1, 1] },
      uTime: { value: 0 },
      uAccent: { value: hexToLinear(state.accent) },
      uDeep: { value: hexToLinear(state.deep, [0.02, 0.04, 0.08]) },
      uPointer: { value: [0, 0] },
      uEnergy: { value: 0 },
      uMode: { value: MODE_VALUE[state.mode] ?? 0 },
      uCore: { value: state.core },
      uCorePos: { value: state.corePos.slice() },
      uCoreScale: { value: state.coreScale },
      uQuality: { value: 1 },
      uLight: { value: initial.light ? 1 : 0 },
    },
  });
  program = program_;

  // OGL compiles lazily and swallows the log; check it ourselves so a shader
  // problem becomes the static fallback rather than a blank rectangle.
  try {
    const fs = program.fragmentShader;
    if (fs && gl.getShaderParameter && !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Cerebrum field: fragment shader failed to compile\n" + gl.getShaderInfoLog(fs));
      return null;
    }
  } catch {}

  mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  // ── Pointer. Damped, fine-pointer only, never captured or transmitted.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const finePointer = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  function onPointerMove(e) {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = -((e.clientY / window.innerHeight) * 2 - 1);
  }
  if (finePointer) window.addEventListener("pointermove", onPointerMove, { passive: true });

  // ── Reduced motion, watched live rather than read once.
  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function applyMotionPreference() {
    state.reducedMotion = !!(motionQuery && motionQuery.matches);
  }
  applyMotionPreference();
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", applyMotionPreference);
    else if (motionQuery.addListener) motionQuery.addListener(applyMotionPreference);
  }

  // ── Size.
  /* Sizing.
   *
   * Two things fought here and produced a 300x150 canvas — the HTML default —
   * sitting invisibly in the corner:
   *
   * 1. `clientWidth` is 0 until the element has been laid out, and this runs
   *    immediately after mount. Falling back to the viewport fixes that.
   * 2. OGL's setSize writes an INLINE style.width/height in pixels as well as
   *    the drawing-buffer size. That inline style beats the `width: 100%` in
   *    the component, so whatever value it was first given became permanent —
   *    and because the element then never changed size, the ResizeObserver
   *    had nothing to report and it stayed wrong forever.
   *
   * The viewport is the source of truth for the CSS size, and the inline
   * style OGL writes is overwritten straight afterwards. */
  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    program.uniforms.uRes.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  }
  // The canvas is position:fixed and always fills the viewport, so the thing
  // that changes size is the window, not the element.
  window.addEventListener("resize", resize);
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(document.documentElement);
  resize();

  // ── Visibility. Stop entirely when the tab is hidden or the canvas is
  // scrolled out of view; a fullscreen shader running behind another tab is
  // pure battery cost.
  let visible = true;
  function onVisibility() {
    visible = document.visibilityState === "visible";
    if (visible && !raf && !state.paused) start();
  }
  document.addEventListener("visibilitychange", onVisibility);

  const intersectionObserver = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        const onScreen = entries.some((e) => e.isIntersecting);
        visible = onScreen && document.visibilityState === "visible";
        if (visible && !raf && !state.paused) start();
      }, { threshold: 0 })
    : null;
  if (intersectionObserver) intersectionObserver.observe(canvas);

  // ── Context loss. Without these handlers a lost context leaves a black
  // rectangle and a RAF loop spinning on a dead GL object.
  let contextLost = false;
  function onContextLost(e) { e.preventDefault(); contextLost = true; stop(); }
  function onContextRestored() { contextLost = false; resize(); if (!state.paused) start(); }
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  // ── Adaptive quality, measured locally and never transmitted.
  let frames = 0, slowFrames = 0, lastFrame = performance.now();

  let raf = 0;
  let clock = 0;
  let last = performance.now();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible || contextLost) { cancelAnimationFrame(raf); raf = 0; return; }

    const dtRaw = now - last;
    last = now;
    // Clamp: a tab that was backgrounded returns with a huge delta, which
    // would otherwise jump the animation forward by seconds.
    const dt = Math.min(dtRaw, 50) / 1000;

    // Quality adaptation. Ten slow frames in the first sixty is enough signal
    // to drop the third octave and the minor contours; it never climbs back
    // up, because oscillating between quality levels is more distracting than
    // sitting at the lower one.
    if (frames < 60) {
      frames++;
      if (dtRaw > 26) slowFrames++;
      if (frames === 60 && slowFrames > 10) {
        state.quality = 0.4;
        program.uniforms.uQuality.value = 0.4;
      }
    }

    // Reduced motion freezes time but keeps the composition — the field is
    // still there, it simply stops moving.
    if (!state.reducedMotion) clock += dt;

    // Damping. Everything the application changes is eased here rather than
    // by GSAP, so a state change during a transition cannot fight an
    // in-flight tween.
    const ease = state.reducedMotion ? 1 : 1 - Math.pow(0.0015, dt);
    pointer.x += (pointer.tx - pointer.x) * ease * 0.6;
    pointer.y += (pointer.ty - pointer.y) * ease * 0.6;
    state.energy += (state.targetEnergy - state.energy) * ease * 0.5;
    state.core += (state.targetCore - state.core) * ease * 0.7;
    state.coreScale += (state.targetCoreScale - state.coreScale) * ease * 0.7;
    state.corePos[0] += (state.targetCorePos[0] - state.corePos[0]) * ease * 0.7;
    state.corePos[1] += (state.targetCorePos[1] - state.corePos[1]) * ease * 0.7;

    const u = program.uniforms;
    u.uTime.value = clock;
    u.uPointer.value = [pointer.x, pointer.y];
    u.uEnergy.value = state.energy;
    u.uCore.value = state.core;
    u.uCoreScale.value = state.coreScale;
    u.uCorePos.value = [state.corePos[0], state.corePos[1]];

    renderer.render({ scene: mesh });
  }

  function start() { if (!raf && !contextLost) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  start();

  return {
    /**
     * Update what the field is showing.
     *
     * `energy` must reflect real application state — a request actually in
     * flight — and nothing else. It is not a progress bar and must never be
     * driven by a timer pretending to be one.
     */
    setState(next = {}) {
      if (next.accent) {
        state.accent = next.accent;
        program.uniforms.uAccent.value = hexToLinear(next.accent);
      }
      if (next.deep) {
        state.deep = next.deep;
        program.uniforms.uDeep.value = hexToLinear(next.deep, [0.02, 0.04, 0.08]);
      }
      if (typeof next.light === "boolean") program.uniforms.uLight.value = next.light ? 1 : 0;
      if (next.mode && MODE_VALUE[next.mode] != null) {
        state.mode = next.mode;
        program.uniforms.uMode.value = MODE_VALUE[next.mode];
      }
      if (typeof next.energy === "number") state.targetEnergy = Math.max(0, Math.min(1, next.energy));
      if (typeof next.core === "number") state.targetCore = Math.max(0, Math.min(1, next.core));
      if (typeof next.coreScale === "number") state.targetCoreScale = next.coreScale;
      if (Array.isArray(next.corePos)) state.targetCorePos = [next.corePos[0], next.corePos[1]];
      if (typeof next.paused === "boolean") {
        state.paused = next.paused;
        if (next.paused) stop(); else start();
      }
    },

    /** Full teardown. Everything acquired above is released here. */
    destroy() {
      stop();
      if (finePointer) window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("resize", resize);
      if (resizeObserver) resizeObserver.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
      if (motionQuery) {
        if (motionQuery.removeEventListener) motionQuery.removeEventListener("change", applyMotionPreference);
        else if (motionQuery.removeListener) motionQuery.removeListener(applyMotionPreference);
      }
      try {
        // Explicitly drop the GPU context. Browsers cap the number of live
        // contexts per page, so leaking one on every navigation eventually
        // kills the effect for the rest of the session.
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch {}
      renderer = gl = program = mesh = null;
    },
  };
}

/**
 * The static fallback, as CSS.
 *
 * Used when WebGL is unavailable, when the shader fails to compile, or when
 * the user has asked for no animation at all. Built from the same palette and
 * roughly the same composition — a dark ground, an off-centre accent pool, a
 * quiet vignette — so the page still looks composed rather than looking like
 * the background failed to load.
 */
export function staticFieldCss(accent, deep, { core = true } = {}) {
  /* The first version of this was three low-alpha radial gradients, which on
   * a near-black ground rendered as near-black — a blank rectangle that read
   * as a failed load rather than as a deliberate design.
   *
   * This mirrors the live composition instead: quiet on the left where the
   * headline sits, light collecting on the right, an off-centre elliptical
   * core with a rim, and a cool counter-tone in the empty regions. Same
   * palette, same balance, no motion. */
  const layers = [
    // Core: an off-centre ellipse with a brighter rim, matching where the
    // live core sits on the arrival screen.
    core ? `radial-gradient(38% 30% at 72% 42%, ${accent}30 0%, ${accent}12 55%, transparent 72%)` : null,
    core ? `radial-gradient(40% 32% at 72% 42%, transparent 62%, ${accent}26 70%, transparent 78%)` : null,
    // Light collecting toward the right and lower right.
    `radial-gradient(70% 60% at 86% 62%, ${accent}1c 0%, transparent 62%)`,
    `radial-gradient(90% 70% at 62% 96%, ${accent}16 0%, transparent 60%)`,
    // Cool counter-tone in the quiet upper right.
    `radial-gradient(80% 70% at 88% 8%, rgba(120,160,220,0.10) 0%, transparent 60%)`,
    // Reading protection: damp the left, where the content is.
    `linear-gradient(90deg, ${deep}dd 0%, ${deep}66 34%, transparent 60%)`,
    // Vignette and base.
    `radial-gradient(140% 130% at 50% 45%, transparent 32%, ${deep}dd 100%)`,
    `linear-gradient(180deg, ${deep} 0%, ${deep} 100%)`,
  ].filter(Boolean);
  return layers.join(", ");
}
