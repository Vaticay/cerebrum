/* ── WaterCaustics: the searching water ─────────────────────────────────────
   The loading state for search, rebuilt as real-time water.

   The look: pool-bottom caustics — the interlocking web of light you see
   on the floor of a swimming pool. The technique is the classic iterative
   domain-warped caustic shader (Shadertoy "Seascape"-family / MdlXz8
   style): several iterations of
     p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x))
   with a 1.0/length(...) accumulation, then pow(abs(c), 8.0) to pull the
   sharp web lines out of the field. Three octaves at different
   scales/speeds layer the complexity; a slow Gerstner-style sum of
   directional waves perturbs the sampling domain so the web breathes
   instead of boiling; depth-based color (deep teal below, pale aqua above)
   makes it read as a volume of water, not a flat pattern.

   Tied to the search honestly:
   - `submersion` (0..1) deepens the water and builds caustic intensity.
     The caller drives it from elapsed time (capped — the client genuinely
     cannot know real per-database progress) plus real milestones. It is
     ambience, not a progress bar; the elapsed clock stays the signal.
   - `done` triggers the surfacing resolve: a bright breakthrough wash
     sweeps the frame as the answer arrives, then the loop parks — the
     answer is rendering and this unmounts.

   iPhone Safari is the target: WebGL1 only (no WebGL2 features), the
   warp loop is fixed at 4 iterations (a compile-time constant, as
   WebGL1 requires), and the canvas renders at 0.5x CSS resolution,
   upscaled by CSS. No textures, no extensions, no derivatives.

   Reduced motion: `reduced` renders exactly one still frame — no rAF
   loop, no animation. If WebGL is unavailable the component renders
   nothing and the DOM fallback (marine snow + reading line) carries the
   state, so a failed context never blanks the loading screen.

   The module is loaded lazily (React.lazy in CerebrumApp.jsx) so this
   chunk — and the GL context — only exists while a search is in flight,
   never on first paint of the search screen.
*/
import React, { useRef, useEffect } from "react";

const VERT_SRC = [
  "attribute vec2 a_pos;",
  "varying vec2 v_uv;",
  "void main() {",
  "  v_uv = a_pos * 0.5 + 0.5;",
  "  gl_Position = vec4(a_pos, 0.0, 1.0);",
  "}",
].join("\n");

