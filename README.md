# HEX CHAIN: the letter-link quiz show

HEX CHAIN is a hexagon quiz game show for Microsoft Teams icebreakers. It is inspired by classic UK TV letter-board quizzes, but the name, branding, visuals and sounds are all original.

- **Host Dashboard** (`host.html`): your private control panel. It shows questions and answers, Correct/Incorrect buttons, overrides, statistics and settings.
- **Contestant Board** (`board.html`): the TV-style screen you share in Teams. It shows the board, the teams, whose turn it is, the timer and the celebrations. It never shows answers.

It's static HTML, CSS and JavaScript (ES modules), with no build step, no framework, no backend and no accounts. Any static host can serve it.

---

## 1. Architecture

```
┌──────────────────────────── Host's browser ────────────────────────────┐
│                                                                         │
│  host.html  (private)                       board.html  (screen-shared) │
│  ┌──────────────────────┐   public state   ┌─────────────────────────┐  │
│  │ host.js              │ ───────────────▶ │ board.js                │  │
│  │  • authoritative     │  BroadcastChannel│  • renders board/teams  │  │
│  │    game state        │  + localStorage  │  • animations, confetti │  │
│  │  • question bank     │ ◀─────────────── │  • sound (Web Audio)    │  │
│  │    (answers live     │   "hello" pings  │  • NO answers, NO bank  │  │
│  │     here ONLY)       │                  └─────────────────────────┘  │
│  └──────────────────────┘                                               │
│        │  game.js   pure logic: hex grid, BFS win detection, bank       │
│        │  render.js shared SVG board renderer                           │
│        └─ localStorage: state survives refreshes                        │
└─────────────────────────────────────────────────────────────────────────┘
                 │ Teams "Share → Window" (board window only)
                 ▼
         Everyone in the meeting just watches
```

**Why this is the simplest workable design:**

