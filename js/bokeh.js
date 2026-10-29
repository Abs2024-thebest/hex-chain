/* ==========================================================================
   HEX CHAIN — drifting studio-light bokeh for the contestant board backdrop.
   ========================================================================== */

export function startBokeh(canvas) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const palette = ['77,179,255', '255,201,40', '255,255,255', '140,110,255'];
  let w = 0;
  let h = 0;
  let dots = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((w * h) / 38000);
    dots = Array.from({ length: count }, () => make(true));
  }

  function make(anywhere) {
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 60,
      r: 8 + Math.random() * 46,
      vy: 0.1 + Math.random() * 0.35,
      vx: (Math.random() - 0.5) * 0.15,
      a: 0.04 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
      c: palette[Math.floor(Math.random() * palette.length)],
    };
  }

  function frame(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < dots.length; k++) {
      const d = dots[k];
      d.y -= d.vy;
      d.x += d.vx;
      if (d.y < -60) dots[k] = make(false);
      const alpha = d.a * (0.65 + 0.35 * Math.sin(t / 1400 + d.phase));
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
      g.addColorStop(0, `rgba(${d.c},${alpha})`);
      g.addColorStop(1, `rgba(${d.c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
}
