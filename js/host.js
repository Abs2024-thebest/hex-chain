/* ==========================================================================
   HEX CHAIN — Host Dashboard. Owns the authoritative game state, persists it
   to localStorage and publishes a sanitised public copy to the board.
   ========================================================================== */

import {
  TEAMS, DIFFICULTIES, BOARD_SIZES, other, findWinPath, normalizeBank,
  pickLetters, drawQuestion, remaining, questionCount, bankSummary,
} from './game.js';
import { BoardView } from './render.js';
import { HostSync } from './sync.js';

const STATE_KEY = 'hexchain-host-state-v1';
const BANK_KEY = 'hexchain-bank-v1';
const UI_KEY = 'hexchain-host-ui-v1';
const SAMPLE_URL = 'data/questions.json';

const DEFAULT_SETTINGS = {
  title: 'HEX CHAIN',
  size: '5x4',
  turnRule: 'alternate',
  passOnWrong: true,
  showQuestion: false,
  sound: true,
  timerSecs: 10,
};
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', random: 'Random' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const act = (type, extra = {}) => ({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, type, ...extra });

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Could not save', key, e); }
}

/* ------------------------------- State ------------------------------- */

let bank = { name: 'Empty set', questions: {} };
let bankIsCustom = false;
let state = null;
let editMode = false;
let editSel = null;
const ui = { hideAnswer: false, tab: 'stats', ...(loadJSON(UI_KEY) || {}) };
const undoStack = [];
const boards = new Map();

const sync = new HostSync({
  onBoardSeen(id) {
    const isNew = !boards.has(id) || Date.now() - boards.get(id) > 6000;
    boards.set(id, Date.now());
    if (isNew) {
      renderConn();
      toast('Contestant board connected', 'good');
    }
  },
});
const view = new BoardView($('#board'), { variant: 'host', onHexClick });

const freshTally = () => ({ correct: 0, incorrect: 0 });
const freshStats = () => ({
  asked: 0,
  skipped: 0,
  correct: 0,
  incorrect: 0,
  team: { blue: freshTally(), gold: freshTally() },
  diff: { easy: freshTally(), medium: freshTally(), hard: freshTally() },
  rounds: [],
  roundStart: Date.now(),
  gameStart: Date.now(),
});

function createGame(prev) {
  const s = {
    v: 1,
    rev: prev?.rev ?? 0,
    boardId: prev?.boardId ?? 0,
    settings: { ...DEFAULT_SETTINGS, ...(prev?.settings || {}) },
    teams: {
      blue: { name: prev?.teams?.blue?.name || 'Blue Team', rounds: 0 },
      gold: { name: prev?.teams?.gold?.name || 'Gold Team', rounds: 0 },
    },
    round: 1,
    active: 'blue',
    used: {},
    stats: freshStats(),
    log: [],
    lastAction: act('reset'),
  };
  dealBoard(s);
  addLog(s, '🎬 New game started.');
  return s;
}

function dealBoard(s) {
  const size = BOARD_SIZES[s.settings.size] || BOARD_SIZES['5x4'];
  s.cols = size.cols;
  s.rows = size.rows;
  s.cells = pickLetters(bank, s.cols * s.rows).map((letter) => ({ letter, owner: null }));
  s.boardId = (s.boardId || 0) + 1;
  s.stats.roundStart = Date.now();
  clearPlay(s);
  s.phase = 'idle';
  s.winner = null;
  s.winPath = [];
}

function clearPlay(s) {
  s.selected = null;
  s.question = null;
  s.play = null;
  s.timer = null;
  if (s.phase === 'question') s.phase = 'idle';
}

function addLog(s, msg) {
  s.log.unshift({ t: Date.now(), msg });
  if (s.log.length > 250) s.log.length = 250;
}

const teamName = (t, s = state) => s.teams[t].name;

function validState(s) {
  return s && s.v === 1 && Array.isArray(s.cells) && s.cells.length === s.cols * s.rows && s.teams?.blue && s.teams?.gold && s.stats;
}