const FRAG_SRC = [
  "precision highp float;",
  "varying vec2 v_uv;",
  "uniform vec2 u_res;",
  "uniform float u_time;",
  "uniform float u_sub;",
  "uniform float u_resolve;",
  "uniform vec3 u_accent;",
  "uniform float u_still;",
  "#define TAU 6.28318530718",
  "",
  "/* Iterative domain-warped caustics. The loop bound is a literal: WebGL1",
  "   requires constant loop indices, and 4 iterations keeps iPhone GPUs",
  "   comfortable at half resolution. */",
  "float caustic(vec2 uv, float t, float speed) {",
  "  vec2 p = mod(uv * TAU, TAU) - 250.0;",
  "  vec2 i = p;",
  "  float c = 1.0;",
  "  float inten = 0.005;",
  "  for (int n = 0; n < 4; n++) {",
  "    float tt = t * speed * (1.0 - (3.5 / float(n + 1)));",
  "    i = p + vec2(cos(tt - i.x) + sin(tt + i.y),",
  "                 sin(tt - i.y) + cos(tt + i.x));",
  "    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten),",
  "                            p.y / (cos(i.y + tt) / inten)));",
  "  }",
  "  c /= 4.0;",
  "  c = 1.17 - pow(c, 1.4);",
  "  return pow(abs(c), 8.0);",
  "}",
  "",
  "/* Slow Gerstner-style drift: summed directional waves perturbing the",
  "   sampling domain. */",
  "vec2 waterWarp(vec2 p, float t) {",
  "  vec2 w = vec2(0.0);",
  "  w.x += 0.045 * sin(p.y * 5.0 + t * 0.8) + 0.028 * sin((p.x + p.y) * 8.0 - t * 1.2);",
  "  w.y += 0.045 * cos(p.x * 4.0 - t * 0.6) + 0.028 * cos((p.x - p.y) * 7.0 + t * 1.0);",
  "  w += 0.014 * vec2(sin(p.y * 13.0 + t * 1.6), cos(p.x * 11.0 - t * 1.4));",
  "  return w;",
  "}",
  "",
  "float hash(vec2 p) {",
  "  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);",
  "}",
  "",
  "void main() {",
  "  vec2 uv = v_uv;",
  "  float aspect = u_res.x / max(u_res.y, 1.0);",
  "  vec2 p = vec2(uv.x * aspect, uv.y);",
  "  float t = u_time;",
  "",
  "  vec2 warp = waterWarp(p, t);",
  "  vec2 q = p + warp;",
  "",
  "  /* Three octaves of the web at different scales and speeds. */",
  "  float c1 = caustic(q, t, 1.0);",
  "  float c2 = caustic(q * 1.7 + vec2(3.1, 1.7) - warp * 1.4, t, 1.45);",
  "  float c3 = caustic(q * 2.9 + vec2(7.7, 5.3) + warp * 2.1, t, 0.7);",
  "  float web = min(c1 + 0.55 * c2 + 0.28 * c3, 4.0);",
  "",
  "  /* Water body: deep teal in the depths, pale aqua toward the light. */",
  "  float depth = 1.0 - uv.y;",
  "  vec3 deep = vec3(0.010, 0.078, 0.098);",
  "  vec3 mid  = vec3(0.024, 0.196, 0.224);",
  "  vec3 pale = vec3(0.200, 0.530, 0.505);",
  "  vec3 body = mix(pale, mix(mid, deep, smoothstep(0.25, 1.0, depth)),",
  "                  smoothstep(0.0, 0.55, depth));",
  "",
  "  /* Caustic light; intensity builds as the search soaks. */",
  "  float inten = 0.30 + 0.85 * u_sub;",
  "  vec3 light = vec3(0.55, 0.95, 0.90) * (web * inten)",
  "             + u_accent * (web * 0.38 * u_sub);",
  "",
  "  /* The surface: a bright band that starts above the frame and descends",
  "     as the search soaks — we are surfacing toward the answer. */",
  "  float surfY = mix(1.30, 0.10, u_sub);",
  "  float band = smoothstep(0.20, 0.0, abs(uv.y - surfY));",
  "  float shimmer = 0.5 + 0.5 * sin(p.x * 24.0 + t * 0.8 + sin(p.x * 7.0) * 2.0);",
  "  vec3 surfaceGlow = vec3(0.62, 0.94, 0.89) * band * (0.35 + 0.45 * shimmer * u_sub);",
  "",
  "  /* Faint god-ray shafts. */",
  "  float shaft = pow(max(0.0, sin(p.x * 9.0 + sin(t * 0.33) * 2.2 + 1.3)), 6.0);",
  "  vec3 shafts = vec3(0.10, 0.24, 0.22) * shaft * (1.0 - depth) * (0.25 + 0.45 * u_sub);",
  "",
  "  vec3 col = body + light + surfaceGlow + shafts;",
  "",
  "  /* Resolve: the breakthrough wash as the answer arrives. */",
  "  float r = clamp(u_resolve, 0.0, 1.0);",
  "  vec3 washCol = vec3(0.78, 0.97, 0.92);",
  "  col = mix(col, washCol * (0.80 + 0.35 * web), smoothstep(0.0, 1.0, r));",
  "  col += washCol * r * (1.0 - r) * 0.85;",
  "",
  "  /* Vignette + a whisper of grain for the documentary grade. */",
  "  vec2 vg = uv - 0.5;",
  "  col *= 1.0 - 0.55 * dot(vg, vg);",
  "  float gseed = u_still > 0.5 ? 1.7 : (1.0 + fract(t * 0.37) * 9.0);",
  "  col += (hash(gl_FragCoord.xy * gseed) - 0.5) * 0.030;",
  "",
  "  gl_FragColor = vec4(max(col, 0.0), 1.0);",
  "}",
].join("\n");

