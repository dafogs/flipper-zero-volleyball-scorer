// Volleyball Scoreboard for Flipper Zero
// ---------------------------------------
// Standard indoor volleyball, rally scoring, best of 5 sets.
//   - Sets 1-4: first to 25, win by 2
//   - Set 5 (only if 2-2): first to 15, win by 2
//   - Match: first team to win 3 sets
//   - Serve auto-tracks: in rally scoring the team that wins the rally serves
//     next, so the serving team flips on every side-out automatically.
//
// One-handed d-pad mapping (see README for why Up/Down are NOT used: the
// Flipper JS SDK only routes the Left / OK / Right / Back buttons to a view,
// raw Up/Down input requires a native C app, not JS):
//   PLAY screen:   Left = +1 Team A | OK = Undo | Right = +1 Team B | Back = Menu
//   SET OVER:      Left = Undo      | OK = Next set
//   MATCH OVER:    Left = Undo      | OK = New match
//   MENU:          OK = pick item   | Back = resume
//
// mJS engine notes that shape this code:
//   - No closures: callbacks cannot read module-level variables, so the whole
//     app state lives on one object `S` that is threaded through every
//     `subscribe()` call and passed to every method as `self`.
//   - No template literals, no Math/JSON, arrays only have push/splice/length.

// caution: `eventLoop` HAS to be imported before `gui`, and `gui` HAS to be
// imported before any `gui` submodules.
import * as eventLoop from "@flipperdevices/fz-sdk/event_loop";
import * as gui from "@flipperdevices/fz-sdk/gui";
import * as dialog from "@flipperdevices/fz-sdk/gui/dialog";
import * as submenu from "@flipperdevices/fz-sdk/gui/submenu";
import * as textBox from "@flipperdevices/fz-sdk/gui/text_box";
import * as textInput from "@flipperdevices/fz-sdk/gui/text_input";
import * as widget from "@flipperdevices/fz-sdk/gui/widget";
import * as notify from "@flipperdevices/fz-sdk/notification";

// mJS forbids implicit number->string coercion in `+` (e.g. "A " + 5 throws
// "implicit type conversion is prohibited" on-device). The Node test harness
// coerces silently, so this only bites on hardware. Convert every number that
// goes into a display string explicitly via this helper. Number.toString is a
// firmware-backed SDK 0.1 feature (declared in global.d.ts).
function numStr(n: number): string {
    return n.toString();
}

// ---- Views (created once; the view dispatcher remembers them) --------------
var views = {
    // Pick who serves first at the start of a match.
    // NOTE: this firmware's submenu takes list entries as makeWith's SECOND
    // argument (children), not an `items` prop. The bundled SDK 0.1.3 types are
    // out of sync (they declare `items`), so we cast to call the real 2-arg form.
    serve: (submenu as any).makeWith(
        { header: "Who serves first?" },
        ["Team A serves", "Team B serves"],
    ),
    // The live scoreboard. Re-used for the PLAY, SET OVER and MATCH OVER modes
    // by rewriting its props.
    score: dialog.makeWith({
        header: "",
        text: "",
        left: "+A",
        center: "Undo",
        right: "+B",
    }),
    // In-game menu (opened with Back). Entries are children (2nd arg), see note above.
    menu: (submenu as any).makeWith(
        { header: "Menu" },
        ["Resume", "Adjust scores", "Swap serve", "Set history", "Rename teams", "Settings", "New match", "Exit app"],
    ),
    // Scrollable set history.
    history: textBox.makeWith({ text: "", font: "text", focus: "start" }),
    // Keyboard for entering team names (reused for both teams).
    nameInput: textInput.makeWith({
        header: "Team A name",
        minLength: 0,
        maxLength: 7,
        defaultText: "A",
        defaultTextClear: true,
    }),
    // Settings toggles. Children are refreshed on entry to reflect current state.
    settings: (submenu as any).makeWith(
        { header: "Settings" },
        ["Alert: ON (sound+vibe)", "Back"],
    ),
    // Title splash (widget view). The widget only draws black-on-white (no
    // invert/white text), so this is a composed "card": a rounded frame, a
    // centered title, a rule with end-caps, and a subtitle. The Start button is
    // rendered by the firmware along the bottom. Elements are children; the
    // widget has no props of its own.
    splash: (widget as any).makeWith({}, [
        { element: "rect", x: 3, y: 2, w: 122, h: 46, radius: 6, fill: false },   // rounded frame
        { element: "rect", x: 5, y: 4, w: 118, h: 42, radius: 5, fill: false },   // inner double border
        { element: "string", x: 64, y: 10, align: "tm", font: "primary", text: "VOLLEYBALL" },
        { element: "line", x1: 26, y1: 27, x2: 102, y2: 27 },                     // rule under title
        { element: "circle", x: 22, y: 27, radius: 2, fill: true },               // left end-cap
        { element: "circle", x: 106, y: 27, radius: 2, fill: true },              // right end-cap
        { element: "string", x: 64, y: 32, align: "tm", font: "secondary", text: "Score Keeper" },
        { element: "button", button: "center", text: "Start" },
    ]),
};

