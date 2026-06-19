# 🏐 Volleyball Scoreboard — Flipper Zero

A one-handed, courtside volleyball scorekeeper for the [Flipper Zero](https://flipperzero.one/),
written in JavaScript against the official Flipper JS SDK.

Standard indoor rules: rally scoring, sets to 25 (win by 2), a 15-point decider
fifth set, best of 5, with automatic serve tracking.

```
┌──────────────────────────────┐   128 x 64 monochrome LCD
│        A  14    11  B         │ ← current set score (bold header)
│                              │
│  Set 1  -  first to 25       │ ← set number + target
│  Sets   A 0   B 0            │ ← sets won
│  Serving:  Team A            │ ← who is serving now
│                              │
│ [ +A ]    [ Undo ]    [ +B ] │ ← Left / OK / Right soft buttons
└──────────────────────────────┘
```

---

## One-handed controls

Dan holds this at the net, so every action is on the d-pad and OK button — no
two-hand reach, no menu diving during a rally.

| Button | PLAY screen        | SET OVER     | MATCH OVER   |
|--------|--------------------|--------------|--------------|
| **←**  | +1 Team A          | Undo         | Undo         |
| **OK** | Undo last point    | Next set     | New match    |
| **→**  | +1 Team B          | —            | —            |
| **Back** | Open menu        | Open menu    | Open menu    |

The **menu** (Back) holds the less-frequent actions: Resume, **Adjust scores**,
Swap serve, Set history, New match, Exit app.

### Fixing mistakes

Two layers, because tapping the wrong button at the net happens:

1. **Undo** (OK during play) — instantly reverses the last point, even a
   set- or match-deciding one.
2. **Adjust scores** (Menu → Adjust scores) — a free correction screen for
   anything Undo can't cover, like a call reversal that should move a point
   from one team to the other:

   | Button | Adjust screen |
   |--------|---------------|
   | **←**  | −1 to the selected team |
   | **→**  | +1 to the selected team |
   | **OK** | switch selected team (A ⇄ B) |
   | **Back** | done — re-checks whether the corrected score ends the set |

   The selected team is shown in brackets, e.g. `[A 14]  11 B`. Scores can't go
   below zero. If you open Adjust right after a set "ended", it reopens that set
   so the live score is editable. The whole correction session counts as a
   single Undo afterwards.

Tactile feedback (no need to look): a short **green** LED blink on each point, a
**blue** blink on undo, and the full success buzz/flash when a set or match is won.

### Why not Up/Down for the two teams?

The original spec suggested **Up = Team A, Down = Team B**. That isn't possible
in a Flipper *JavaScript* app: the JS SDK's GUI only routes **Left / OK (center)
/ Right / Back** to a view. Raw Up/Down d-pad input is only reachable from a
native **C** app that owns a `ViewPort` — which the JS engine deliberately does
not expose (see the SDK's `gui` module docs: "ViewPort only … Available from JS:
❌").

So this app maps scoring to the next-best one-handed pair — **Left = Team A,
Right = Team B** (they line up with the two sides of the court) — and puts Undo
on the easy center **OK** button. If true Up/Down scoring is a hard requirement,
it would need a rewrite as a native C `.fap` app; happy to do that as a follow-up.

---

## Rules implemented

- **Rally scoring** — every rally is a point for the team that wins it.
- **Sets to 25, win by 2** (no cap — pure win-by-2, per standard FIVB indoor).
- **Fifth set to 15, win by 2**, played only when the match reaches 2–2.
- **Best of 5** — first team to win 3 sets takes the match.
- **Serve tracking** — in rally scoring the team that wins a rally serves next,
  so the serving indicator flips automatically on every side-out. The opening
  server **alternates each set** from whoever you pick at the start; use
  *Menu → Swap serve* to correct it for an odd-numbered decider coin toss.
- **Undo** — every point is undoable, including a set- or match-deciding point
  (undo un-records the set and restores the live score).

---

## Build & deploy

### Prerequisites
- Node.js (tested on v26) and npm
- A Flipper Zero on current firmware (JS SDK 0.1+)
- The [qFlipper](https://flipperzero.one/update) desktop app **or** USB cable

### Install deps
```bash
cd ~/Developer/volleyball-scoring
npm install
```

### Build the deployable script
```bash
npm run build
```
This type-checks (`tsc`) and bundles to a single device-ready file:
**`dist/volleyball-scoring.js`**.

### Deploy — option A: one command over USB (easiest)
Plug the Flipper in via USB and run:
```bash
npm start
```
This builds and uploads straight to `/ext/apps/Scripts/volleyball-scoring.js`
on the SD card (path is configured in `fz-sdk.config.json5`).

### Deploy — option B: copy the file manually
1. Run `npm run build`.
2. Copy `dist/volleyball-scoring.js` onto the Flipper's SD card at:
   `/ext/apps/Scripts/volleyball-scoring.js`
   - via **qFlipper**: open the file browser → `SD Card/apps/Scripts/` → drag it in, or
   - pop the microSD into your computer and copy it to `apps/Scripts/`.

### Run it on the device
On the Flipper: **Apps → Scripts → volleyball-scoring**. Pick who serves first
and you're scoring.

---

## Tests

The game logic (scoring, win-by-2, decider target, serve side-outs, set
alternation, undo, navigation) is verified locally without hardware: a Node
harness mocks the SDK modules and drives the **real compiled bundle** through
full match scenarios.

```bash
npm test          # builds, then runs test/sim.js
```

---

## Project layout

| File | Purpose |
|------|---------|
| `index.ts` | The app — all UI, rules, and input handling |
| `test/sim.js` | Hardware-free simulation of the compiled logic |
| `fz-sdk.config.json5` | Build output + device upload paths |
| `dist/volleyball-scoring.js` | Built, device-ready script (the thing you deploy) |

---

## Notes & possible enhancements

- **State lives in RAM only.** Closing the app loses the score. Back is mapped
  to the menu (not exit) so it's hard to lose a match by accident, but a persisted
  state file (so a power-off mid-match recovers) is a clear next step — it would
  need manual string serialization since the JS engine has no `JSON`.
- **Custom team names / colors** aren't possible with the JS SDK's stock dialog
  view; the "A"/"B" labels are a deliberate constraint of staying in JavaScript.
- A native **C `.fap`** rewrite would unlock Up/Down scoring, a big custom-drawn
  scoreboard font, and persistence — at the cost of the much simpler JS workflow.

### About the JavaScript engine (constraints baked into this code)
The Flipper runs an **mJS** engine, not full JS. This app is written around its
limits: **no closures** (all state is threaded through `subscribe()` callbacks),
no template literals, no `Math`/`JSON`, and arrays expose only
`push`/`splice`/`length`. If you extend `index.ts`, keep to those rules.