function hexToRgb01(hex) {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || "").trim());
  if (!m) return [0.45, 0.75, 0.68];
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    try { gl.deleteShader(sh); } catch (e) {}
    return null;
  }
  return sh;
}

export default function WaterCaustics({ submersion = 0, done = false, reduced = false, accent = "#8fd0c2" }) {
  const canvasRef = useRef(null);
  /* Latest prop values for the rAF loop without re-running the effect. */
  const liveRef = useRef({ submersion, done });
  liveRef.current.submersion = submersion;
  liveRef.current.done = done;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let gl = null;
    try {
      gl =
        canvas.getContext("webgl", {
          antialias: false, alpha: false, depth: false,
          stencil: false, powerPreference: "low-power",
        }) || canvas.getContext("experimental-webgl");
    } catch (e) {
      gl = null;
    }
    /* No WebGL: render nothing. The DOM fallback (marine snow + reading
       line) already in the dive field carries the loading state. */
    if (!gl) return undefined;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return undefined;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return undefined;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const U = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      sub: gl.getUniformLocation(prog, "u_sub"),
      resolve: gl.getUniformLocation(prog, "u_resolve"),
      accent: gl.getUniformLocation(prog, "u_accent"),
      still: gl.getUniformLocation(prog, "u_still"),
    };
    const ac = hexToRgb01(accent);
    gl.uniform3f(U.accent, ac[0], ac[1], ac[2]);

    /* Half resolution, upscaled by CSS — the single biggest phone perf win. */
    const SCALE = 0.5;
    const fit = () => {
      const cw = canvas.clientWidth || 300;
      const ch = canvas.clientHeight || 170;
      const w = Math.max(2, Math.round(cw * SCALE));
      const h = Math.max(2, Math.round(ch * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(U.res, w, h);
    };
    fit();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(fit);
      ro.observe(canvas);
    }

    const isReduced = !!reduced;
    gl.uniform1f(U.still, isReduced ? 1 : 0);

    let raf = 0;
    let dead = false;
    const t0 = performance.now();
    let sub = 0; /* smoothed submersion */
    let resolve = 0;
    let resolveT0 = 0;

    const frame = (now) => {
      if (dead) return;
      const t = (now - t0) / 1000;
      const target = Math.max(0, Math.min(1, liveRef.current.submersion || 0));
      /* Ease the 5Hz prop updates into buttery motion. */
      sub += (target - sub) * (isReduced ? 1 : 0.055);
      if (Math.abs(target - sub) < 0.001) sub = target;

      if (liveRef.current.done && !resolveT0) resolveT0 = now;
      if (resolveT0) {
        const k = Math.min(1, (now - resolveT0) / 1100);
        resolve = 1 - Math.pow(1 - k, 3); /* easeOutCubic */
      }

      fit();
      gl.uniform1f(U.time, isReduced ? 2.4 : t);
      gl.uniform1f(U.sub, isReduced ? target : sub);
      gl.uniform1f(U.resolve, resolve);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (isReduced) return; /* one still frame, no loop */
      if (resolve < 1) {
        raf = requestAnimationFrame(frame);
      }
      /* else: hold the bright frame. The answer is rendering and this
         unmounts; no more GPU work. */
    };

    const onLost = (e) => {
      try { e.preventDefault(); } catch (err) {}
      dead = true;
      try { cancelAnimationFrame(raf); } catch (err2) {}
    };
    canvas.addEventListener("webglcontextlost", onLost);

    if (isReduced) {
      if (liveRef.current.done) resolve = 1;
      frame(t0);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      dead = true;
      try { cancelAnimationFrame(raf); } catch (e) {}
      try { canvas.removeEventListener("webglcontextlost", onLost); } catch (e) {}
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      try {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (e) {}
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [reduced]);

  return <canvas ref={canvasRef} className="cb-dive-water" aria-hidden="true" />;
}