/* Run after every change: detects new wins and revokes wins undone by edits. */
function checkWin(s) {
  let found = null;
  for (const t of TEAMS) {
    const path = findWinPath(s.cells, s.cols, s.rows, t);
    if (path) { found = { team: t, path }; break; }
  }
  if (found) {
    s.winPath = found.path;
    if (s.winner === found.team) return;
    if (s.winner) revokeWin(s);
    s.winner = found.team;
    s.phase = 'won';
    s.teams[found.team].rounds++;
    clearPlay(s);
    s.phase = 'won';
    s.stats.rounds.push({
      round: s.round,
      winner: found.team,
      ms: Date.now() - s.stats.roundStart,
      chain: found.path.length,
      hexes: { blue: s.cells.filter((c) => c.owner === 'blue').length, gold: s.cells.filter((c) => c.owner === 'gold').length },
    });
    s.lastAction = act('win', { team: found.team });
    addLog(s, `🏆 ${teamName(found.team, s)} win round ${s.round} with a ${found.path.length}-hex chain!`);
  } else if (s.winner) {
    revokeWin(s);
    s.phase = 'idle';
    addLog(s, '↩️ Win removed after a board change.');
  }
}

function revokeWin(s) {
  s.teams[s.winner].rounds = Math.max(0, s.teams[s.winner].rounds - 1);
  s.stats.rounds = s.stats.rounds.filter((r) => r.round !== s.round);
  s.winner = null;
  s.winPath = [];
}

function toPublic(s) {
  return {
    v: 1,
    rev: s.rev,
    boardId: s.boardId,
    title: s.settings.title,
    sound: s.settings.sound,
    showQuestion: s.settings.showQuestion,
    teams: { blue: { ...s.teams.blue }, gold: { ...s.teams.gold } },
    cols: s.cols,
    rows: s.rows,
    cells: s.cells.map((c) => ({ letter: c.letter, owner: c.owner })),
    active: s.active,
    selected: s.selected,
    phase: s.phase,
    winner: s.winner,
    winPath: s.winPath,
    round: s.round,
    timer: s.timer,
    stealing: !!s.play?.attempts?.length,
    lastAction: s.lastAction,
    // Never includes the answer. Question text only when the host opts in.
    question: s.question
      ? { letter: s.question.letter, difficulty: s.question.difficulty, text: s.settings.showQuestion ? s.question.text : null }
      : null,
  };
}

function commit(fn, { undo = true } = {}) {
  if (undo) {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 80) undoStack.shift();
  }
  const next = fn(state);
  if (next) state = next;
  checkWin(state);
  persist();
}

function persist() {
  state.rev++;
  saveJSON(STATE_KEY, state);
  sync.publish(toPublic(state));
  renderAll();
}

/* ------------------------------ Actions ------------------------------ */

function onHexClick(i) {
  if (editMode) {
    editSel = editSel === i ? null : i;
    renderAll();
    return;
  }
  const cell = state.cells[i];
  if (state.phase === 'won') return toast('Round over — start a new round to keep playing.', 'warn');
  if (cell.owner) return toast(`“${cell.letter}” already belongs to ${teamName(cell.owner)}. Use Edit board to override.`, 'warn');
  if (state.selected === i) return;
  commit((s) => {
    clearPlay(s);
    s.selected = i;
    s.phase = 'question';
    s.play = { startTeam: s.active, attempts: [] };
    s.lastAction = act('select', { cell: i });
  }, { undo: false });
}

function randomLetter() {
  if (state.phase === 'won') return;
  const open = state.cells.map((c, i) => (c.owner ? -1 : i)).filter((i) => i >= 0);
  if (open.length) onHexClick(open[Math.floor(Math.random() * open.length)]);
}

function ask(difficulty, replace = false) {
  if (state.selected == null) return toast('Select a hexagon first.', 'warn');
  const letter = state.cells[state.selected].letter;
  const q = drawQuestion(bank, letter, difficulty, state.used, state.question?.id);
  if (!q) return toast(`No ${difficulty === 'random' ? '' : `${DIFF_LABEL[difficulty]} `}questions for “${letter}” in this set — ask your own and mark the result.`, 'warn', 5000);
  commit((s) => {
    if (s.question && replace) s.stats.skipped++;
    s.used[q.id] = true;
    s.question = q;
    s.timer = null;
    s.stats.asked++;
    s.lastAction = act('ask', { cell: s.selected });
    addLog(s, `❓ ${DIFF_LABEL[q.difficulty]} question for “${letter}”: ${q.text}`);
  }, { undo: false });
  if (q.recycled) toast(`All ${DIFF_LABEL[q.difficulty]} questions for “${letter}” have been used — repeating one.`, 'warn');
}

