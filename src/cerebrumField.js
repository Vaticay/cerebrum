/**
 * Cerebrum / optical mark
 * Uses the exact paths from the application's logo.
 * Decorative Canvas 2D animation. No external dependencies.
 */

const LOGO = [
  'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z',
  'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z',
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hex(value, fallback) {
  return /^#[\da-f]{6}$/i.test(value || '') ? value : fallback;
}

function rgba(color, alpha) {
  const h = hex(color, '#39dca2').slice(1);

  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${clamp(alpha, 0, 1)})`;
}

export function staticFieldCss(accent, deep, { core = true } = {}) {
  const a = hex(accent, '#39dca2');
  const d = hex(deep, '#0a1020');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".48" stop-color="#e3f7f1"/><stop offset="1" stop-color="${a}"/></linearGradient></defs><g fill="none" stroke="url(#a)" stroke-width=".65" stroke-linejoin="round" stroke-linecap="round">${LOGO.map(p => `<path d="${p}"/>`).join('')}</g></svg>`;

  return [
    core
      ? `url("data:image/svg+xml,${encodeURIComponent(svg)}") right 8% top 35% / clamp(150px, 32vw, 470px) auto no-repeat`
      : '',
    `radial-gradient(ellipse at 83% 56%, ${rgba(a, .09)}, transparent 48%)`,
    `linear-gradient(${d}, ${d})`,
  ].filter(Boolean).join(', ');
}