// ---- Shared application state + behaviour (threaded everywhere as `self`) ---
var S = {
    // module handles, reached via self.* inside callbacks (no closures allowed)
    gui: gui,
    loop: eventLoop,
    views: views,

    // which view is currently on screen:
    //   "splash" | "serve" | "score" | "menu" | "history" | "settings" | "nameInput"
    screen: "splash",
    // scoreboard mode: "play" | "setover" | "matchover"
    mode: "play",

    a: 0,            // Team A points in the current set
    b: 0,            // Team B points in the current set
    setsA: 0,        // sets won by Team A
    setsB: 0,        // sets won by Team B
    server: "A",     // who is serving right now: "A" | "B"
    startServer: "A",// who served first in set 1 (sets alternate from here)
    sel: "A",        // team selected in Adjust mode: "A" | "B"
    sets: [],        // completed sets: array of { a, b, w } (w = winner "A"/"B")
    undoStack: [],   // snapshots for Undo

    nameA: "A",      // display name for team A (RAM only; resets on app exit)
    nameB: "B",      // display name for team B
    naming: "A",     // which team the keyboard is currently entering: "A" | "B"
    alertOn: true,   // sound+vibration when a set/match ends (Settings toggle)

    // --- rules helpers ------------------------------------------------------

    setNum: function (self) {
        return self.setsA + self.setsB + 1;
    },

    // Display name for a team key ("A" | "B").
    teamName: function (self, t) {
        return t === "A" ? self.nameA : self.nameB;
    },

    // End-of-set / end-of-match feedback, gated by the alert setting. When off,
    // a silent green LED flash replaces the sound+vibration cue.
    endAlert: function (self) {
        if (self.alertOn) { notify.success(); }
        else { notify.blink("green", "long"); }
    },

    // Rebuild the Settings list to reflect the current toggle state.
    refreshSettings: function (self) {
        var label = self.alertOn ? "Alert: ON (sound+vibe)" : "Alert: OFF (silent)";
        (self.views.settings as any).setChildren([label, "Back"]);
    },

    // First-to target for the current set: 15 for a 2-2 decider, else 25.
    target: function (self) {
        if (self.setsA === 2 && self.setsB === 2) return 15;
        return 25;
    },

    // Which team serves first in a given (1-based) set number. Teams alternate
    // the opening serve each set, starting from the match's chosen first server.
    firstServerForSet: function (self, n) {
        var other = self.startServer === "A" ? "B" : "A";
        // odd sets -> startServer, even sets -> the other team
        return (n % 2 === 1) ? self.startServer : other;
    },

    // --- match lifecycle ----------------------------------------------------

    newMatch: function (self) {
        self.a = 0;
        self.b = 0;
        self.setsA = 0;
        self.setsB = 0;
        self.sets = [];
        self.undoStack = [];
        self.server = self.firstServerForSet(self, 1);
        self.mode = "play";
    },

    // Push a snapshot so the last action can be undone.
    snapshot: function (self) {
        self.undoStack.push({
            a: self.a, b: self.b,
            setsA: self.setsA, setsB: self.setsB,
            server: self.server, mode: self.mode,
            setsLen: self.sets.length,
        });
        // bound memory (no Array.shift in this engine -> splice the oldest)
        if (self.undoStack.length > 80) self.undoStack.splice(0, 1);
    },

    // Looks at the current points and, if the set is decided (target reached
    // with a 2-point lead), records the set and advances mode to setover or
    // matchover. Otherwise sets mode back to play. Returns true if the set
    // ended. Shared by normal scoring and manual correction.
    evaluate: function (self) {
        var t = self.target(self);
        var hi = self.a > self.b ? self.a : self.b;
        var lead = self.a - self.b;
        if (lead < 0) lead = -lead;

        if (hi >= t && lead >= 2) {
            var w = self.a > self.b ? "A" : "B";
            self.sets.push({ a: self.a, b: self.b, w: w });
            if (w === "A") { self.setsA += 1; } else { self.setsB += 1; }
            if (self.setsA === 3 || self.setsB === 3) { self.mode = "matchover"; }
            else { self.mode = "setover"; }
            return true;
        }
        self.mode = "play";
        return false;
    },

    // Award a rally to team "A" or "B".
    score: function (self, team) {
        if (self.mode !== "play") return;
        self.snapshot(self);

        if (team === "A") { self.a += 1; } else { self.b += 1; }
        // Rally scoring: the rally winner serves the next rally.
        self.server = team;

        if (self.evaluate(self)) { self.endAlert(self); }
        else { notify.blink("green", "short"); }
        self.render(self);
    },

    undo: function (self) {
        if (self.undoStack.length === 0) {
            notify.error();
            return;
        }
        var snap = self.undoStack.splice(self.undoStack.length - 1, 1)[0];
        self.a = snap.a;
        self.b = snap.b;
        self.setsA = snap.setsA;
        self.setsB = snap.setsB;
        self.server = snap.server;
        self.mode = snap.mode;
        // remove any set rows recorded after this snapshot
        while (self.sets.length > snap.setsLen) {
            self.sets.splice(self.sets.length - 1, 1);
        }
        notify.blink("blue", "short");
        self.render(self);
    },

    // Advance from SET OVER to the next set.
    nextSet: function (self) {
        if (self.mode !== "setover") return;
        self.a = 0;
        self.b = 0;
        self.server = self.firstServerForSet(self, self.setNum(self));
        self.mode = "play";
        self.undoStack = []; // a fresh set starts a fresh undo history
        self.render(self);
    },

    // --- manual score correction -------------------------------------------
    // Free +/- adjustment of either team's points, for fixing courtside
    // mistakes (wrong button, a call reversal, a missed point). One screen:
    //   Left = -1, Right = +1 on the SELECTED team, OK = switch team,
    //   Back = done (re-checks whether the corrected score ends the set).

    enterAdjust: function (self) {
        // If a set/match just "ended", reopen it so the live score is editable.
        var guard = 0;
        while ((self.mode === "setover" || self.mode === "matchover") &&
               self.undoStack.length > 0 && guard < 10) {
            self.undo(self);
            guard += 1;
        }
        // One snapshot for the whole correction session -> a single Undo
        // afterwards reverts every adjustment at once.
        self.snapshot(self);
        self.mode = "adjust";
        self.sel = "A";
        self.render(self);
    },

    adjustDelta: function (self, d) {
        if (self.mode !== "adjust") return;
        if (self.sel === "A") {
            self.a += d;
            if (self.a < 0) self.a = 0;
        } else {
            self.b += d;
            if (self.b < 0) self.b = 0;
        }
        notify.blink(d > 0 ? "green" : "blue", "short");
        self.render(self);
    },

    switchSel: function (self) {
        if (self.mode !== "adjust") return;
        self.sel = self.sel === "A" ? "B" : "A";
        self.render(self);
    },

    exitAdjust: function (self) {
        if (self.mode !== "adjust") return;
        // Settle: a correction may have completed (or un-completed) a set.
        if (self.evaluate(self)) { self.endAlert(self); }
        self.render(self);
    },

    // --- rendering ----------------------------------------------------------

    render: function (self) {
        var v = self.views.score;
        if (self.mode === "play") {
            var srv = self.teamName(self, self.server);
            v.set("header", self.nameA + "  " + numStr(self.a) + "    " + numStr(self.b) + "  " + self.nameB);
            v.set("text",
                "Set " + numStr(self.setNum(self)) + "  -  first to " + numStr(self.target(self)) + "\n" +
                "Sets   A " + numStr(self.setsA) + "   B " + numStr(self.setsB) + "\n" +
                "Serving:  " + srv);
            v.set("left", "+A");
            v.set("center", "Undo");
            v.set("right", "+B");
        } else if (self.mode === "setover") {
            var last = self.sets[self.sets.length - 1];
            v.set("header", "Set " + numStr(self.sets.length) + ": " + self.teamName(self, last.w) + " wins");
            v.set("text",
                "Score   " + numStr(last.a) + " - " + numStr(last.b) + "\n" +
                "Sets    A " + numStr(self.setsA) + "   B " + numStr(self.setsB) + "\n" +
                "OK = next set");
            v.set("left", "Undo");
            v.set("center", "Next");
            v.set("right", "");
        } else if (self.mode === "adjust") {
            // bracket the selected team so it's obvious what +/- affects
            var hdr = self.sel === "A"
                ? "[A " + numStr(self.a) + "]   " + numStr(self.b) + " B"
                : "A " + numStr(self.a) + "   [" + numStr(self.b) + " B]";
            v.set("header", hdr);
            v.set("text",
                "ADJUST  -  fixing Team " + self.sel + "\n" +
                "Left -1     Right +1\n" +
                "OK = switch · Back = done");
            v.set("left", "-1");
            v.set("center", self.sel === "A" ? "To B" : "To A");
            v.set("right", "+1");
        } else { // matchover
            var champ = self.setsA === 3 ? "A" : "B";
            v.set("header", self.teamName(self, champ) + " WINS!");
            v.set("text",
                "Match   A " + numStr(self.setsA) + " - " + numStr(self.setsB) + " B\n" +
                self.setLine(self) + "\n" +
                "OK = new match");
            v.set("left", "Undo");
            v.set("center", "New");
            v.set("right", "");
        }
    },

    // One-line summary of all completed set scores, e.g. "25-20 23-25 15-13".
    setLine: function (self) {
        var s = "";
        var i = 0;
        while (i < self.sets.length) {
            if (i > 0) s += " ";
            s += numStr(self.sets[i].a) + "-" + numStr(self.sets[i].b);
            i += 1;
        }
        return s;
    },

    historyText: function (self) {
        var s = "Set history\n";
        var i = 0;
        while (i < self.sets.length) {
            var row = self.sets[i];
            s += "Set " + numStr(i + 1) + ":  " + numStr(row.a) + " - " + numStr(row.b) +
                "   (" + self.teamName(self, row.w) + ")\n";
            i += 1;
        }
        if (self.mode === "play") {
            s += "Set " + numStr(self.setNum(self)) + ":  " + numStr(self.a) + " - " + numStr(self.b) +
                "   (in play)\n";
        }
        return s;
    },
};

