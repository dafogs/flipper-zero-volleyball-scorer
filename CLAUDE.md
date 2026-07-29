# CLAUDE.md — Flipper Zero Volleyball Scorer

One-handed volleyball scoreboard app for the Flipper Zero device. TypeScript compiled to JS for the Flipper's mJS engine. Standard indoor volleyball rules: rally scoring, sets to 25 (win by 2), 15-point decider, best of 5.

---

## File map

| Path | Description |
|------|-------------|
| `index.ts` | Entire app -- all UI, scoring logic, input handling (~600 lines) |
| `dist/volleyball-scoring.js` | Deployable artifact (bundled JS, committed) |
| `dist/index.js` | Intermediate tsc output |
| `test/sim.js` | Hardware-free test harness (64 assertions, mocks all SDK modules) |
| `flipper-extra.d.ts` | Ambient type shim for `widget` view (SDK 0.1.3 predates it) |
| `fz-sdk.config.json5` | Build output + device upload paths, minify off |
| `tsconfig.json` | `noLib: true`, ES2015 target, CommonJS modules |
| `package.json` | Package name: `volleyball-scoring`, deps: `@flipperdevices/fz-sdk@^0.1` |
| `PROGRESS.md` | Project breadcrumbs |

## Architecture

Single-file app (`index.ts`) with all state in one `S` object passed as `self` to every function (mJS has no closures). Views use Flipper SDK modules (`dialog`, `submenu`, `text_box`, `text_input`, `widget`). Event loop drives all navigation.

**Controls:** Up = Team A point, Down = Team B point, Ok = undo, Left = menu. Adjust mode for score corrections.

**Features:** Splash screen (widget with net graphic), team rename (7-char cap), settings (alert toggle), undo (including across set/match boundaries), set history, serve tracking with manual swap.

## mJS engine constraints (critical)

These constraints apply to all code in this project:
- **No closures** -- thread state through `self` parameter
- **No template literals** -- use string concatenation
- **No `Math` or `JSON` globals** -- use helpers (`numStr()`, manual min/max)
- **Arrays only have `push`/`splice`/`length`** -- no `map`, `filter`, `forEach`, `includes`
- **Brace all `if/else` bodies** -- braceless `if...else` causes mJS parse errors
- **Import order matters:** `eventLoop` before `gui`, `gui` before gui submodules

## Commands

```bash
npm run build    # tsc + esbuild bundle -> dist/volleyball-scoring.js
npm start        # build + upload to device via USB
npm test         # build + run test/sim.js (Node harness)
```

**Important:** The mounted `node_modules/esbuild` is the macOS binary. It will not run in a Linux sandbox. Build on the Mac for real deploys. For sandbox validation, swap to `esbuild-wasm`.

## Deploy

Copy `dist/volleyball-scoring.js` to Flipper Zero SD card at `/ext/apps/Scripts/volleyball-scoring.js` (or use `npm start` for USB upload).

Device firmware: 1.4.3. SDK version stamp triggers a benign "outdated script" warning at runtime.

## Outstanding items

- State is RAM-only (no persistence across power-off)
- Possible native C `.fap` rewrite for Up/Down scoring
- Bump `fz-sdk` dep to silence outdated-script warning
- Card splash (v1.2) is committed and pushed, but its `widget` element schema is
  **unvalidated on hardware** — `rect`'s `w`/`h`/`radius` and `circle`'s props
  are a best guess against firmware `widget.c`. Neither `tsc` nor `test/sim.js`
  can catch a bad element prop: the shim is `any` and the mock only wires up the
  `button` contract. A wrong prop name throws `view has no prop named ...` at
  boot, so `main` may not run on-device until someone eyeballs it via `npm start`.

## External references

- Builds entry: "Volleyball Scoring App" (P8) in `~/Developer/builds-system/builds.md`
- Flipper JS SDK docs: https://developer.flipper.net/
- GitHub: `dafogs/flipper-zero-volleyball-scorer`
