// Local simulation test for the Volleyball Scoreboard.
//
// The Flipper JS SDK modules (event_loop, gui, notification, ...) only exist on
// the device, so we mock them here and run the REAL compiled logic
// (dist/index.js) inside a vm sandbox. We capture the subscribed callbacks and
// the dialog props, then drive button presses and assert the resulting state.
//
// Run with:  npm run build && node test/sim.js
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------
let nextId = 1;
function contract() { return { __id: nextId++ }; }

// callback registry: contract.__id -> { cb, arg }
const subs = {};

function makeView(extraContracts) {
    const v = {
        props: {},
        set(k, val) { this.props[k] = val; },
    };
    for (const name of extraContracts) v[name] = contract();
    return v;
}

function makeFactory(extraContracts) {
    return {
        make() { return makeView(extraContracts); },
        makeWith(initial) {
            const v = makeView(extraContracts);
            for (const k in initial) v.props[k] = initial[k];
            return v;
        },
    };
}

let stopped = false;
const navigation = contract();
let currentView = null;

const notifications = []; // log of feedback calls

const modules = {
    "@flipperdevices/fz-sdk/event_loop": {
        subscribe(c, cb, arg) { subs[c.__id] = { cb, arg }; return { cancel() {} }; },
        run() { /* no-op in sim */ },
        stop() { stopped = true; },
        timer() { return contract(); },
    },
    "@flipperdevices/fz-sdk/gui": {
        viewDispatcher: {
            navigation,
            currentView: null,
            switchTo(v) { currentView = v; this.currentView = v; },
            sendCustom() {},
            sendTo() {},
        },
    },
    "@flipperdevices/fz-sdk/gui/dialog": makeFactory(["input"]),
    "@flipperdevices/fz-sdk/gui/submenu": makeFactory(["chosen"]),
    "@flipperdevices/fz-sdk/gui/text_box": makeFactory(["chosen"]),
    "@flipperdevices/fz-sdk/notification": {
        success() { notifications.push("success"); },
        error() { notifications.push("error"); },
        blink(c) { notifications.push("blink:" + c); },
    },
};

// ---------------------------------------------------------------------------
// Load the compiled app into a sandbox
// ---------------------------------------------------------------------------
const code = fs.readFileSync(path.join(__dirname, "..", "dist", "index.js"), "utf8");
const sandbox = {
    require(name) {
        if (modules[name]) return modules[name];
        throw new Error("Unexpected require: " + name);
    },
    exports: {},
    module: { exports: {} },
    console,
};
sandbox.module.exports = sandbox.exports;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "dist/index.js" });

// Grab handles to the views the app created (by replaying the factory output).
// Easiest: re-derive contract ids by inspecting the registry + a fresh probe.
// Instead we expose them: the app stored everything on S, but S isn't exported.
// We reconstruct access through the captured subscriptions + view dispatcher.

// The dialog's `input` contract is whatever the score view registered. We find
// each view by which contract a subscription is keyed to and what it does.
// Simpler: the app switched to the serve view at boot -> currentView is it.
const serveView = currentView; // submenu shown at boot

