# PROGRESS — volleyball-scoring (Flipper Zero)

## 2026-07-25 — Merge-backlog check: nothing to merge (via Claude, laptop)

**Backlog said:** branch `claude/flipper-volleyball-scorer` needs a signed merge
to `main` + push.

**Reality:** already done, and not by a merge. On 2026-06-19 the feature branch
was **renamed** to `main` (reflog `7672450`) because the repo had no `main` and
no remote at the time. `main` now tracks `origin/main` at `5ce2bc5` (v1.1), in
sync, and no `claude/*` branch exists in any repo under `~/Developer`. The
`builds.md` entry was stale — corrected, including its wrong directory
(`~/Developer/volleyball-scoring` → `~/Developer/flipper-zero-volleyball-scorer`).

**Verified this session:** `tsc` clean (exit 0), `npm test` **64/64 green**.

**Uncommitted splash redesign left in the tree (deliberately not committed).**
`index.ts` + `dist/` carry a rework of the v1.1 net splash into a rounded
double-frame "card": frame, centered "VOLLEYBALL", a rule with filled circular
end-caps, "Score Keeper", Start button. It builds and the sim is green, but
**green means nothing here** — `flipper-extra.d.ts` types `widget` as `any` and
`test/sim.js` mocks it as `makeFactory(["button"])`, so neither `tsc` nor the
harness checks element props. If firmware `widget.c` doesn't take `w`/`h`/
`radius` on `rect`, the app throws `view has no prop named ...` at boot — the
same failure mode as the earlier submenu-`items` bug. Needs `npm start` on the
Mac and a look at the screen. Also an unreviewed design change: v1.1's net was
Dan's explicit call, so the card needs his sign-off, not just a passing build.

