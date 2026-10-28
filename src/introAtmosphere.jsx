// @ts-check
/**
 * introAtmosphere.jsx — the door's new cinematic material (2026-10-28).
 *
 * The owner's verdict on the reimagined door shipped the same day
 * (2894e09): it looks the same but with animations, because the
 * material underneath the new staging never changed. The old door
 * played two stock clips (Mixkit 30563, dark matter flight, and
 * 10011, a star field, about 10.5 MB of remote video between them)
 * under a CSS grade (brightness 0.22, saturate 0.60, blur 12px).
 * His order: bring in all new cinematic elements and backgrounds,
 * and do not reuse any of the old ones.
 *
 * So this component is the replacement material, authored for this
 * door and rendered live in a WebGL fragment shader. Nothing is
 * footage and nothing is a file: no clips, no poster, no grade
 * filter. The world is a living darkness in three strata:
 *
 *   - Mist in depth. Three layers of fractal noise fog drift at
 *     different scales and speeds, the far layer slowest, so the
 *     frame has depth instead of a picture. It reads as atmosphere,
 *     never as a place: nothing in it can be recognized.
 *   - A breathing light. Low in the frame, wide and dim, a glow
 *     swells and recedes on a cycle of about 48 seconds, the way
 *     light moves under deep cloud. It lifts the mist around it
 *     and never gets bright: the shader clamps its own output far
 *     below anything that could compete with the words.
 *   - Motes and grain. Fine specks drift slowly through the light,
 *     catching it as they pass, and a fine animated grain runs over
 *     the whole frame, the texture of film rather than of a screen.
 *
 * The register is the standing law and is not what was rejected:
 * cinematic, calm, very dark, atmospheric, nothing literal. Only
 * the material is new.
 *
 * Performance, measured rather than assumed (see the addendum at
 * ~/workspace/cerebrum-intro-new-material-oct28-addendum.md): the
 * shader renders at a capped internal resolution (0.55 of CSS size,
 * at most 880 by 620 backing pixels) and is upscaled by the
 * browser, which is free softness for a material this blurred by
 * nature. One self check runs after the first ninety frames: if
 * the average frame is slower than 26 ms the internal scale drops
 * once, to 0.7 of itself. There is no network fetch and no video
 * decode at all; the old reel's two clips cost about 10.5 MB of
 * download before the door could move.
 *
 * Contracts:
 *   - still: draw exactly one frame, at the composed time
 *     ATMOSPHERE_STILL_T, and never start the loop. Reduced motion,
 *     the app's animation Off setting, and Save-Data all land here,
 *     so the door still opens on the new material, composed, for a
 *     visitor who asked it not to move. A resize redraws the still.
 *   - fixedClock (cinema mode): the clock starts at
 *     ATMOSPHERE_TAKE_T0 on every mount, so every take opens on the
 *     same frame and runs the same light.
 *   - swell: while the door is leaving, the light swells toward
 *     full over the exit, so the light that spills between the
 *     parting leaves is this material's own, not a painted layer.
 *   - The loop runs on accumulated visible time only: the tab
 *     hiding cannot jump the scene, and rAF stops with the tab.
 *   - No WebGL: the component falls back to a still composition of
 *     layered gradients in the same palette (ATMO_FALLBACK below),
 *     drawn with plain CSS. Still new material, still dark, never
 *     the old poster and never black.
 */
import React, { useEffect, useRef, useState } from "react";

/* The composed still time: mid breath, mist settled, the frame the
   reduced motion door opens on. */
export const ATMOSPHERE_STILL_T = 19.0;
/* The cinema take's first frame time: the same world, caught a
   little later in its breath, identical on every take. */
export const ATMOSPHERE_TAKE_T0 = 26.0;

const VERT_SRC = [
  "attribute vec2 aPos;",
  "void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }",
].join("\n");