// ---- Wiring: subscribe callbacks (only touch their params + true globals) --

// Splash -> serve select. Any button on the splash (the "Start" center button)
// advances; gated on screen so a follow-up press/release event is ignored.
eventLoop.subscribe(views.splash.button, function (_sub, _evt, S) {
    if (S.screen !== "splash") return;
    S.screen = "serve";
    S.gui.viewDispatcher.switchTo(S.views.serve);
}, S);

// Serve-select menu -> start the match.
eventLoop.subscribe(views.serve.chosen, function (_sub, index, S) {
    S.startServer = index === 0 ? "A" : "B";
    S.newMatch(S);
    S.render(S);
    S.screen = "score";
    S.gui.viewDispatcher.switchTo(S.views.score);
}, S);

// Scoreboard buttons -> action depends on the current mode.
eventLoop.subscribe(views.score.input, function (_sub, button, S) {
    if (S.mode === "play") {
        if (button === "left") { S.score(S, "A"); }
        else if (button === "right") { S.score(S, "B"); }
        else if (button === "center") { S.undo(S); }
    } else if (S.mode === "adjust") {
        if (button === "left") { S.adjustDelta(S, -1); }
        else if (button === "right") { S.adjustDelta(S, 1); }
        else if (button === "center") { S.switchSel(S); }
    } else if (S.mode === "setover") {
        if (button === "left") { S.undo(S); }
        else if (button === "center") { S.nextSet(S); }
    } else { // matchover
        if (button === "left") { S.undo(S); }
        else if (button === "center") {
            S.newMatch(S);
            S.render(S);
            S.screen = "serve";
            S.gui.viewDispatcher.switchTo(S.views.serve);
        }
    }
}, S);

