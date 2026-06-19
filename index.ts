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
import * as notify from "@flipperdevices/fz-sdk/notification";

// ---- Views (created once; the view dispatcher remembers them) --------------
var views = {
    // Pick who serves first at the start of a match.
    serve: submenu.makeWith({
        header: "Who serves first?",
        items: ["Team A serves", "Team B serves"],
    }),
    // The live scoreboard. Re-used for the PLAY, SET OVER and MATCH OVER modes
    // by rewriting its props.
    score: dialog.makeWith({
        header: "",
        text: "",
        left: "+A",
        center: "Undo",
        right: "+B",
    }),
    // In-game menu (opened with Back).
    menu: submenu.makeWith({
        header: "Menu",
        items: ["Resume", "Swap serve", "Set history", "New match", "Exit app"],
    }),
    // Scrollable set history.
    history: textBox.makeWith({ text: "", font: "text", focus: "start" }),
};

// ---- Shared application state + behaviour (threaded everywhere as `self`) ---
var S = {
    // module handles, reached via self.* inside callbacks (no closures allowed)
    gui: gui,
    loop: eventLoop,
    views: views,

    // which view is currently on screen: "serve" | "score" | "menu" | "history"
    screen: "serve",
    // scoreboard mode: "play" | "setover" | "matchover"
    mode: "play",

    a: 0,            // Team A points in the current set
    b: 0,            // Team B points in the current set
    setsA: 0,        // sets won by Team A
    setsB: 0,        // sets won by Team B
    server: "A",     // who is serving right now: "A" | "B"
    startServer: "A",// who served first in set 1 (sets alternate from here)
    sets: [],        // completed sets: array of { a, b, w } (w = winner "A"/"B")
    undoStack: [],   // snapshots for Undo

    // --- rules helpers ------------------------------------------------------

    setNum: function (self) {
        return self.setsA + self.setsB + 1;
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

    // Award a rally to team "A" or "B".
    score: function (self, team) {
        if (self.mode !== "play") return;
        self.snapshot(self);

        if (team === "A") self.a += 1; else self.b += 1;
        // Rally scoring: the rally winner serves the next rally.
        self.server = team;

        var t = self.target(self);
        var hi = self.a > self.b ? self.a : self.b;
        var lead = self.a - self.b;
        if (lead < 0) lead = -lead;

        if (hi >= t && lead >= 2) {
            // set is decided
            var w = self.a > self.b ? "A" : "B";
            self.sets.push({ a: self.a, b: self.b, w: w });
            if (w === "A") self.setsA += 1; else self.setsB += 1;

            if (self.setsA === 3 || self.setsB === 3) {
                self.mode = "matchover";
            } else {
                self.mode = "setover";
            }
            notify.success();
        } else {
            notify.blink("green", "short");
        }
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

    // --- rendering ----------------------------------------------------------

    render: function (self) {
        var v = self.views.score;
        if (self.mode === "play") {
            var srv = self.server === "A" ? "Team A" : "Team B";
            v.set("header", "A  " + self.a + "    " + self.b + "  B");
            v.set("text",
                "Set " + self.setNum(self) + "  -  first to " + self.target(self) + "\n" +
                "Sets   A " + self.setsA + "   B " + self.setsB + "\n" +
                "Serving:  " + srv);
            v.set("left", "+A");
            v.set("center", "Undo");
            v.set("right", "+B");
        } else if (self.mode === "setover") {
            var last = self.sets[self.sets.length - 1];
            v.set("header", "Set " + self.sets.length + ": Team " + last.w + " wins");
            v.set("text",
                "Score   " + last.a + " - " + last.b + "\n" +
                "Sets    A " + self.setsA + "   B " + self.setsB + "\n" +
                "OK = next set");
            v.set("left", "Undo");
            v.set("center", "Next");
            v.set("right", "");
        } else { // matchover
            var champ = self.setsA === 3 ? "A" : "B";
            v.set("header", "TEAM " + champ + " WINS!");
            v.set("text",
                "Match   A " + self.setsA + " - " + self.setsB + " B\n" +
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
            s += self.sets[i].a + "-" + self.sets[i].b;
            i += 1;
        }
        return s;
    },

    historyText: function (self) {
        var s = "Set history\n";
        var i = 0;
        while (i < self.sets.length) {
            var row = self.sets[i];
            s += "Set " + (i + 1) + ":  " + row.a + " - " + row.b +
                "   (Team " + row.w + ")\n";
            i += 1;
        }
        if (self.mode === "play") {
            s += "Set " + self.setNum(self) + ":  " + self.a + " - " + self.b +
                "   (in play)\n";
        }
        return s;
    },
};

// ---- Wiring: subscribe callbacks (only touch their params + true globals) --

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
        if (button === "left") S.score(S, "A");
        else if (button === "right") S.score(S, "B");
        else if (button === "center") S.undo(S);
    } else if (S.mode === "setover") {
        if (button === "left") S.undo(S);
        else if (button === "center") S.nextSet(S);
    } else { // matchover
        if (button === "left") S.undo(S);
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
    } else if (index === 1) {       // Swap serve (manual correction)
        S.server = S.server === "A" ? "B" : "A";
        S.render(S);
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    } else if (index === 2) {       // Set history
        S.views.history.set("text", S.historyText(S));
        S.screen = "history";
        S.gui.viewDispatcher.switchTo(S.views.history);
    } else if (index === 3) {       // New match
        S.screen = "serve";
        S.gui.viewDispatcher.switchTo(S.views.serve);
    } else if (index === 4) {       // Exit app
        S.loop.stop();
    }
}, S);

// Back button -> context-dependent navigation.
eventLoop.subscribe(gui.viewDispatcher.navigation, function (_sub, _item, S) {
    if (S.screen === "score") {
        S.screen = "menu";
        S.gui.viewDispatcher.switchTo(S.views.menu);
    } else if (S.screen === "menu") {
        S.screen = "score";
        S.gui.viewDispatcher.switchTo(S.views.score);
    } else if (S.screen === "history") {
        S.screen = "menu";
        S.gui.viewDispatcher.switchTo(S.views.menu);
    } else { // serve-select: Back exits the app
        S.loop.stop();
    }
}, S);

// ---- Boot ------------------------------------------------------------------
gui.viewDispatcher.switchTo(views.serve);
eventLoop.run();