const FRAG_SRC = [
  "precision highp float;",
  "uniform vec2 uRes;",
  "uniform float uTime;",
  "uniform float uSwell;",
  "",
  "float hash(vec2 p){",
  "  p = fract(p * vec2(123.34, 456.21));",
  "  p += dot(p, p + 45.32);",
  "  return fract(p.x * p.y);",
  "}",
  "float noise(vec2 p){",
  "  vec2 i = floor(p);",
  "  vec2 f = fract(p);",
  "  f = f * f * (3.0 - 2.0 * f);",
  "  float a = hash(i);",
  "  float b = hash(i + vec2(1.0, 0.0));",
  "  float c = hash(i + vec2(0.0, 1.0));",
  "  float d = hash(i + vec2(1.0, 1.0));",
  "  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);",
  "}",
  "float fbm(vec2 p){",
  "  float v = 0.0;",
  "  float a = 0.5;",
  "  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);",
  "  for(int i = 0; i < 4; i++){",
  "    v += a * noise(p);",
  "    p = rot * p * 2.02;",
  "    a *= 0.5;",
  "  }",
  "  return v;",
  "}",
  "/* One mote layer: sparse specks on a drifting grid, each cell",
  "   keeping or empty by its hash, lit harder near the glow. */",
  "float motes(vec2 p, float t, float scale, vec2 drift, float seed){",
  "  vec2 g = p * scale + drift * t + seed;",
  "  vec2 id = floor(g);",
  "  vec2 f = fract(g) - 0.5;",
  "  float h = hash(id + seed);",
  "  if(h < 0.90) return 0.0;",
  "  vec2 off = vec2(hash(id + 1.7 + seed), hash(id + 4.3 + seed)) - 0.5;",
  "  float d = length(f - off * 0.62);",
  "  float tw = 0.5 + 0.5 * sin(t * 0.6 + h * 40.0);",
  "  return smoothstep(0.10, 0.0, d) * ((h - 0.90) / 0.10) * tw;",
  "}",
  "void main(){",
"  vec2 uv = gl_FragCoord.xy / uRes;",
"  vec2 p = uv;",
"  p.x *= uRes.x / uRes.y;",
"  float t = uTime;",
"",
"  /* The breathing light: a full swell and recession in about",
"     48 seconds, eased so it lingers at the bottom of the breath. */",
"  float breath = 0.5 + 0.5 * sin(t * 0.1309 - 1.2);",
"  breath = pow(breath, 1.6);",
"  /* Elliptical distance to a glow centred low and slightly",
"     right, wide rather than round, like light under cloud. */",
"  vec2 q = (uv - vec2(0.56, 0.15)) * vec2(1.0, 1.60);",
"  float glow = exp(-dot(q, q) * 2.2);",
"  float lightAmt = glow * (0.34 + 0.50 * breath + 0.60 * uSwell);",
"",
"  /* Mist in three strata, each with its own contrast curve so",
"     the field has ridges and clearings instead of a flat wash.",
"     The far layer is large, slow, and domain warped by a second",
"     field so its edges roll instead of sliding; the near layers",
"     are finer and quicker. Nothing here is fast: the far layer",
"     crosses the frame in minutes. */",
"  float warp = fbm(p * 1.15 - vec2(t * 0.004, 0.0));",
"  float m1 = fbm(p * 1.55 + vec2(t * 0.010, t * 0.002) + warp * 0.85);",
"  float m2 = fbm(p * 3.05 + vec2(-t * 0.016, t * 0.003) + 7.3);",
"  float m3 = fbm(p * 5.30 + vec2(t * 0.025, -t * 0.005) + 13.1);",
"  float d1 = pow(smoothstep(0.28, 1.05, m1 * 0.72 + m2 * 0.38), 1.30);",
"  float d2 = pow(smoothstep(0.38, 1.02, m2), 1.50);",
"  float d3 = pow(smoothstep(0.44, 1.02, m3), 1.60);",
"  /* Fine detail inside the lit mist, so lit areas have texture",
"     instead of a smooth gradient. */",
"  float det = 0.55 + 0.90 * fbm(p * 6.5 + vec2(t * 0.010, 0.0));",
"  /* The upper frame stays the emptiest: the masthead and the",
"     open sky of the frame live there. */",
"  float sky = 0.60 + 0.55 * (1.0 - uv.y);",
"",
"  vec3 ground = vec3(0.012, 0.016, 0.024);",
"  vec3 farCol = vec3(0.150, 0.185, 0.225);",
"  vec3 midCol = vec3(0.120, 0.155, 0.175);",
"  vec3 lightCol = vec3(0.55, 0.61, 0.53);",
"  vec3 col = ground;",
"  /* Far mist, lit through by the glow. */",
"  col += farCol * d1 * (0.06 + 1.00 * lightAmt) * 0.85 * det * sky;",
"  /* The light itself, hanging in the air low in the frame. */",
"  col += lightCol * lightAmt * 0.55 * (0.42 + 0.85 * d1);",
"  /* Mid mist, less lit, drifting across. */",
"  col += midCol * d2 * (0.05 + 0.80 * lightAmt) * 0.50 * det;",
"  /* Near mist as silhouette: it absorbs the light behind it,",
"     which is what gives the frame real depth, and only its",
"     edges catch the glow. */",
"  col *= 1.0 - d3 * 0.50 * (1.0 - 0.45 * lightAmt);",
"  col += midCol * d3 * lightAmt * 0.12;",
"",
"  /* Motes: two sparse layers drifting through, visible mostly",
"     where the light is. */",
"  float mo = motes(p, t, 26.0, vec2(0.010, 0.004), 3.1)",
"           + motes(p, t, 41.0, vec2(-0.014, 0.006), 9.7) * 0.7;",
"  col += vec3(0.80, 0.82, 0.76) * mo * (0.03 + lightAmt * 0.22);",
"",
"  /* Vignette: the frame's edges fall back to the door ground. */",
"  float vig = smoothstep(1.28, 0.42, distance(uv, vec2(0.5, 0.42)));",
"  col *= mix(0.52, 1.0, vig);",
"",
"  /* Fine animated grain, the texture of film. */",
"  float g = hash(gl_FragCoord.xy + fract(t) * 371.0);",
"  col += (g - 0.5) * 0.028;",
"",
"  /* The clamp is the calm law in numbers: whatever the breath",
"     and the swell do, no pixel of this material gets bright. */",
"  col = min(col, vec3(0.40));",
"  gl_FragColor = vec4(col, 1.0);",
"}",
].join("\n");