// In-game menu selections.
eventLoop.subscribe(views.menu.chosen, function (_sub, index, S) {
    if (index === 0) {              // Resume
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    } else if (index === 1) {       // Adjust scores (free +/- correction)
        S.enterAdjust(S);
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    } else if (index === 2) {       // Swap serve (manual correction)
        S.server = S.server === "A" ? "B" : "A";
        S.render(S);
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    } else if (index === 3) {       // Set history
        S.views.history.set("text", S.historyText(S));
        S.screen = "history";
        S.gui.viewDispatcher.switchTo(S.views.history);
    } else if (index === 4) {       // Rename teams -> keyboard (Team A first)
        S.naming = "A";
        S.views.nameInput.set("header", "Team A name");
        S.views.nameInput.set("defaultText", S.nameA);
        S.screen = "nameInput";
        S.gui.viewDispatcher.switchTo(S.views.nameInput);
    } else if (index === 5) {       // Settings
        S.refreshSettings(S);
        S.screen = "settings";
        S.gui.viewDispatcher.switchTo(S.views.settings);
    } else if (index === 6) {       // New match
        S.screen = "serve";
        S.gui.viewDispatcher.switchTo(S.views.serve);
    } else if (index === 7) {       // Exit app
        S.loop.stop();
    }
}, S);