| Concern | Choice | Why |
|---|---|---|
| Hosting | Static files | Works on GitHub Pages, Netlify or Vercel. Nothing to run or pay for. |
| Real-time sync | [`BroadcastChannel`](https://developer.mozilla.org/docs/Web/API/BroadcastChannel) between two windows of the host's browser | Updates arrive instantly with no server, no API keys and no latency. Contestants see the board through the Teams screen share, so they only need Teams. |
| Late joiners/refresh | Public state is also cached in `localStorage`. The board asks for it with a `hello` message when it opens. | You can open or refresh the board at any point. |
| Answer secrecy | `host.js → toPublic()` removes answers before anything is published. `board.html` never loads `questions.json`. | Answers never reach the board page or the data it receives, so they can't appear on the shared screen. |
| Win detection | Breadth-first search over the hex adjacency graph (`game.js → findWinPath`). It runs after every change, including manual overrides. | It returns the shortest winning chain, which is then animated. |

> **Need contestants to open the board on their own devices?** You'll need a cloud relay instead of `BroadcastChannel`. `js/sync.js` is the only file that knows about transport. See *Future enhancements → Cross-device sync*.

### Game rules as implemented

- The default board is 5 columns × 4 rows of flat-topped hexagons, with odd columns offset (the classic layout). 5×5 and 6×5 boards are also available.
- **Blue** wins with a chain from the **left** edge to the **right** edge. **Gold** wins with a chain from the **top** edge to the **bottom** edge. On a hex grid both teams can never win at once, and a full board always has exactly one winner.
- A correct answer claims the hex for the active team. An incorrect answer leaves it open.
- After a wrong answer, the other team can try to **steal** the same question (you can turn this off). If both teams miss, the hex stays open.
- Turn order is configurable. By default turns alternate; the other option is that the team who answers correctly picks next.

---

## 2. Folder structure

```
hexchain/
├── index.html          Landing page linking to both screens
├── host.html           Host Dashboard (private control panel)
├── board.html          Contestant Board (share this window)
├── css/
│   ├── common.css      Colour tokens + hex board styles/animations (both screens)
│   ├── host.css        Control panel styling
│   └── board.css       TV studio styling, scoreboard, winner overlay
├── js/
│   ├── game.js         Pure logic: grid adjacency, win detection, question bank
│   ├── render.js       SVG hex board renderer (shared)
│   ├── sync.js         Host ⇄ board sync (BroadcastChannel + localStorage)
│   ├── host.js         Host state, actions, UI, shortcuts, stats
│   ├── board.js        Board rendering, reactions, timer, winner sequence
│   ├── sfx.js          Synthesised sound effects (no audio files)
│   ├── confetti.js     Canvas confetti
│   └── bokeh.js        Animated studio-light background
├── data/
│   └── questions.json  Sample bank: 26 letters × 3 difficulties × 2 = 156 questions
├── .nojekyll           Stops GitHub Pages from processing the files with Jekyll
└── README.md
```

---

## 3. Run it locally

ES modules and `fetch()` don't work from `file://`, so serve the folder over HTTP:

```bash
cd hexchain
```

```bash
python3 -m http.server 8080
```

or

```bash
npx serve .
```

Then open <http://localhost:8080/host.html>.

---

## 4. Hosting a game in Microsoft Teams

1. Open **`host.html`** and click **Open Contestant Board ↗**. The board opens in a new window in the **same browser**, which sync requires.
2. In Teams, click **Share → Window** and pick the board window. Turn on **Include sound** to share the sound effects.
3. Click once on the board to go live. This unlocks audio, because browsers block sound until you interact with the page. Press **F** for full screen if you're presenting from a second monitor.
4. Keep the host window private. Turn on *Safe mode* in Settings to blur answers until you hover over them.
5. Name the teams in **Settings**. Splitting the meeting into two breakout groups works well.

**Gameplay loop:** a team calls a letter → you click that hex → choose **Easy / Medium / Hard / Random** → read the question aloud → click **Correct** or **Incorrect**. Optionally, start the answer timer, which shows as a countdown ring on the board.

### Keyboard shortcuts (host)

| Key | Action | Key | Action |
|---|---|---|---|
| `1` `2` `3` | Easy / Medium / Hard question | `R` | Random difficulty |
| `N` | Another question | `S` | Start the answer timer |
| `C` | Correct | `X` | Incorrect |
| `T` | Switch the active team | `L` | Pick a random letter |
| `E` | Toggle edit mode | `Esc` | Deselect the hex |
| `Ctrl/⌘+Z` | Undo | `B` | Open the board window |

On the board, `F` toggles full screen and `M` mutes.

---

## 5. Question sets

Load a set from **Questions → Load JSON file**, or paste JSON into the box on the same tab. A custom set is remembered in the browser. **Restore sample set** switches back to `data/questions.json`.

**Canonical format:**

```json
{
  "name": "Office Trivia",
  "questions": {
    "A": {
      "easy":   [{ "q": "What A is the largest continent?", "a": "Asia" }],
      "medium": [{ "q": "What A is the capital of Greece?", "a": "Athens" }],
      "hard":   [{ "q": "What A is the SI unit of current?", "a": "Ampere" }]
    }
  }
}
```

**Flat format** (easy to export from Excel or Google Sheets and convert to JSON):

```json
[
  { "letter": "A", "difficulty": "easy", "question": "What A is the largest continent?", "answer": "Asia" },
  { "letter": "B", "difficulty": "hard", "question": "What B is …?", "answer": "…" }
]
```

- Each letter can have any number of questions at each difficulty.
- Used questions are tracked so they aren't repeated. When a pool runs out, a question is reused and labelled *repeat*.
- Board letters are dealt from letters that have questions. You can also type any letter in edit mode and ask your own question.
- Tip: put in-jokes about your team or company in the questions. That makes the best icebreakers.

---

## 6. Deployment

The repo root (the folder containing `index.html`) is the site. There's no build command.

### GitHub Pages

1. Create a repository and push the `hexchain` folder contents to it:
   ```bash
   cd hexchain
   ```
   ```bash
   git init && git add . && git commit -m "HEX CHAIN game show"
   ```
   ```bash
   git branch -M main
   ```
   ```bash
   git remote add origin https://github.com/<you>/hexchain.git
   ```
   ```bash
   git push -u origin main
   ```
2. On GitHub, go to **Settings → Pages → Build and deployment**. Set **Source: Deploy from a branch**, **Branch: `main` / `(root)`**, and save.
3. After a minute or so the site is live at `https://<you>.github.io/hexchain/`. The host page is at `…/hexchain/host.html`.

All paths in the app are relative, so it works from a project sub-path. `.nojekyll` is included.

### Netlify

- **Drag and drop:** go to <https://app.netlify.com/drop> and drop the `hexchain` folder. You get a live URL straight away.
- **Git:** choose *Add new site → Import an existing project*, pick the repo, leave **Build command** empty and set **Publish directory** to `.` (or the folder name if it's nested).
- **CLI:**
  ```bash
  npm i -g netlify-cli
  ```
  ```bash
  cd hexchain && netlify deploy --prod --dir .
  ```

### Vercel

- **Dashboard:** choose *Add New → Project*, import the repo, set **Framework Preset: Other**, leave the build command empty and set the **Output Directory** to `.` (the root).
- **CLI:**
  ```bash
  npm i -g vercel
  ```
  ```bash
  cd hexchain && vercel --prod
  ```
  Accept the defaults. Vercel detects that it's a static site.

> Optional: the host page has `<meta name="robots" content="noindex">`. Answers are only in `data/questions.json` and in custom sets loaded into your own browser. If you host a sensitive set publicly, keep it out of the repo and load it at game time with **Load JSON file**.

---

## 7. Future enhancement ideas

- **Cross-device sync.** Replace `js/sync.js` with an adapter for Firebase Realtime Database, Supabase Realtime, Ably or PartyKit. Use a room code, with the host writing and boards subscribing, so players can open the board on their own laptops. The interface stays `publish(publicState)` / `onState(cb)`. Keep answers on the host only.
- **Buzzers.** Players join on their phones at `/buzz?room=ABCD` and buzz in. The host sees who was first, with latency compensation.
- **Teams integration.** Package the board as a Teams Meeting App (meeting stage view with Live Share SDK) so it runs inside the meeting with no screen share.
- **Classic gold run.** A bonus round where the winning team races against the clock across a 5-letter strip of multi-letter answers.
- **Question editor UI.** Create and edit questions in the dashboard, import CSV, and tag categories such as *Company*, *Pop Culture* or *Science*.
- **AI question generation.** Generate a themed set on demand ("questions about our Q3 product launch"), with the host checking it before use.
- **Themes and branding.** Company logo upload, custom team colours, alternative studio themes, and a seasonal pack for the Christmas quiz.
- **More scoring modes.** Best of 3 or 5 match play, points per hex, double-points hard questions, a power-up hex.
- **Accessibility.** Screen-reader narration of board changes, high-contrast and colour-blind palettes (patterns on hexes), adjustable motion.
- **Analytics export.** Download game stats as CSV and show a leaderboard across sessions.
- **Host remote.** A phone-friendly host view, so you can run the game from your phone while your laptop shares the board.
- **Original music.** Commissioned or royalty-free stings for the intro, correct answer and win.
