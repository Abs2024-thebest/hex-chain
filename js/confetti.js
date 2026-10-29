/* ==========================================================================
   HEX CHAIN — lightweight canvas confetti (no dependencies).
   ========================================================================== */

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.rainUntil = 0;
    this.colors = ['#fff'];
    this.running = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  spawn(x, y, angle, spread, power, count) {
    for (let k = 0; k < count; k++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = power * (0.55 + Math.random() * 0.6);
      this.parts.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 12,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        tilt: Math.random() * Math.PI,
        vt: 0.05 + Math.random() * 0.1,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        round: Math.random() < 0.25,
      });
    }
  }

  celebrate(colors, ms = 6000) {
    this.colors = colors;
    const power = Math.max(this.h, 600) / 38;
    [0, 450, 900].forEach((delay) => setTimeout(() => {
      this.spawn(0, this.h, -Math.PI / 3, 0.7, power, 90);
      this.spawn(this.w, this.h, (-2 * Math.PI) / 3, 0.7, power, 90);
    }, delay));
    this.spawn(this.w / 2, this.h * 0.45, -Math.PI / 2, Math.PI * 2, power * 0.7, 120);
    this.rainUntil = performance.now() + ms;
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.loop());
    }
  }

  stop() {
    this.parts = [];
    this.rainUntil = 0;
  }

  loop() {
    const { ctx } = this;
    if (performance.now() < this.rainUntil && this.parts.length < 500) {
      for (let k = 0; k < 4; k++) this.spawn(Math.random() * this.w, -20, Math.PI / 2, 0.6, 2, 1);
    }
    ctx.clearRect(0, 0, this.w, this.h);
    this.parts = this.parts.filter((p) => p.y < this.h + 40 && p.x > -60 && p.x < this.w + 60);
    for (const p of this.parts) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx + Math.sin(p.tilt) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      p.tilt += p.vt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (this.parts.length || performance.now() < this.rainUntil) requestAnimationFrame(() => this.loop());
    else {
      this.running = false;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  }
}