// Team-name keyboard: enter Team A, then Team B, then back to the scoreboard.
eventLoop.subscribe(views.nameInput.input, function (_sub, text, S) {
    // The SDK's subscribe() leaves the item type unbound here, so coerce once.
    var t: string = text as any;
    if (S.naming === "A") {
        S.nameA = t === "" ? "A" : t;
        S.naming = "B";
        S.views.nameInput.set("header", "Team B name");
        S.views.nameInput.set("defaultText", S.nameB);
        S.gui.viewDispatcher.switchTo(S.views.nameInput);
    } else {
        S.nameB = t === "" ? "B" : t;
        S.render(S);
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    }
}, S);

// Settings selections: index 0 toggles the alert, index 1 goes back.
eventLoop.subscribe(views.settings.chosen, function (_sub, index, S) {
    if (index === 0) {
        S.alertOn = !S.alertOn;
        S.refreshSettings(S);       // stay on the screen, show the new state
    } else {
        S.screen = "menu";
        S.gui.viewDispatcher.switchTo(S.views.menu);
    }
}, S);

// Back button -> context-dependent navigation.
eventLoop.subscribe(gui.viewDispatcher.navigation, function (_sub, _item, S) {
    if (S.screen === "score") {
        if (S.mode === "adjust") {
            S.exitAdjust(S);        // Back finishes a correction, stays on score
        } else {
            S.screen = "menu";
            S.gui.viewDispatcher.switchTo(S.views.menu);
        }
    } else if (S.screen === "menu") {
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    } else if (S.screen === "history") {
        S.screen = "menu";
        S.gui.viewDispatcher.switchTo(S.views.menu);
    } else if (S.screen === "settings") {
        S.screen = "menu";
        S.gui.viewDispatcher.switchTo(S.views.menu);
    } else if (S.screen === "nameInput") {
        // Cancel naming and return to the menu.
        S.screen = "menu";
        S.gui.viewDispatcher.switchTo(S.views.menu);
    } else { // splash or serve-select: Back exits the app
        S.loop.stop();
    }
}, S);

// ---- Boot ------------------------------------------------------------------
gui.viewDispatcher.switchTo(views.splash);
eventLoop.run();
