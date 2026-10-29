/* ==========================================================================
   HEX CHAIN — SVG board renderer shared by the host and contestant screens.
   Builds the hex grid once per board, then only toggles classes on updates so
   CSS transitions/animations stay smooth.
   ========================================================================== */

const NS = 'http://www.w3.org/2000/svg';
const SQ3 = Math.sqrt(3);
const R = 50;        // hex circumradius in SVG units
const MARGIN = 30;   // gap between board and edge bars
const BAR = 12;      // edge bar thickness

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}

export function hexCenter(c, r) {
  return { x: R + c * 1.5 * R, y: (SQ3 * R) / 2 + r * SQ3 * R + (c % 2 ? (SQ3 * R) / 2 : 0) };
}

function hexPoints(cx, cy, rad) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

const DEFS = `
<defs>
  <linearGradient id="hb-neutral" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3d4566"/><stop offset=".55" stop-color="#1f2440"/><stop offset="1" stop-color="#0d1024"/>
  </linearGradient>
  <linearGradient id="hb-blue" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5cc2ff"/><stop offset=".5" stop-color="#1673ff"/><stop offset="1" stop-color="#0a2c9c"/>
  </linearGradient>
  <linearGradient id="hb-gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff4b0"/><stop offset=".45" stop-color="#ffc928"/><stop offset="1" stop-color="#b06d00"/>
  </linearGradient>
  <linearGradient id="hb-shine" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".46" stop-color="#fff" stop-opacity=".1"/>
    <stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="hb-bar-blue" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7fd0ff"/><stop offset=".5" stop-color="#1e7bff"/><stop offset="1" stop-color="#7fd0ff"/>
  </linearGradient>
  <linearGradient id="hb-bar-gold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff0a0"/><stop offset=".5" stop-color="#ffbf1f"/><stop offset="1" stop-color="#fff0a0"/>
  </linearGradient>
</defs>`;

export class BoardView {
  constructor(svg, { variant = 'board', onHexClick } = {}) {
    this.svg = svg;
    this.variant = variant;
    this.key = null;
    this.nodes = [];
    this.ready = false;
    svg.classList.add('hexboard', `hexboard--${variant}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (onHexClick) {
      svg.addEventListener('click', (e) => {
        const g = e.target.closest('.hex');
        if (g) onHexClick(Number(g.dataset.i));
      });
    }
  }

  build(cols, rows) {
    const svg = this.svg;
    svg.innerHTML = DEFS;
    const W = 2 * R + (cols - 1) * 1.5 * R;
    const H = rows * SQ3 * R + (cols > 1 ? (SQ3 * R) / 2 : 0);
    const pad = MARGIN + 14;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`);

    const bars = el('g', { class: 'edge-bars' }, svg);
    el('rect', { class: 'bar bar-blue', x: -MARGIN, y: 0, width: BAR, height: H, rx: BAR / 2 }, bars);
    el('rect', { class: 'bar bar-blue', x: W + MARGIN - BAR, y: 0, width: BAR, height: H, rx: BAR / 2 }, bars);
    el('rect', { class: 'bar bar-gold', x: 0, y: -MARGIN, width: W, height: BAR, rx: BAR / 2 }, bars);
    el('rect', { class: 'bar bar-gold', x: 0, y: H + MARGIN - BAR, width: W, height: BAR, rx: BAR / 2 }, bars);

    this.grid = el('g', { class: 'hexes' }, svg);
    this.nodes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const { x, y } = hexCenter(c, r);
        const g = el('g', { class: 'hex', 'data-i': i }, this.grid);
        el('polygon', { class: 'hex-base', points: hexPoints(x, y, R * 0.95) }, g);
        el('polygon', { class: 'hex-shine', points: hexPoints(x, y, R * 0.86) }, g);
        const text = el('text', { class: 'hex-letter', x, y: y + 2 }, g);
        g.addEventListener('animationend', (e) => {
          if (e.animationName === 'hexIn') g.classList.remove('intro');
        });
        this.nodes[i] = { g, text, x, y, owner: null, letter: null };
      }
    }
    this.line = el('polyline', { class: 'win-line', points: '' }, svg);
    this.winKey = '';
  }

  applyOwner(n) {
    n.g.classList.toggle('owner-blue', n.owner === 'blue');
    n.g.classList.toggle('owner-gold', n.owner === 'gold');
  }

  /* s = public game state; editSel = host-only edit highlight */
  render(s, { editSel = null } = {}) {
    const key = `${s.cols}x${s.rows}#${s.boardId ?? 0}`;
    const rebuilt = key !== this.key;
    if (rebuilt) {
      this.build(s.cols, s.rows);
      this.key = key;
    }
    const isBoard = this.variant === 'board';
    const introOrder = rebuilt && isBoard ? [...s.cells.keys()].sort(() => Math.random() - 0.5) : null;
    const won = s.phase === 'won' && s.winPath?.length;
    const winIndex = new Map((won ? s.winPath : []).map((i, k) => [i, k]));

    s.cells.forEach((cell, i) => {
      const n = this.nodes[i];
      if (!n) return;
      if (n.letter !== cell.letter) {
        n.letter = cell.letter;
        n.text.textContent = cell.letter;
        n.text.classList.toggle('long', cell.letter.length > 1);
      }
      if (n.owner !== cell.owner) {
        const animate = isBoard && this.ready && !rebuilt && cell.owner;
        n.owner = cell.owner;
        if (animate) {
          n.g.classList.remove('flip');
          n.g.getBoundingClientRect(); // restart animation
          n.g.classList.add('flip');
          clearTimeout(n.t1);
          clearTimeout(n.t2);
          n.t1 = setTimeout(() => this.applyOwner(n), 300);
          n.t2 = setTimeout(() => n.g.classList.remove('flip'), 750);
        } else {
          this.applyOwner(n);
        }
      }
      n.g.classList.toggle('selected', s.selected === i && s.phase !== 'won');
      n.g.classList.toggle('win', winIndex.has(i));
      n.g.classList.toggle('dim', !!won && !winIndex.has(i));
      n.g.classList.toggle('edit-sel', editSel === i);
      n.g.classList.toggle('claimed', !!cell.owner);
      if (winIndex.has(i)) n.g.style.setProperty('--wd', `${(winIndex.get(i) * 0.12).toFixed(2)}s`);
      if (introOrder) {
        n.g.style.setProperty('--d', `${introOrder.indexOf(i) * 45}ms`);
        n.g.classList.add('intro');
      }
    });

    this.renderWinLine(s, won);
    this.ready = true;
  }

  renderWinLine(s, won) {
    const wk = won ? `${s.winner}:${s.winPath.join(',')}` : '';
    if (wk === this.winKey) return;
    this.winKey = wk;
    const line = this.line;
    if (!wk) {
      line.setAttribute('points', '');
      line.setAttribute('class', 'win-line');
      return;
    }
    const pts = s.winPath.map((i) => this.nodes[i]);
    pts.forEach((n) => this.grid.appendChild(n.g)); // paint winning hexes on top while they pulse
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    line.setAttribute('points', pts.map((n) => `${n.x},${n.y}`).join(' '));
    line.style.strokeDasharray = `${len + 1}`;
    line.style.strokeDashoffset = `${len + 1}`;
    line.setAttribute('class', `win-line team-${s.winner}`);
    line.getBoundingClientRect();
    line.classList.add('draw');
  }
}
