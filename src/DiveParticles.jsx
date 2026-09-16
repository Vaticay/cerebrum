import { useEffect, useRef } from "react";

/* DiveParticles — the searching-state particle field.
   A canvas marine-snow instrument: three depth layers drifting upward on
   slow currents, far flakes small and dim, near motes large and soft,
   everything swaying with its own phase. Ambient only — it never claims
   anything about per-database progress, which the client cannot know
   mid-request. Canvas 2D (no WebGL), DPR-capped, parked the moment the
   answer arrives. Reduced motion gets one still frame. */
export default function DiveParticles({ done, reduced }) {
  const canvasRef = useRef(null);
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let raf = 0;
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(r.width * dpr));
      h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();

    /* Deterministic field: the same snow every search, stable and calm. */
    let seed = 20260916;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    /* Three depth layers: 0 = far (small, dim, slow), 1 = mid, 2 = near
       (larger, brighter, faster — a few rendered as soft out-of-focus
       motes for real depth). */
    const LAYERS = [
      { r: 0.7, speed: 0.010, alpha: 0.10, sway: 0.012 },
      { r: 1.3, speed: 0.020, alpha: 0.18, sway: 0.028 },
      { r: 2.3, speed: 0.036, alpha: 0.30, sway: 0.050 },
    ];
    const flakes = [];
    const COUNT = 190;
    for (let i = 0; i < COUNT; i++) {
      const L = LAYERS[i % 3];
      flakes.push({
        L,
        x: rnd(),
        y: rnd(),
        r: L.r * (0.7 + rnd() * 0.7),
        speed: L.speed * (0.7 + rnd() * 0.6),
        phase: rnd() * Math.PI * 2,
        alpha: L.alpha * (0.6 + rnd() * 0.8),
        twinkle: 0.5 + rnd() * 1.6,
        mote: i % 3 === 2 && rnd() < 0.18,
      });
    }

    const t0 = performance.now();
    const render = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const f of flakes) {
        /* Rise with wrap; the horizontal current is two slow sines so the
           field breathes instead of marching in lockstep. */
        const y = ((((f.y - t * f.speed) % 1) + 1) % 1) * h;
        const x =
          ((((f.x +
            Math.sin(t * 0.35 + f.phase) * f.L.sway +
            Math.sin(t * 0.13 + f.phase * 2.7) * f.L.sway * 0.6) % 1) + 1) % 1) * w;
        const tw = 0.72 + 0.28 * Math.sin(t * f.twinkle + f.phase * 3.1);
        const a = Math.min(1, f.alpha * tw);
        if (f.mote) {
          /* Near, out of focus: a soft halo instead of a hard dot. */
          const R = f.r * dpr * 3.2;
          const g = ctx.createRadialGradient(x, y, 0, x, y, R);
          g.addColorStop(0, `rgba(207,232,228,${(a * 0.55).toFixed(3)})`);
          g.addColorStop(1, "rgba(207,232,228,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(207,232,228,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, f.r * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!doneRef.current && !reduced) raf = requestAnimationFrame(render);
    };

    if (reduced) {
      render(t0);
    } else {
      raf = requestAnimationFrame(render);
    }
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [reduced]);

  return <canvas ref={canvasRef} className="cb-dive-particles" aria-hidden="true" />;
}