function markCorrect() {
  if (state.selected == null || state.phase !== 'question') return;
  commit((s) => {
    const i = s.selected;
    const team = s.active;
    const q = s.question;
    s.cells[i].owner = team;
    s.stats.correct++;
    s.stats.team[team].correct++;
    if (q) s.stats.diff[q.difficulty].correct++;
    addLog(s, `✅ ${teamName(team, s)} win “${s.cells[i].letter}”${q ? ` (${q.answer})` : ''}.`);
    s.lastAction = act('correct', { cell: i, team });
    const start = s.play?.startTeam ?? team;
    s.active = s.settings.turnRule === 'keep' ? team : other(start);
    clearPlay(s);
  });
}

function markIncorrect() {
  if (state.selected == null || state.phase !== 'question') return;
  commit((s) => {
    const team = s.active;
    const q = s.question;
    s.stats.incorrect++;
    s.stats.team[team].incorrect++;
    if (q) s.stats.diff[q.difficulty].incorrect++;
    s.play ??= { startTeam: team, attempts: [] };
    s.play.attempts.push(team);
    const letter = s.cells[s.selected].letter;
    if (s.settings.passOnWrong && s.play.attempts.length < 2) {
      s.active = other(team);
      s.timer = null;
      s.lastAction = act('incorrect', { cell: s.selected, team, passTo: s.active });
      addLog(s, `❌ ${teamName(team, s)} wrong on “${letter}” — over to ${teamName(s.active, s)}.`);
    } else {
      s.lastAction = act('incorrect', { cell: s.selected, team });
      addLog(s, `❌ ${teamName(team, s)} wrong on “${letter}”${q ? ` (answer: ${q.answer})` : ''}. Hex stays open.`);
      s.active = other(s.play.startTeam);
      clearPlay(s);
    }
  });
}

function cancel() {
  if (editMode) {
    editSel = null;
    return renderAll();
  }
  if (state.selected == null) return;
  commit((s) => {
    clearPlay(s);
    s.lastAction = act('cancel');
  }, { undo: false });
}

function setActive(team) {
  if (state.active === team) return;
  commit((s) => {
    s.active = team;
    s.timer = null;
    s.lastAction = act('turn', { team });
    addLog(s, `🔁 Turn passed to ${teamName(team, s)}.`);
  });
}

function startTimer(secs = state.settings.timerSecs) {
  if (state.selected == null) return toast('Select a hexagon first.', 'warn');
  commit((s) => { s.timer = { endsAt: Date.now() + secs * 1000, secs }; }, { undo: false });
}

function stopTimer() {
  if (state.timer) commit((s) => { s.timer = null; }, { undo: false });
}

function newRound() {
  commit((s) => {
    if (s.winner) s.active = other(s.winner);
    s.round++;
    dealBoard(s);
    s.lastAction = act('newround');
    addLog(s, `🎬 Round ${s.round} begins. ${teamName(s.active, s)} to start.`);
  });
  editSel = null;
}

function resetGame() {
  if (!confirm('Reset the whole game? Scores, statistics and the board will be cleared. (Undo is available.)')) return;
  commit((s) => createGame(s));
  editSel = null;
  toast('Game reset.', 'good');
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return toast('Nothing to undo.', 'warn');
  const rev = state.rev;
  state = JSON.parse(prev);
  state.rev = rev;
  state.lastAction = act('undo');
  editSel = null;
  persist();
  toast('Undone.', 'good');
}

/* Edit mode overrides */
function setOwner(owner) {
  const i = editSel;
  if (i == null) return;
  commit((s) => {
    s.cells[i].owner = owner || null;
    if (s.selected === i) clearPlay(s);
    s.lastAction = act('override', { cell: i });
    addLog(s, `✏️ Override: “${s.cells[i].letter}” → ${owner ? teamName(owner, s) : 'unclaimed'}.`);
  });
}

function applyLetter() {
  const i = editSel;
  const value = $('#editLetter')?.value.trim().toUpperCase();
  if (i == null || !value) return;
  if (!/^\p{L}{1,3}$/u.test(value)) return toast('Use 1–3 letters.', 'warn');
  commit((s) => {
    addLog(s, `✏️ Letter changed: “${s.cells[i].letter}” → “${value}”.`);
    s.cells[i].letter = value;
    if (s.selected === i) clearPlay(s);
  });
  if (!bank.questions[value]) toast(`No questions for “${value}” in the current set — you'll need to ask your own.`, 'warn', 5000);
}