**NEEDS_INPUT:** (1) Dan to pick card vs. net splash; (2) on-device run to
validate the widget element schema before this is committed; (3) `git push` for
the two doc commits below (not pushed — push needs Dan's OK).

**Committed this session (local only, not pushed):** `CLAUDE.md` (was untracked)
and this note.

## 2026-06-19 — v1.1: widget splash screen (via Claude, Cowork)

**Added a title splash** shown at boot using the `widget` view (drawing): a
"VOLLEYBALL" / "Score Keeper" title, a drawn volleyball (circle + 3 seam lines),
and a center "Start" button. Pressing Start → serve-select; Back on the splash
exits the app.

**Firmware confirmed:** device is **1.4.3** (Dec 2025, official) — well past JS
SDK 1.0, so `widget` is available. The bundled `fz-sdk@0.1.3` predates the
`widget` type, so added `flipper-extra.d.ts` ambient shim
(`declare module ".../gui/widget"`) to satisfy `tsc`; esbuild keeps it external
and the device resolves `require(".../gui/widget")` at runtime like the rest.

**Splash element schema** (firmware `widget.c`): each child is an object with an
`element` field — `string`/`string_multiline` (x,y,align "tl".."br",font,text),
`circle`/`rect` (x,y,radius/size,fill), `line` (x1,y1,x2,y2), `button`
(button:"left"|"center"|"right", text → `button` event {key,type}). Splash
coords are a first guess for 128x64; tweak after eyeballing on-device.

**Tests:** sim mocks `gui/widget`, advances past the splash at boot, asserts the
Start→serve transition. **64/64 green.** tsc clean (exit 0).

**Splash redesign (Dan's call):** the drawn ball looked rough (widget can't draw
curves). Replaced with a clean type+net layout: "VOLLEYBALL" title, a net drawn
from straight lines (2 posts, top/bottom tapes, 7 vertical mesh strings),
"Score Keeper" subtitle, Start button. All crisp primitives.

**Still open:** the "outdated script" warning (cosmetic — bump `fz-sdk` dep to
match firmware to silence). Splash spacing can still be nudged after eyeballing.

## 2026-06-19 — v1.1 features: team names + settings (via Claude, Cowork)

**Added (JS, RAM-only state like the rest of the app):**
- **Team names** — menu "Rename teams" opens the `text_input` keyboard for Team
  A then Team B (cap 7 chars, blank falls back to A/B). Names thread through the
  scoreboard header, serving line, set-/match-over headers, and history. Adjust
  screen keeps A/B letters for space. Defaults render byte-identical to before,
  so existing sim assertions held.
- **Settings** — menu "Settings" → one toggle for the end-of-set alert. The JS
  `notification` module bundles sound+vibration in `success()` and can't split
  them, so OFF swaps in a silent green LED `blink` instead. (`endAlert` helper
  gates both the scoring and adjust-settle paths.)
- Menu reindexed to: Resume, Adjust, Swap serve, Set history, Rename teams,
  Settings, New match, Exit (0–7). Back handles the new settings/nameInput
  screens.

**Tests/build:** extended sim with Scenario 8 (rename flow + toggle + verifies
the alert really goes silent). **62/62 green.** `tsc` clean (exit 0) — important
because the device build is `tsc && esbuild`, so a type error would abort it.
Note: the `subscribe()` callback item type comes through unbound (the `Args`
constraint isn't met by the big state object), so the keyboard `text` is coerced
via `text as any`.

**Still open:** widget-drawn splash screen — needs the device's JS SDK version
(widget requires ≥1.0) before building. Naming layout on the 128px header to be
eyeballed on-device (cap can shrink if long names wrap).

**State:** source + bundle rebuilt, sim green, tsc clean. Redeploy `npm start`.

## 2026-06-19 — Fix on-device runtime error: implicit number→string (via Claude, Cowork)

**Bug**
- `ERROR implicit type conversion is prohibited` at bundle line 225. The render
  code builds display strings like `"A  " + self.a + ...` where `self.a` is a
  number. mJS refuses to implicitly coerce number→string in `+`. The Node sim
  coerces silently, so it passed there but failed on hardware.

**Fix**
- Added `numStr(n)` helper (wraps `Number.toString`, a firmware-backed SDK 0.1
  feature per `global.d.ts`) and wrapped every number that enters a display
  string in `render`, `setLine`, and `historyText`. Pure arithmetic (e.g.
  `setNum`) left alone. Rebuilt; sim **50/50 green**.
- If `.toString()` ever errors on a given firmware, it's a one-line swap inside
  `numStr` (e.g. a `chr()`-based digit builder).

**Also noted — benign "outdated script" warning:** the build stamps
`checkSdkCompatibility(0, 1)` from `fz-sdk@0.1.3`. Dan's firmware ships a newer
JS SDK, so it flags the script as outdated but still runs. Silencing it means
bumping the `@flipperdevices/fz-sdk` dev dep to match firmware (separate task).

**State:** source + bundle fixed, sim green. Redeploy `npm start`, rerun.

## 2026-06-19 — Fix on-device runtime error: submenu items are children (via Claude, Cowork)

**Bug**
- After the brace fix, on-device run got past parsing but threw
  `view has no prop named "items"` at the first `submenu.makeWith`. Verified
  against firmware source (`js_app/modules/js_gui/submenu.c` + `js_gui.c`):
  this firmware's submenu descriptor has ONLY a `header` prop. List entries are
  **children**, supplied as the SECOND argument of
  `makeWith(props, children)` (or via `setChildren`/`addChild`). The bundled
  SDK 0.1.3 types are out of sync — they declare an `items` prop that the
  firmware doesn't have.

**Fix**
- Rewrote both submenu views (`serve`, `menu`) to the 2-arg children form,
  casting through `(submenu as any).makeWith(...)` since the SDK type only
  allows one arg. Verified `dialog` (header/text/left/center/right) and
  `text_box` (text/font/focus) props DO match firmware — no change needed.
- Updated `test/sim.js` submenu mock to accept the children arg. Rebuilt;
  sim **50/50 green**. Bundle now emits
  `submenu.makeWith({header...}, [...entries])`.

**State:** source + bundle fixed, sim green. Redeploy with `npm start`, rerun.

## 2026-06-19 — Fix on-device parse error: brace all if/else (via Claude, Cowork)

**Bug**
- First on-device run failed: `parse error at line 119: [else]`. The Flipper JS
  engine accepts a brace-less `if` with no `else`, but rejects the trailing
  `else` of a brace-less single-statement `if/else`. The source used brace-less
  forms (e.g. `if (team==="A") self.a+=1; else self.b+=1;`), and esbuild
  (`minify:false`) faithfully preserves source braces — so brace-less source =
  brace-less bundle = device parse error.

**Fix**
- Braced every `if/else` body in `index.ts` (evaluate set-end, score a/b, the
  win/notify branch, and the scoreboard-input button dispatches). Brace-less
  `if` with no `else` left as-is (parses fine).
- Confirmed esbuild preserves braces (tested v0.24.2). Rebuilt
  `dist/volleyball-scoring.js`; verified zero brace-less `else` in the bundle.
  Sim **50/50 green** against the freshly-built bundle.

**Workspace note for future sessions**
- The mounted `node_modules/esbuild` is the macOS binary; it cannot run in the
  Linux build sandbox (`npm run build` fails at the esbuild step there). Build
  on the Mac (`npm start`) for real deploys. To validate a build inside the
  sandbox, use `esbuild-wasm` of the matching version.

**State:** branch `main`, source fixed, bundle rebuilt + verified. Deploy with
`npm start` on the Mac, then run on device.

## 2026-06-19 — Promote feature branch to main (via Claude, Cowork)

**What was done**
- Dan approved shipping the volleyball scorer. The repo had no `main` branch and
  no `origin` remote (local-only, no GitHub remote configured), so the planned
  signed `--no-ff` merge to `main` + push to `origin/main` was not possible as
  written. Per Dan's pick, renamed the feature branch
  `claude/flipper-volleyball-scorer` → `main` instead (no merge commit, no
  divergent history to reconcile). The old feature branch no longer exists
  (renamed, not deleted separately).
- HEAD (now `main`): `7672450` — 50/50 tests green, deploy-ready.

**State:** branch `main`, working tree clean. **Pushed to
`origin/main`** — remote `origin` =
`https://github.com/dafogs/flipper-zero-volleyball-scorer.git`. `main` tracks
`origin/main`.

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
