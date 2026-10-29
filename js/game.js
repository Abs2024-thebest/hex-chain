/* ==========================================================================
   HEX CHAIN — pure game logic (no DOM). Board geometry, win detection and
   question-bank helpers live here so they can be reused and unit tested.
   ========================================================================== */

export const TEAMS = ['blue', 'gold'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const other = (team) => (team === 'blue' ? 'gold' : 'blue');

/* Blue must cross every column (left → right); Gold every row (top → bottom). */
export const BOARD_SIZES = {
  '5x4': { cols: 5, rows: 4, label: 'Classic — 5 × 4 (20 hexes)' },
  '5x5': { cols: 5, rows: 5, label: 'Even — 5 × 5 (25 hexes)' },
  '6x5': { cols: 6, rows: 5, label: 'Marathon — 6 × 5 (30 hexes)' },
};

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/* --------------------------------------------------------------------------
   Geometry. Flat-topped hexes laid out in columns; odd columns sit half a hex
   lower ("odd-q" offset). Cells are stored row-major: index = row * cols + col.
   -------------------------------------------------------------------------- */
export function neighbors(index, cols, rows) {
  const c = index % cols;
  const r = Math.floor(index / cols);
  const sideRows = c % 2 === 1 ? [r, r + 1] : [r - 1, r];
  const cand = [[c, r - 1], [c, r + 1]];
  for (const dc of [-1, 1]) for (const rr of sideRows) cand.push([c + dc, rr]);
  return cand
    .filter(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows)
    .map(([x, y]) => y * cols + x);
}

/* Breadth-first search from the team's starting edge through its own hexes.
   Returns the shortest winning chain (array of cell indexes) or null. */
export function findWinPath(cells, cols, rows, team) {
  const col = (i) => i % cols;
  const row = (i) => Math.floor(i / cols);
  const isStart = team === 'blue' ? (i) => col(i) === 0 : (i) => row(i) === 0;
  const isGoal = team === 'blue' ? (i) => col(i) === cols - 1 : (i) => row(i) === rows - 1;

  const prev = new Map();
  const queue = [];
  cells.forEach((cell, i) => {
    if (cell.owner === team && isStart(i)) {
      prev.set(i, -1);
      queue.push(i);
    }
  });

  while (queue.length) {
    const i = queue.shift();
    if (isGoal(i)) {
      const path = [];
      for (let n = i; n !== -1; n = prev.get(n)) path.unshift(n);
      return path;
    }
    for (const n of neighbors(i, cols, rows)) {
      if (!prev.has(n) && cells[n].owner === team) {
        prev.set(n, i);
        queue.push(n);
      }
    }
  }
  return null;
}

/* --------------------------------------------------------------------------
   Question bank. Canonical shape:
     { name, questions: { A: { easy: [{q, a}], medium: [...], hard: [...] } } }
   normalizeBank() also accepts a flat array (handy for spreadsheet exports):
     [{ letter: "A", difficulty: "easy", question: "...", answer: "..." }]
   -------------------------------------------------------------------------- */
export function normalizeBank(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The question set must be a JSON object or array.');
  const out = {};
  let count = 0;

  const add = (letter, diff, item) => {
    const L = String(letter ?? '').trim().toUpperCase();
    if (!/^\p{L}{1,3}$/u.test(L)) return;
    const d = String(diff ?? '').trim().toLowerCase();
    const difficulty = DIFFICULTIES.includes(d) ? d : 'medium';
    const q = item?.q ?? item?.question;
    const a = item?.a ?? item?.answer;
    if (!q || !a) return;
    (out[L] ??= { easy: [], medium: [], hard: [] })[difficulty].push({ q: String(q).trim(), a: String(a).trim() });
    count++;
  };

  const list = Array.isArray(raw) ? raw : raw.questions;
  if (Array.isArray(list)) {
    list.forEach((it) => add(it?.letter, it?.difficulty, it));
  } else if (list && typeof list === 'object') {
    for (const [L, byDiff] of Object.entries(list)) {
      if (Array.isArray(byDiff)) byDiff.forEach((it) => add(L, it?.difficulty, it));
      else for (const [d, arr] of Object.entries(byDiff || {})) (Array.isArray(arr) ? arr : []).forEach((it) => add(L, d, it));
    }
  }

  if (!count) throw new Error('No valid questions found. Each question needs a letter, a question and an answer.');
  const name = (!Array.isArray(raw) && raw.name) || 'Custom question set';
  return { name: String(name).slice(0, 80), questions: out };
}

export const questionCount = (bank, letter, d) => bank?.questions?.[letter]?.[d]?.length ?? 0;

export function remaining(bank, letter, d, used = {}) {
  const n = questionCount(bank, letter, d);
  let left = 0;
  for (let i = 0; i < n; i++) if (!used[`${letter}|${d}|${i}`]) left++;
  return left;
}

export function bankSummary(bank, used = {}) {
  const perLetter = {};
  let total = 0;
  let left = 0;
  for (const L of Object.keys(bank?.questions || {}).sort()) {
    const row = {};
    for (const d of DIFFICULTIES) {
      row[d] = questionCount(bank, L, d);
      row[`${d}Left`] = remaining(bank, L, d, used);
      total += row[d];
      left += row[`${d}Left`];
    }
    perLetter[L] = row;
  }
  return { total, remaining: left, letters: Object.keys(perLetter).length, perLetter };
}

/* Unique letters where possible; repeats only if the board is bigger than the bank. */
export function pickLetters(bank, n) {
  let pool = shuffle(Object.keys(bank?.questions || {}));
  if (!pool.length) pool = shuffle('ABCDEFGHIJKLMNOPRSTUVWY'.split(''));
  const out = pool.slice(0, n);
  while (out.length < n) out.push(pick(pool));
  return shuffle(out);
}

/* Draw an unused question for a letter. difficulty may be 'random'.
   Falls back to already-used questions (flagged `recycled`) once a pool runs dry. */
export function drawQuestion(bank, letter, difficulty, used = {}, excludeId = null) {
  const set = bank?.questions?.[letter];
  if (!set) return null;
  const ids = (d) => (set[d] || []).map((_, i) => `${letter}|${d}|${i}`);
  const fresh = (id) => !used[id] && id !== excludeId;

  let d = difficulty;
  if (d === 'random') {
    const withFresh = DIFFICULTIES.filter((x) => ids(x).some(fresh));
    const withAny = DIFFICULTIES.filter((x) => ids(x).length);
    if (!withAny.length) return null;
    d = pick(withFresh.length ? withFresh : withAny);
  }

  let candidates = ids(d).filter(fresh);
  let recycled = false;
  if (!candidates.length) {
    candidates = ids(d).filter((id) => id !== excludeId);
    if (!candidates.length) candidates = ids(d);
    recycled = true;
  }
  if (!candidates.length) return null;

  const id = pick(candidates);
  const item = set[d][Number(id.split('|')[2])];
  return { id, letter, difficulty: d, text: item.q, answer: item.a, recycled };
}