function redeal() {
  commit((s) => {
    const open = s.cells.filter((c) => !c.owner);
    const taken = new Set(s.cells.filter((c) => c.owner).map((c) => c.letter));
    const fresh = pickLetters({ questions: Object.fromEntries(Object.entries(bank.questions).filter(([L]) => !taken.has(L))) }, open.length);
    open.forEach((c, k) => { c.letter = fresh[k]; });
    clearPlay(s);
    addLog(s, '🔀 Unclaimed letters re-dealt.');
  });
}

function clearClaims() {
  if (!confirm('Clear every claimed hexagon on this board?')) return;
  commit((s) => {
    s.cells.forEach((c) => { c.owner = null; });
    clearPlay(s);
    addLog(s, '🧹 All claims cleared.');
  });
}

function setEditMode(on) {
  editMode = on;
  editSel = null;
  $('#editMode').checked = on;
  $('#board').classList.toggle('editing', on);
  if (on && state.selected != null) cancel();
  renderAll();
}

function openBoard() {
  const w = window.open('board.html', 'hexchain-board', 'width=1280,height=760');
  if (!w) toast('Pop-up blocked — open board.html in a new tab instead.', 'warn', 5000);
}

/* Question bank */
async function loadSampleBank() {
  try {
    const res = await fetch(SAMPLE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeBank(await res.json());
  } catch (e) {
    console.warn(e);
    toast('Could not load the sample questions. Serve the folder over http(s) (not file://) or load a JSON file in the Questions tab.', 'bad', 9000);
    return null;
  }
}

function useBank(next, custom) {
  bank = next;
  bankIsCustom = custom;
  if (custom) saveJSON(BANK_KEY, bank);
  else localStorage.removeItem(BANK_KEY);
  const deal = confirm(`Loaded “${bank.name}” (${bankSummary(bank).total} questions).\n\nDeal a fresh board with letters from this set? Scores are kept.`);
  commit((s) => {
    s.used = {};
    if (deal) {
      dealBoard(s);
      s.lastAction = act('newround');
    }
    addLog(s, `📚 Question set loaded: ${bank.name}.`);
  });
  toast(`Question set “${bank.name}” ready.`, 'good');
}

function loadBankText(text) {
  try {
    useBank(normalizeBank(JSON.parse(text)), true);
  } catch (e) {
    toast(`Could not load question set: ${e.message}`, 'bad', 7000);
  }
}

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------ Rendering ------------------------------ */

function renderAll() {
  view.render(toPublic(state), { editSel });
  renderTop();
  renderTeams();
  renderQ();
  renderTab();
}

function renderTop() {
  $('#hdrTitle').textContent = state.settings.title;
  $('#roundPill').textContent = `Round ${state.round}`;
  const phase = $('#phasePill');
  phase.className = 'pill';
  if (state.phase === 'won') {
    phase.textContent = `🏆 ${teamName(state.winner)} won`;
    phase.classList.add(`pill-${state.winner}`);
  } else if (state.selected != null) {
    phase.textContent = `Playing “${state.cells[state.selected].letter}”`;
    phase.classList.add('pill-live');
  } else phase.textContent = 'Waiting for a letter';
  $('#btnUndo').disabled = !undoStack.length;
  renderConn();
}

function renderConn() {
  const now = Date.now();
  const live = [...boards.values()].filter((t) => now - t < 6000).length;
  $('#connPill').classList.toggle('on', live > 0);
  $('#connText').textContent = live ? `${live} board${live > 1 ? 's' : ''} live` : 'No board connected';
}

function renderTeams() {
  for (const t of TEAMS) {
    $(`#tbName-${t}`).textContent = teamName(t);
    $(`#tbHex-${t}`).textContent = state.cells.filter((c) => c.owner === t).length;
    $(`#tbRounds-${t}`).textContent = state.teams[t].rounds;
    $(`.team-btn[data-team="${t}"]`).classList.toggle('active', state.active === t);
  }
}

const chip = (t) => `<span class="chip chip-${t}">${esc(teamName(t))}</span>`;

function renderQ() {
  const s = state;
  let body;
  if (editMode) body = editorHTML();
  else if (s.phase === 'won') {
    body = `
      <div class="q-empty won">
        <div class="trophy">🏆</div>
        <h3>${chip(s.winner)} win round ${s.round}!</h3>
        <p>Winning chain of ${s.winPath.length} hexagons. Celebrations are playing on the contestant board.</p>
        <button class="btn btn-primary btn-lg" data-action="newRound">Start round ${s.round + 1} →</button>
      </div>`;
  } else if (s.selected == null) {
    body = `
      <div class="q-empty">
        <div class="big-turn">${chip(s.active)} to choose a letter</div>
        <p>Click the hexagon the team calls out, or let fate decide.</p>
        <button class="btn" data-action="randomLetter">🎲 Random letter <kbd>L</kbd></button>
      </div>`;
  } else {
    const letter = s.cells[s.selected].letter;
    const q = s.question;
    const total = DIFFICULTIES.reduce((n, d) => n + questionCount(bank, letter, d), 0);
    const diffBtns = DIFFICULTIES.map((d, k) => {
      const n = questionCount(bank, letter, d);
      return `<button class="btn diff diff-${d} ${q?.difficulty === d ? 'on' : ''}" data-action="ask" data-value="${d}" ${n ? '' : 'disabled'}>
        <span>${DIFF_LABEL[d]} <kbd>${k + 1}</kbd></span><small>${remaining(bank, letter, d, s.used)}/${n} unused</small></button>`;
    }).join('');
    const stealing = s.play?.attempts?.length > 0;
    const card = q
      ? `<div class="q-card">
          <div class="q-card-top">
            <span class="badge badge-${q.difficulty}">${DIFF_LABEL[q.difficulty]}</span>
            ${q.recycled ? '<span class="tag">repeat</span>' : ''}
            <button class="btn btn-sm" data-action="another">↻ Another question <kbd>N</kbd></button>
          </div>
          <div class="q-text">${esc(q.text)}</div>
          <div class="answer ${ui.hideAnswer ? 'concealed' : ''}">
            <span class="answer-label">Answer</span>
            <span class="answer-text">${esc(q.answer)}</span>
          </div>
        </div>`
      : `<div class="q-card q-card-empty">${total
        ? 'Choose a difficulty to draw a question — or ask your own and mark the result.'
        : `No questions for “${esc(letter)}” in this set. Ask your own question and mark the result.`}</div>`;
    const t = s.settings.timerSecs;
    body = `
      <div class="q-head">
        <div class="q-letter">${esc(letter)}</div>
        <div class="q-meta">
          <div class="q-for">Playing for “${esc(letter)}”</div>
          <div class="q-turn">${chip(s.active)} ${stealing ? '<span class="tag tag-steal">STEAL</span>' : ''}</div>
        </div>
        <button class="btn btn-ghost" data-action="cancel" title="Deselect (Esc)">✕</button>
      </div>
      <div class="diff-row">${diffBtns}
        <button class="btn diff diff-random" data-action="ask" data-value="random" ${total ? '' : 'disabled'}><span>🎲 Random <kbd>R</kbd></span><small>any level</small></button>
      </div>
      ${card}
      <div class="mark-row">
        <button class="btn btn-correct" data-action="correct"><span class="big">✓</span> Correct <kbd>C</kbd></button>
        <button class="btn btn-wrong" data-action="incorrect"><span class="big">✗</span> Incorrect <kbd>X</kbd></button>
      </div>
      <div class="timer-row">
        <span class="timer-label">Answer timer</span>
        <button class="btn btn-sm" data-action="timer" data-value="${t}">▶ ${t}s <kbd>S</kbd></button>
        ${[5, 15, 30].filter((n) => n !== t).map((n) => `<button class="btn btn-sm" data-action="timer" data-value="${n}">${n}s</button>`).join('')}
        <button class="btn btn-sm btn-ghost" data-action="stopTimer">■ Stop</button>
        <span class="timer-display" id="qTimer"></span>
      </div>`;
  }
  $('#qPanel').innerHTML = `<div class="panel-head"><h2>Question Console</h2><span class="turn-mini">Turn: ${chip(s.active)}</span></div><div class="q-body">${body}</div>`;
  tick();
}

function editorHTML() {
  const tools = `
    <div class="btn-row">
      <button class="btn" data-action="redeal">🔀 Re-deal unclaimed letters</button>
      <button class="btn" data-action="clearClaims">🧹 Clear all claims</button>
      <button class="btn btn-primary" data-action="closeEdit">Done editing</button>
    </div>`;
  if (editSel == null) {
    return `<div class="edit-banner">✏️ EDIT MODE</div>
      <div class="q-empty"><p>Click any hexagon to change its owner or letter. Changes sync live and the winning chain is re-checked automatically.</p></div>${tools}`;
  }
  const cell = state.cells[editSel];
  return `<div class="edit-banner">✏️ EDIT MODE — hexagon ${editSel + 1}</div>
    <div class="q-head">
      <div class="q-letter owner-${cell.owner || 'none'}">${esc(cell.letter)}</div>
      <div class="q-meta"><div class="q-for">Current owner</div><div>${cell.owner ? chip(cell.owner) : '<span class="chip">Unclaimed</span>'}</div></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-blue" data-action="setOwner" data-value="blue">Give to ${esc(teamName('blue'))}</button>
      <button class="btn btn-gold" data-action="setOwner" data-value="gold">Give to ${esc(teamName('gold'))}</button>
      <button class="btn" data-action="setOwner" data-value="">Make unclaimed</button>
    </div>
    <div class="field inline-field">
      <span>Letter</span>
      <input id="editLetter" maxlength="3" value="${esc(cell.letter)}" autocomplete="off">
      <button class="btn" data-action="applyLetter">Apply</button>
    </div>
    ${tools}`;
}

function renderTab() {
  $$('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $$('.tab-body').forEach((b) => { b.hidden = b.dataset.tab !== ui.tab; });
  if (ui.tab === 'stats') renderStats();
  if (ui.tab === 'bank') renderBank();
  if (ui.tab === 'log') renderLog();
  if (ui.tab === 'settings') syncSettingsForm();
}

function renderStats() {
  const s = state;
  const st = s.stats;
  const answered = st.correct + st.incorrect;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const held = (t) => s.cells.filter((c) => c.owner === t).length;
  const open = s.cells.length - held('blue') - held('gold');
  const sum = bankSummary(bank, s.used);
  const kpi = (label, value, cls = '', id = '') => `<div class="kpi ${cls}"><b ${id ? `id="${id}"` : ''}>${value}</b><span>${label}</span></div>`;
  const teamRow = (label, f) => `<tr><td>${label}</td><td>${f('blue')}</td><td>${f('gold')}</td></tr>`;
  const share = (n) => `${(n / s.cells.length) * 100}%`;
  $('#tab-stats').innerHTML = `
    <div class="kpis">
      ${kpi('Questions asked', st.asked)}
      ${kpi('Correct', st.correct, 'good')}
      ${kpi('Incorrect', st.incorrect, 'bad')}
      ${kpi('Accuracy', pct(st.correct, answered))}
      ${kpi('Round time', fmtTime(roundElapsed()), '', 'statRoundTime')}
      ${kpi('Unused questions', `${sum.remaining}<small>/${sum.total}</small>`)}
    </div>
    <div class="control-bar" title="Board control">
      <i class="cb-blue" style="width:${share(held('blue'))}"></i><i class="cb-open" style="width:${share(open)}"></i><i class="cb-gold" style="width:${share(held('gold'))}"></i>
    </div>
    <div class="stat-cols">
      <table class="stat-table">
        <thead><tr><th></th><th class="c-blue">${esc(teamName('blue'))}</th><th class="c-gold">${esc(teamName('gold'))}</th></tr></thead>
        <tbody>
          ${teamRow('Rounds won', (t) => s.teams[t].rounds)}
          ${teamRow('Hexes held', held)}
          ${teamRow('Correct', (t) => st.team[t].correct)}
          ${teamRow('Incorrect', (t) => st.team[t].incorrect)}
          ${teamRow('Accuracy', (t) => pct(st.team[t].correct, st.team[t].correct + st.team[t].incorrect))}
        </tbody>
      </table>
      <table class="stat-table">
        <thead><tr><th>Difficulty</th><th>✓</th><th>✗</th><th>Rate</th></tr></thead>
        <tbody>${DIFFICULTIES.map((d) => `<tr><td><span class="badge badge-${d}">${DIFF_LABEL[d]}</span></td><td>${st.diff[d].correct}</td><td>${st.diff[d].incorrect}</td><td>${pct(st.diff[d].correct, st.diff[d].correct + st.diff[d].incorrect)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <h4>Round history</h4>
    ${st.rounds.length ? `<table class="stat-table history"><thead><tr><th>Round</th><th>Winner</th><th>Chain</th><th>Hexes (B–G)</th><th>Time</th></tr></thead><tbody>
      ${st.rounds.map((r) => `<tr><td>${r.round}</td><td>${chip(r.winner)}</td><td>${r.chain}</td><td>${r.hexes.blue}–${r.hexes.gold}</td><td>${fmtTime(r.ms)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">No rounds completed yet.</p>'}
    <p class="muted">Questions skipped with “Another question”: ${st.skipped}. Game running for ${fmtTime(Date.now() - st.gameStart)}.</p>`;
}

function roundElapsed() {
  if (state.phase === 'won') return state.stats.rounds.find((r) => r.round === state.round)?.ms ?? 0;
  return Date.now() - state.stats.roundStart;
}

function renderBank() {
  const sum = bankSummary(bank, state.used);
  $('#bankSummary').innerHTML = `
    <div><b>${esc(bank.name)}</b> ${bankIsCustom ? '<span class="tag">custom</span>' : '<span class="tag">sample</span>'}</div>
    <div class="muted">${sum.total} questions · ${sum.letters} letters · ${sum.remaining} unused this game</div>`;
  const onBoard = new Set(state.cells.map((c) => c.letter));
  const rows = Object.entries(sum.perLetter).map(([L, r]) => `
    <tr class="${onBoard.has(L) ? 'on-board' : ''}"><td><b>${esc(L)}</b></td>
      ${DIFFICULTIES.map((d) => `<td>${r[`${d}Left`]}<small>/${r[d]}</small></td>`).join('')}</tr>`).join('');
  $('#bankTable').innerHTML = sum.letters
    ? `<table class="stat-table bank-table"><thead><tr><th>Letter</th><th>Easy</th><th>Medium</th><th>Hard</th></tr></thead><tbody>${rows}</tbody></table>
       <p class="muted">Highlighted letters are on the current board. Numbers show unused / total.</p>`
    : '<p class="muted">No questions loaded.</p>';
}

function renderLog() {
  $('#log').innerHTML = state.log.map((l) => `<li><time>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>${esc(l.msg)}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>';
}

function syncSettingsForm() {
  const st = state.settings;
  $('#setTitle').value = st.title;
  $('#setBlue').value = state.teams.blue.name;
  $('#setGold').value = state.teams.gold.name;
  $('#setSize').value = st.size;
  $('#setTurn').value = st.turnRule;
  $('#setTimer').value = st.timerSecs;
  $('#setPass').checked = st.passOnWrong;
  $('#setShowQ').checked = st.showQuestion;
  $('#setSound').checked = st.sound;
  $('#setHide').checked = ui.hideAnswer;
}

/* Cheap per-250ms refresh for live clocks and board connection status. */
function tick() {
  const el = $('#qTimer');
  if (el) {
    const t = state.timer;
    if (t) {
      const left = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
      el.textContent = left ? `${left}s` : "Time's up!";
      el.classList.toggle('urgent', left <= 3);
    } else el.textContent = '';
  }
  const rt = $('#statRoundTime');
  if (rt) rt.textContent = fmtTime(roundElapsed());
  renderConn();
}

let toastSeq = 0;
function toast(msg, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  el.dataset.seq = ++toastSeq;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/* ------------------------------ Wiring ------------------------------ */

function wire() {
  $('#qPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const v = b.dataset.value;
    const actions = {
      ask: () => ask(v),
      another: () => ask(state.question?.difficulty || 'random', true),
      correct: markCorrect,
      incorrect: markIncorrect,
      cancel,
      timer: () => startTimer(Number(v)),
      stopTimer,
      randomLetter,
      newRound,
      setOwner: () => setOwner(v),
      applyLetter,
      redeal,
      clearClaims,
      closeEdit: () => setEditMode(false),
    };
    actions[b.dataset.action]?.();
  });
  $('#qPanel').addEventListener('keydown', (e) => {
    if (e.target.id === 'editLetter' && e.key === 'Enter') applyLetter();
  });

  $$('.team-btn').forEach((b) => b.addEventListener('click', () => setActive(b.dataset.team)));
  $('#btnSwap').addEventListener('click', () => setActive(other(state.active)));
  $('#btnOpenBoard').addEventListener('click', openBoard);
  $('#btnUndo').addEventListener('click', undo);
  $('#btnNewRound').addEventListener('click', () => {
    if (state.phase !== 'won' && state.cells.some((c) => c.owner) && !confirm('This round is still in play. Deal a new board anyway?')) return;
    newRound();
  });
  $('#btnReset').addEventListener('click', resetGame);
  $('#editMode').addEventListener('change', (e) => setEditMode(e.target.checked));

  $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    saveJSON(UI_KEY, ui);
    renderTab();
  }));

  // Settings
  $('#setSize').innerHTML = Object.entries(BOARD_SIZES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const setting = (id, key, read) => $(id).addEventListener('change', (e) => {
    commit((s) => { s.settings[key] = read(e.target); }, { undo: false });
  });
  setting('#setTurn', 'turnRule', (t) => t.value);
  setting('#setPass', 'passOnWrong', (t) => t.checked);
  setting('#setShowQ', 'showQuestion', (t) => t.checked);
  setting('#setSound', 'sound', (t) => t.checked);
  setting('#setTimer', 'timerSecs', (t) => Math.min(120, Math.max(3, Math.round(Number(t.value) || 10))));
  setting('#setTitle', 'title', (t) => t.value.trim() || DEFAULT_SETTINGS.title);
  for (const team of TEAMS) {
    $(`#set${team === 'blue' ? 'Blue' : 'Gold'}`).addEventListener('change', (e) => {
      const name = e.target.value.trim() || `${team === 'blue' ? 'Blue' : 'Gold'} Team`;
      commit((s) => { s.teams[team].name = name; }, { undo: false });
    });
  }
  $('#setSize').addEventListener('change', (e) => {
    if (!confirm('Changing the board size deals a fresh board for this round. Continue?')) {
      e.target.value = state.settings.size;
      return;
    }
    commit((s) => {
      if (s.winner) revokeWin(s);
      s.settings.size = e.target.value;
      dealBoard(s);
      s.lastAction = act('newround');
      addLog(s, `📐 Board size changed to ${BOARD_SIZES[s.settings.size].label}.`);
    });
  });
  $('#setHide').addEventListener('change', (e) => {
    ui.hideAnswer = e.target.checked;
    saveJSON(UI_KEY, ui);
    renderQ();
  });

  // Question bank
  $('#bankFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) loadBankText(await file.text());
    e.target.value = '';
  });
  $('#bankPasteLoad').addEventListener('click', () => loadBankText($('#bankPaste').value));
  $('#bankSample').addEventListener('click', async () => {
    const sample = await loadSampleBank();
    if (sample) useBank(sample, false);
  });
  $('#bankDownload').addEventListener('click', () => download(`${bank.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'questions'}.json`, bank));
  $('#bankResetUsed').addEventListener('click', () => {
    commit((s) => { s.used = {}; addLog(s, '♻️ Question history reset.'); }, { undo: false });
    toast('All questions are available again.', 'good');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const playing = state.selected != null && !editMode;
    const map = {
      1: () => playing && ask('easy'),
      2: () => playing && ask('medium'),
      3: () => playing && ask('hard'),
      r: () => playing && ask('random'),
      n: () => playing && state.question && ask(state.question.difficulty, true),
      c: () => playing && markCorrect(),
      x: () => playing && markIncorrect(),
      s: () => playing && startTimer(),
      t: () => setActive(other(state.active)),
      l: () => !editMode && randomLetter(),
      e: () => setEditMode(!editMode),
      b: openBoard,
      escape: cancel,
    };
    if (map[k]) {
      e.preventDefault();
      map[k]();
    }
  });

  // Another host tab changed the game? Keep this one in step.
  window.addEventListener('storage', (e) => {
    if (e.key !== STATE_KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue);
      if (validState(next) && next.rev > state.rev) {
        state = next;
        renderAll();
      }
    } catch { /* ignore */ }
  });
}

async function init() {
  const savedBank = loadJSON(BANK_KEY);
  if (savedBank) {
    try {
      bank = normalizeBank(savedBank);
      bankIsCustom = true;
    } catch { localStorage.removeItem(BANK_KEY); }
  }
  if (!bankIsCustom) bank = (await loadSampleBank()) || bank;

  const saved = loadJSON(STATE_KEY);
  if (validState(saved)) {
    state = saved;
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  } else {
    state = createGame(null);
  }
  wire();
  persist();
  setInterval(tick, 250);
}

init();