/* The no WebGL still: the same world as flat light. Layered radial
   gradients in the shader's palette over the door ground; no image,
   no old poster, no clip. */
const ATMO_FALLBACK = {
  background: [
    "radial-gradient(ellipse 90% 55% at 50% 88%, rgba(96,110,92,0.20), rgba(96,110,92,0) 62%)",
    "radial-gradient(ellipse 120% 80% at 22% 66%, rgba(38,52,66,0.35), rgba(38,52,66,0) 65%)",
    "radial-gradient(ellipse 110% 75% at 82% 30%, rgba(30,40,52,0.28), rgba(30,40,52,0) 60%)",
    "#05070a",
  ].join(", "),
};

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function IntroAtmosphere({ animationMode = "off", still = false, swell = false, fixedClock = false }) {
  const canvasRef = useRef(null);
  const swellRef = useRef(0);
  const swellTargetRef = useRef(0);
  const [failed, setFailed] = useState(false);

  /* The swell is a prop but the loop reads a ref, eased in the
     frame step so the light rises on the exit's own timing. */
  useEffect(() => { swellTargetRef.current = swell ? 1 : 0; }, [swell]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let gl = null;
    try {
      gl = canvas.getContext("webgl", {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: "low-power",
      }) || canvas.getContext("experimental-webgl", {
        alpha: false, antialias: false, depth: false, stencil: false,
      });
    } catch { gl = null; }
    if (!gl) { setFailed(true); return undefined; }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) { setFailed(true); return undefined; }
    const prog = gl.createProgram();
    if (!prog) { setFailed(true); return undefined; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return undefined; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uSwell = gl.getUniformLocation(prog, "uSwell");

    /* Save-Data joins reduced motion and Off as a still: one frame
       of the new material and no loop, per the contract above. */
    let saveData = false;
    try {
      const conn = navigator && navigator.connection;
      saveData = !!(conn && conn.saveData);
    } catch { saveData = false; }
    const drawStill = still || animationMode === "off" || saveData;

    let scale = 0.55;
    const fit = () => {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const bw = Math.max(200, Math.min(880, Math.round(w * scale)));
      const bh = Math.max(200, Math.min(620, Math.round(h * scale)));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (tSec) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, tSec);
      gl.uniform1f(uSwell, swellRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    fit();
    if (drawStill) {
      draw(ATMOSPHERE_STILL_T);
      const onResize = () => { fit(); draw(ATMOSPHERE_STILL_T); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    /* The running clock accumulates visible frame time only, so a
       hidden tab or a long stall cannot jump the scene. Cinema
       takes start from the fixed take time instead. */
    let elapsed = fixedClock ? ATMOSPHERE_TAKE_T0 : 0;
    let last = performance.now();
    let raf = 0;
    let frames = 0;
    let frameTimeTotal = 0;
    let steppedDown = false;
    const step = (now) => {
      raf = requestAnimationFrame(step);
      const dtMs = now - last;
      last = now;
      const dt = Math.min(dtMs / 1000, 0.05);
      elapsed += dt;
      /* One honest self check: if the first ninety frames run slow
         on this device, drop the internal scale once and keep the
         door smooth rather than proud. */
      if (!steppedDown) {
        frames++;
        frameTimeTotal += dtMs;
        if (frames === 90) {
          if (frameTimeTotal / frames > 26) {
            scale *= 0.7;
            steppedDown = true;
            fit();
          } else {
            steppedDown = true;
          }
        }
      }
      const target = swellTargetRef.current;
      if (swellRef.current !== target) {
        const dir = target > swellRef.current ? 1 : -1;
        swellRef.current = Math.max(0, Math.min(1, swellRef.current + dir * dt * 2.4));
      }
      draw(elapsed);
    };
    raf = requestAnimationFrame(step);
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      try {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch { /* context already gone */ }
    };
  }, [animationMode, still, fixedClock]);

  if (failed) {
    return <div aria-hidden="true" style={{ position: "absolute", inset: 0, ...ATMO_FALLBACK }} />;
  }
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