export async function createField(canvas, initial = {}) {
  if (!canvas || typeof Path2D === 'undefined') return null;

  let ctx;

  try {
    ctx = canvas.getContext('2d', { alpha: false });
  } catch {
    return null;
  }

  if (!ctx) return null;

  const paths = LOGO.map(p => new Path2D(p));

  const state = {
    accent: '#39dca2',
    deep: '#0a1020',
    mode: 'arrival',
    core: 1,
    coreScale: 1,
    energy: 0,
    light: false,
    paused: false,
    ...initial,
  };

  state.accent = hex(state.accent, '#39dca2');
  state.deep = hex(state.deep, '#0a1020');

  let width = 1;
  let height = 1;
  let dpr = 1;
  let raf = 0;
  let destroyed = false;

  let visible = document.visibilityState !== 'hidden';
  let onScreen = true;

  let time = 0;
  let last = 0;
  let lastPaint = 0;
  let pulse = 0;
  let energy = 0;

  let px = 0;
  let py = 0;
  let tx = 0;
  let ty = 0;

  let cx = 0;
  let cy = 0;
  let scale = 0;

  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia?.('(pointer: fine)');

  let reduced = !!motion?.matches;

  function layout() {
    const narrow = width < 760;
    const reading = state.mode === 'reading';

    return {
      x: narrow ? width * .78 : width * .80,
      y: narrow ? height * .27 : height * .49,
      size: reading
        ? Math.min(width * .14, 190)
        : Math.min(
            narrow ? width * .48 : width * .32,
            height * .59,
            540
          ),
      strength: reading ? .28 : narrow ? .46 : 1,
    };
  }

  function resize() {
    if (destroyed) return;

    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);

    dpr = Math.min(
      window.devicePixelRatio || 1,
      width < 760 ? 1.25 : 1.5
    );

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    const l = layout();
    cx = l.x;
    cy = l.y;
    scale = l.size;

    draw();
  }

  function strokeLogo() {
    for (const path of paths) ctx.stroke(path);
  }

  function draw() {
    if (destroyed) return;

    const l = layout();
    const light = !!state.light;
    const a = state.accent;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = state.deep;
    ctx.fillRect(0, 0, width, height);

    const pool = ctx.createRadialGradient(
      cx, cy, 0,
      cx, cy, Math.max(scale * 1.35, 1)
    );

    pool.addColorStop(0, rgba(a, light ? .06 : .075));
    pool.addColorStop(1, rgba(a, 0));

    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, width, height);

    // Open optical arcs around the logo.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-.35 + Math.sin(time * .08) * .04);

    for (let i = 0; i < 3; i++) {
      const rx = scale * (1.00 + i * .17);
      const ry = scale * (.37 + i * .045);
      const arc = ctx.createLinearGradient(-rx, 0, rx, 0);

      arc.addColorStop(0, rgba(a, 0));
      arc.addColorStop(.55, rgba(a, .025 * l.strength));
      arc.addColorStop(.85, rgba(a, .19 * l.strength));
      arc.addColorStop(1, rgba(a, 0));

      ctx.strokeStyle = arc;
      ctx.lineWidth = i === 0 ? 1.2 : .6;

      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, -.85, 2.2);
      ctx.stroke();
    }

    ctx.restore();

    const yaw = Math.sin(time * .17) * .14 + px * .27;
    const pitch = Math.cos(time * .13) * .07 + py * .12;
    const roll = -.10 + Math.sin(time * .11) * .035 + px * .025;
    const unit = scale / 24;
    const depth = unit * (1.0 + pulse * .55);
    const strength = l.strength * clamp(Number(state.core) || 0, 0, 1);

    ctx.save();
    ctx.translate(cx, cy + Math.sin(time * .35) * 5);
    ctx.rotate(roll);

    ctx.transform(
      Math.cos(yaw),
      Math.sin(pitch) * .22,
      Math.sin(yaw) * .12,
      Math.cos(pitch),
      0,
      0
    );

    ctx.globalAlpha = strength;

    // Layered edges add depth without changing the logo shape.
    for (let i = 12; i >= 0; i--) {
      ctx.save();

      ctx.translate(
        (i / 12) * depth * (.65 + yaw),
        (i / 12) * depth * (.34 + pitch)
      );

      ctx.scale(unit, unit);
      ctx.translate(-12, -12);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = .94;

      ctx.strokeStyle = light
        ? rgba(a, .20 + (12 - i) * .025)
        : rgba(a, .08 + (12 - i) * .025);

      strokeLogo();
      ctx.restore();
    }

    ctx.scale(unit, unit);
    ctx.translate(-12, -12);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const face = ctx.createLinearGradient(5 + px * 2, 3, 19, 23);

    face.addColorStop(0, light ? '#183d32' : '#e2fff2');
    face.addColorStop(.19, a);
    face.addColorStop(.46, light ? '#285b4c' : '#39594d');
    face.addColorStop(.60, light ? a : '#ddfff2');
    face.addColorStop(1, a);

    ctx.strokeStyle = face;
    ctx.lineWidth = .76;
    strokeLogo();

    ctx.strokeStyle = light
      ? rgba(a, .8)
      : 'rgba(238,255,250,.7)';

    ctx.lineWidth = .075;
    strokeLogo();

    // Travelling reflection on the original outline.
    ctx.save();

    const sweep = 12 + Math.sin(time * .31 + px * .6) * 13;

    ctx.beginPath();
    ctx.rect(3, sweep - 1.3, 18, 2.6);
    ctx.clip();

    const sheen = ctx.createLinearGradient(
      0, sweep - 1.3,
      0, sweep + 1.3
    );

    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(
      .5,
      `rgba(240,255,250,${light ? .40 : .85})`
    );
    sheen.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.strokeStyle = sheen;
    ctx.lineWidth = .79;
    strokeLogo();

    ctx.restore();

    // Small highlights travel around the edges.
    ctx.setLineDash([.7, 10, .2, 19]);
    ctx.lineDashOffset = -time * (1.2 + energy * .65);
    ctx.lineWidth = .13;
    ctx.strokeStyle = light ? '#214c40' : '#f0fffa';

    strokeLogo();

    ctx.setLineDash([]);
    ctx.restore();

    // Protect foreground text contrast.
    const guard = ctx.createLinearGradient(0, 0, width, 0);

    guard.addColorStop(0, rgba(state.deep, .94));
    guard.addColorStop(.40, rgba(state.deep, .68));
    guard.addColorStop(.66, rgba(state.deep, 0));

    ctx.fillStyle = guard;
    ctx.fillRect(0, 0, width, height);
  }

  function runnable() {
    return !destroyed && visible && onScreen && !state.paused;
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function start() {
    if (!runnable()) return;

    if (reduced) {
      draw();
      return;
    }

    if (!raf) {
      last = performance.now();
      lastPaint = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    raf = 0;

    if (!runnable() || reduced) return;

    if (now - lastPaint >= (width < 760 ? 32 : 21)) {
      const dt = Math.min((now - last) / 1000, .05);

      last = now;
      lastPaint = now;

      const ease = 1 - Math.exp(-dt * 4.5);

      px += (tx - px) * ease;
      py += (ty - py) * ease;

      energy += (
        clamp(Number(state.energy) || 0, 0, 1) - energy
      ) * ease;

      pulse *= Math.exp(-dt * 2.4);
      time += dt;

      const l = layout();

      cx += (l.x - cx) * ease;
      cy += (l.y - cy) * ease;
      scale += (l.size - scale) * ease;

      draw();
    }

    raf = requestAnimationFrame(frame);
  }

  function pointer(e) {
    if (reduced || !fine?.matches) return;

    tx = clamp((e.clientX - cx) / Math.max(scale, 1), -1, 1);
    ty = clamp((e.clientY - cy) / Math.max(scale, 1), -1, 1);
  }

  function reset() {
    tx = 0;
    ty = 0;
  }

  function tap(e) {
    if (
      reduced ||
      e.target?.closest?.(
        'button,a,input,textarea,select,[role="button"]'
      )
    ) return;

    if (Math.hypot(e.clientX - cx, e.clientY - cy) < scale * .48) {
      pulse = 1;
    }
  }

  function visibility() {
    visible = document.visibilityState !== 'hidden';

    if (visible) start();
    else stop();
  }

  function preference() {
    reduced = !!motion?.matches;
    reset();
    stop();

    if (reduced) {
      px = 0;
      py = 0;
      pulse = 0;
    }

    start();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', pointer, { passive: true });
  window.addEventListener('pointerdown', tap, { passive: true });
  window.addEventListener('blur', reset);

  document.addEventListener('visibilitychange', visibility);

  if (motion?.addEventListener) {
    motion.addEventListener('change', preference);
  } else {
    motion?.addListener?.(preference);
  }

  const observer = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(entries => {
        onScreen = entries.some(e => e.isIntersecting);

        if (onScreen) start();
        else stop();
      });

  observer?.observe(canvas);

  resize();
  start();

  return {
    setState(next = {}) {
      if (destroyed) return;

      if (next.accent) {
        state.accent = hex(next.accent, state.accent);
      }

      if (next.deep) {
        state.deep = hex(next.deep, state.deep);
      }

      for (const key of [
        'mode',
        'energy',
        'core',
        'coreScale',
        'light',
        'paused',
      ]) {
        if (next[key] !== undefined) state[key] = next[key];
      }

      if (reduced) {
        const l = layout();
        cx = l.x;
        cy = l.y;
        scale = l.size;
      }

      if (state.paused) {
        stop();
        draw();
      } else {
        draw();
        start();
      }
    },

    destroy() {
      if (destroyed) return;

      destroyed = true;
      stop();
      observer?.disconnect();

      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('pointerdown', tap);
      window.removeEventListener('blur', reset);

      document.removeEventListener('visibilitychange', visibility);

      if (motion?.removeEventListener) {
        motion.removeEventListener('change', preference);
      } else {
        motion?.removeListener?.(preference);
      }

      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
