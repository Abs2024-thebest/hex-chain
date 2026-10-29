/* ==========================================================================
   HEX CHAIN — synthesised sound effects (Web Audio, no audio files, no
   licensing worries). Browsers only allow audio after a user gesture, so the
   contestant board calls unlockAudio() from its "click to start" overlay.
   ========================================================================== */

let ctx = null;
let master = null;
let enabled = true;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!ctx && AC) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  ctx?.resume?.();
  return !!ctx;
}

export function setSoundEnabled(v) { enabled = !!v; }
export function isSoundEnabled() { return enabled; }

function tone(freq, start, dur, { type = 'sine', gain = 0.25, slideTo } = {}) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const play = (fn) => () => { if (enabled && ctx && ctx.state === 'running') fn(); };

export const sfx = {
  select: play(() => {
    tone(880, 0, 0.12, { type: 'triangle', gain: 0.18 });
    tone(1320, 0.06, 0.14, { type: 'triangle', gain: 0.12 });
  }),
  correct: play(() => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(f, k * 0.08, 0.35, { type: 'triangle', gain: 0.22 }));
    tone(2093, 0.32, 0.5, { type: 'sine', gain: 0.08 });
  }),
  wrong: play(() => {
    tone(180, 0, 0.28, { type: 'square', gain: 0.12, slideTo: 120 });
    tone(150, 0.3, 0.42, { type: 'square', gain: 0.12, slideTo: 80 });
  }),
  tick: play(() => tone(1200, 0, 0.06, { type: 'square', gain: 0.07 })),
  timeout: play(() => {
    tone(440, 0, 0.6, { type: 'sawtooth', gain: 0.1, slideTo: 110 });
    tone(220, 0, 0.6, { type: 'square', gain: 0.06, slideTo: 60 });
  }),
  whoosh: play(() => tone(200, 0, 0.5, { type: 'sine', gain: 0.15, slideTo: 1600 })),
  win: play(() => {
    const notes = [
      [523.25, 0, 0.18], [523.25, 0.2, 0.18], [523.25, 0.4, 0.18], [659.25, 0.6, 0.5],
      [587.33, 1.1, 0.18], [659.25, 1.3, 0.18], [783.99, 1.5, 1.1],
    ];
    notes.forEach(([f, t, d]) => {
      tone(f, t, d, { type: 'sawtooth', gain: 0.09 });
      tone(f * 2, t, d, { type: 'triangle', gain: 0.07 });
    });
    [261.63, 329.63, 392].forEach((f) => tone(f, 1.5, 1.2, { type: 'triangle', gain: 0.08 }));
  }),
};