// Map subscription ids to a label by probing. We know there are 4 subs:
//   serve.chosen, score.input, menu.chosen, navigation.
// Identify navigation by its known contract id.
function fire(c, item) {
    const s = subs[c.__id];
    if (!s) throw new Error("no subscriber for contract " + c.__id);
    s.cb({ cancel() {} }, item, s.arg);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
function eq(actual, expected, msg) {
    if (actual === expected) { pass++; }
    else { fail++; console.log("  FAIL: " + msg + "\n    expected: " + JSON.stringify(expected) + "\n    actual:   " + JSON.stringify(actual)); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

// The score (dialog) view is the one with an `input` contract.
const scoreView = serveView.input ? null : findScoreView();
function findScoreView() {
    // The serve view is a submenu (has .chosen). The score view is a dialog
    // (has .input). We can reach it because the app switched to serve at boot,
    // and the score view is the target of the input subscription's view.
    // We don't have a direct ref, so we expose it via the dispatcher after we
    // navigate to it. For now return null; we read currentView after switching.
    return null;
}

// Identify contracts: serve.chosen is on the boot view.
const serveChosen = serveView.chosen;

// We need score.input, menu.chosen. Find them among subs (exclude navigation
// and serveChosen).
const otherSubIds = Object.keys(subs).map(Number)
    .filter(id => id !== navigation.__id && id !== serveChosen.__id);
// score.input vs menu.chosen: the score view is a dialog. We discover by firing
// serve.chosen(0) which switches to the score view; then currentView is it.

console.log("=== Scenario 1: Team A wins a set 25-23, serve tracking ===");
fire(serveChosen, 0); // Team A serves first
const score = currentView; // dialog
ok(score.props.header !== undefined, "score view shown after serve select");
eq(score.props.text.indexOf("Serving:  Team A") >= 0, true, "Team A serves first");

const scoreInput = score.input;
// helper to read header/text
function H() { return score.props.header; }
function T() { return score.props.text; }

// A scores once -> A still serving, 1-0
fire(scoreInput, "left");
eq(H(), "A  1    0  B", "header 1-0");
eq(T().indexOf("Serving:  Team A") >= 0, true, "A keeps serve after winning own rally");

// B scores -> side-out, B serves, 1-1
fire(scoreInput, "right");
eq(H(), "A  1    1  B", "header 1-1");
eq(T().indexOf("Serving:  Team B") >= 0, true, "side-out: B serves after winning rally");

// drive to 24-23 for A then 25-23
function setScore(a, b) {
    // brute: read current then add points. We track externally.
}
// bring A to 24, B to 23 (currently 1-1). Add 23 more to A, 22 more to B.
for (let i = 0; i < 23; i++) fire(scoreInput, "left");  // A: 24
for (let i = 0; i < 22; i++) fire(scoreInput, "right"); // B: 23
eq(H(), "A  24    23  B", "header 24-23");
ok(T().indexOf("first to 25") >= 0, "set 1 target is 25");
// A scores -> 25-23, set over (win by 2)
fire(scoreInput, "left");
eq(H().indexOf("Team A wins") >= 0, true, "set over, A wins set 1");
eq(T().indexOf("Sets    A 1   B 0") >= 0, true, "sets 1-0 after set 1");
eq(score.props.center, "Next", "OK = Next set in setover");

console.log("=== Scenario 2: win-by-2 deuce (no cap) ===");
// next set: press Next
fire(scoreInput, "center"); // next set
eq(score.props.center, "Undo", "back to play mode");
// alternate first serve: set 2 -> Team B serves first
eq(T().indexOf("Serving:  Team B") >= 0, true, "set 2 opens with Team B serving (alternation)");
// 24-24 then 26-24 (deuce)
for (let i = 0; i < 24; i++) fire(scoreInput, "left");  // A 24
for (let i = 0; i < 24; i++) fire(scoreInput, "right"); // B 24
eq(H(), "A  24    24  B", "deuce 24-24");
fire(scoreInput, "left"); // 25-24, not over (lead 1)
eq(H(), "A  25    24  B", "25-24 not over");
ok(score.props.center === "Undo", "still in play at 25-24");
fire(scoreInput, "left"); // 26-24, over
eq(H().indexOf("Team A wins") >= 0, true, "26-24 wins by 2");

console.log("=== Scenario 3: Undo across a set boundary ===");
// currently setover for set 2 (A won 26-24), sets A2 B0
eq(T().indexOf("Sets    A 2   B 0") >= 0, true, "sets 2-0");
// Undo the set-winning point (left = Undo in setover)
fire(scoreInput, "left");
eq(score.props.center, "Undo", "undo returned to play mode");
eq(H(), "A  25    24  B", "undo restored 25-24");
eq(T().indexOf("Sets   A 1   B 0") >= 0, true, "undo un-recorded set 2");

console.log("=== Scenario 4: full match to 3 sets + decider is to 15 ===");
// Reset via a fresh match through navigation/menu would be cleaner; instead
// just finish: re-win set 2 for A.
fire(scoreInput, "left"); // 26-24 set over again
fire(scoreInput, "center"); // next set (set 3), A2 B0
// Let B win set 3 (25-0) and set 4 (25-0) to reach 2-2
for (let i = 0; i < 25; i++) fire(scoreInput, "right");
eq(T().indexOf("Sets    A 2   B 1") >= 0, true, "B took set 3 -> 2-1");
fire(scoreInput, "center"); // set 4
for (let i = 0; i < 25; i++) fire(scoreInput, "right");
eq(T().indexOf("Sets    A 2   B 2") >= 0, true, "B took set 4 -> 2-2");
fire(scoreInput, "center"); // set 5 (decider)
ok(T().indexOf("first to 15") >= 0, "decider set 5 target is 15");
// A wins decider 15-0
for (let i = 0; i < 15; i++) fire(scoreInput, "left");
eq(H().indexOf("TEAM A WINS") >= 0, true, "match over, A champion");
eq(score.props.center, "New", "OK = New match at match over");
ok(T().indexOf("A 3 - 2 B") >= 0, "final match score 3-2");

console.log("=== Scenario 5: navigation + menu ===");
// New match from match-over (center)
fire(scoreInput, "center");
ok(currentView === serveView, "New match returns to serve select");
fire(serveChosen, 1); // Team B serves first this time
const score2 = currentView;
eq(score2.props.text.indexOf("Serving:  Team B") >= 0, true, "B serves first");
// score a couple, open menu via navigation (Back)
fire(score2.input, "left"); // A 1
fire(navigation); // Back -> menu
const menuView = currentView;
ok(menuView !== score2, "Back opened the menu");
const menuChosen = menuView.chosen;
fire(menuChosen, 0); // Resume
ok(currentView === score2, "Resume returns to score");
// Swap serve
fire(navigation); fire(menuChosen, 1);
eq(currentView.props.text.indexOf("Serving:") >= 0, true, "swap serve renders");
// Exit app
fire(navigation); fire(menuChosen, 4);
eq(stopped, true, "Exit app stops the event loop");

console.log("");
console.log("RESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
