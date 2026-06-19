# PROGRESS — volleyball-scoring (Flipper Zero)

## 2026-06-18 — Add Adjust mode (free score correction) (via Claude, Cowork)

**What was done**
- Per Dan's request: added a manual **Adjust scores** correction mode beyond
  the existing Undo. One screen, fully one-handed: Left = −1, Right = +1 on the
  selected team, OK = switch team (A⇄B), Back = done. Selected team shown in
  brackets; scores clamp at 0; opening Adjust after a set ended reopens it; the
  whole session is a single Undo.
- Refactored set-end detection into a shared `evaluate()` so a correction that
  reaches 25 (win by 2) settles into Set Over just like a normal point.
- Added menu entry "Adjust scores" (reindexed menu handlers).
- Extended `test/sim.js` with adjust scenarios (correction, A⇄B move, 0-clamp,
  correction-completes-a-set, single-undo-reverts-session). **50/50 green.**
- Tooling fix: excluded `test/` from `tsconfig.json` so the Flipper `noLib`
  build doesn't try to type-check the Node test harness.

**State:** branch `claude/flipper-volleyball-scorer`, build + tests green,
deployable `dist/volleyball-scoring.js` rebuilt. NOT pushed.

## 2026-06-18 — Initial build (via Claude, Cowork)

**What was done**
- Scaffolded a Flipper Zero JS SDK project (`@flipperdevices/fz-sdk` 0.1) from
  the official `create-fz-app` template.
- Built a full one-handed volleyball scoreboard in `index.ts`:
  - Rally scoring, sets to 25 (win by 2), 15-point decider, best of 5.
  - Automatic serve tracking (rally winner serves next; opening server
    alternates each set) + manual "Swap serve" override.
  - Undo (incl. across set/match boundaries), set history, in-game menu.
  - LED/vibration feedback per point / set win / match win.
- Wrote a hardware-free test harness (`test/sim.js`) that mocks the SDK and
  drives the **real compiled bundle** — 33 assertions across 5 scenarios, all
  green. `npm test` runs it.

**Key constraint discovered**
- Up/Down d-pad input is NOT reachable from a Flipper *JS* app (JS GUI only
  routes Left/OK/Right/Back). The requested Up=A / Down=B mapping is therefore
  impossible in JS; remapped to Left=A, Right=B, OK=Undo. A native C `.fap`
  rewrite would be required for Up/Down. Documented in README.

**State**
- Branch: `claude/flipper-volleyball-scorer` (git initialized locally).
- Build is green (`npm run build`), tests green (`npm test`).
- Deployable artifact committed: `dist/volleyball-scoring.js`.
- **NOT pushed** (per task instructions — local feature branch only).

**Next steps / open**
- Physical on-device test on Dan's Flipper (only thing not verifiable locally).
- Optional: persist match state to SD (`storage` module) so a mid-match
  power-off recovers — needs manual string serialization (no JSON in mJS).
- Optional: native C `.fap` rewrite for Up/Down scoring + big custom font.
