/* ==========================================================================
   HEX CHAIN — Contestant Board (the screen shared in Teams).
   Receives only the public game state: no answers, no question database.
   ========================================================================== */

import { BoardView } from './render.js';
import { BoardSync } from './sync.js';
import { sfx, unlockAudio, setSoundEnabled } from './sfx.js';
import { Confetti } from './confetti.js';
import { startBokeh } from './bokeh.js';

const $ = (id) => document.getElementById(id);
const TEAM_COLORS = {
  blue: ['#1e7bff', '#5cc2ff', '#ffffff', '#0a2c9c', '#a8e1ff'],
  gold: ['#ffc928', '#fff4b0', '#ffffff', '#b06d00', '#ffe066'],
};

const view = new BoardView($('board'), { variant: 'board' });
const confetti = new Confetti($('confetti'));
let last = null;
let muted = false;
let winTimers = [];
let timerKey = null;
let lastSecond = null;

function apply(s) {
  if (!s || s.v !== 1 || !Array.isArray(s.cells)) return;
  const first = !last;
  $('waiting').hidden = true;
  setSoundEnabled(s.sound !== false && !muted);

  view.render(s);
  renderHeader(s);
  renderTeams(s);
  renderStatus(s);
  renderQuestion(s);
  if (!first && s.lastAction?.id !== last.lastAction?.id) react(s);
  renderWinner(s, first);
  if (s.timer?.endsAt !== last?.timer?.endsAt) {
    timerKey = s.timer?.endsAt ?? null;
    lastSecond = null;
  }
  last = s;
}

function renderHeader(s) {
  $('showTitle').textContent = s.title || 'HEX CHAIN';
  $('roundBadge').textContent = `ROUND ${s.round}`;
  document.title = `${s.title || 'HEX CHAIN'} — Contestant Board`;
}

function renderTeams(s) {
  for (const t of ['blue', 'gold']) {
    $(`name-${t}`).textContent = s.teams[t].name;
    $(`hex-${t}`).textContent = s.cells.filter((c) => c.owner === t).length;
    $(`rounds-${t}`).textContent = s.teams[t].rounds;
    const card = $(`card-${t}`);
    card.classList.toggle('active', s.active === t && s.phase !== 'won');
    card.classList.toggle('winner', s.winner === t);
    card.classList.toggle('loser', !!s.winner && s.winner !== t);
  }
}

function renderStatus(s) {
  const bar = $('statusBar');
  const active = s.teams[s.active]?.name ?? '';
  let text;
  if (s.phase === 'won') text = `${s.teams[s.winner].name} complete the chain!`;
  else if (s.selected != null) {
    const letter = s.cells[s.selected].letter;
    text = s.stealing ? `Over to ${active} — can they steal “${letter}”?` : `${active} — playing for “${letter}”`;
  } else text = `${active} — pick a letter`;
  $('statusText').textContent = text;
  bar.dataset.team = s.phase === 'won' ? s.winner : s.active;
}

/* Lower-third question card: only when the host opts in. Its row is reserved
   for the whole round so the board doesn't jump when a question appears. */
function renderQuestion(s) {
  const card = $('questionCard');
  const q = s.question;
  const reserve = !!s.showQuestion && s.phase !== 'won';
  const show = reserve && !!q?.text;
  card.hidden = !reserve;
  card.classList.toggle('qc-idle', !show);
  if (!show) return;
  card.dataset.team = s.active;
  $('qcLetter').textContent = q.letter;
  $('qcKicker').textContent = `${q.difficulty.toUpperCase()} QUESTION`;
  if ($('qcText').textContent !== q.text) {
    $('qcText').textContent = q.text;
    card.classList.remove('qc-in');
    card.getBoundingClientRect();
    card.classList.add('qc-in');
  }
}

function flash(text, kind, sub = '') {
  const el = $('flash');
  el.innerHTML = '';
  const main = document.createElement('div');
  main.className = 'flash-main';
  main.textContent = text;
  el.appendChild(main);
  if (sub) {
    const s2 = document.createElement('div');
    s2.className = 'flash-sub';
    s2.textContent = sub;
    el.appendChild(s2);
  }
  el.className = 'flash';
  el.getBoundingClientRect();
  el.className = `flash show flash-${kind}`;
}

function react(s) {
  const a = s.lastAction;
  const teamName = (t) => s.teams[t]?.name ?? '';
  switch (a.type) {
    case 'select': sfx.select(); break;
    case 'correct':
      sfx.correct();
      flash('CORRECT!', a.team, `${teamName(a.team)} take “${s.cells[a.cell]?.letter ?? ''}”`);
      break;
    case 'incorrect':
      sfx.wrong();
      flash('INCORRECT', 'wrong', a.passTo ? `Over to ${teamName(a.passTo)}` : '');
      break;
    case 'win':
      sfx.correct();
      break;
    case 'newround':
    case 'reset':
      sfx.whoosh();
      break;
    default: break;
  }
}

function renderWinner(s, first) {
  const overlay = $('winner');
  const isWon = s.phase === 'won' && s.winner;
  const wasWon = last?.phase === 'won' && last?.winner === s.winner;
  if (!isWon) {
    winTimers.forEach(clearTimeout);
    winTimers = [];
    overlay.hidden = true;
    overlay.classList.remove('show', 'compact');
    if (last?.phase === 'won') confetti.stop();
    return;
  }
  if (wasWon && !first) return;
  $('winnerKicker').textContent = `ROUND ${s.round} CHAMPIONS`;
  $('winnerName').textContent = s.teams[s.winner].name;
  overlay.dataset.team = s.winner;
  const reveal = () => {
    overlay.hidden = false;
    overlay.getBoundingClientRect();
    overlay.classList.add('show');
  };
  if (first) {
    reveal();
    overlay.classList.add('compact');
    return;
  }
  winTimers.push(setTimeout(() => {
    reveal();
    sfx.win();
    confetti.celebrate(TEAM_COLORS[s.winner]);
  }, 1500));
  winTimers.push(setTimeout(() => overlay.classList.add('compact'), 7000));
}

/* Countdown ring — driven from the host's absolute end time. */
function tickTimer() {
  const box = $('timer');
  const t = last?.timer;
  if (!t || last.phase === 'won') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const leftMs = Math.max(0, t.endsAt - Date.now());
  const sec = Math.ceil(leftMs / 1000);
  const frac = Math.min(1, leftMs / (t.secs * 1000));
  const C = 2 * Math.PI * 44;
  const ring = $('timerRing');
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C * (1 - frac)}`;
  $('timerText').textContent = sec;
  box.classList.toggle('urgent', sec <= 3);
  if (timerKey === t.endsAt && sec !== lastSecond) {
    if (lastSecond !== null) {
      if (sec === 0) {
        sfx.timeout();
        flash("TIME'S UP", 'wrong');
      } else if (sec <= 3) sfx.tick();
    }
    lastSecond = sec;
  }
}
setInterval(tickTimer, 100);

/* Start overlay: unlock audio (browser autoplay policy) and offer full screen. */
$('startOverlay').addEventListener('click', () => {
  unlockAudio();
  $('startOverlay').classList.add('gone');
  setTimeout(() => $('startOverlay').remove(), 600);
});

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (k === 'm') {
    muted = !muted;
    setSoundEnabled(!muted && last?.sound !== false);
    flash(muted ? 'MUTED' : 'SOUND ON', 'info');
  }
});

startBokeh($('bokeh'));
new BoardSync(apply).start();
