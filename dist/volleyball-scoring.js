checkSdkCompatibility(0, 1);
let exports = {};
"use strict";

// dist/index.js
Object.defineProperty(exports, "__esModule", { value: true });
var eventLoop = require("@flipperdevices/fz-sdk/event_loop");
var gui = require("@flipperdevices/fz-sdk/gui");
var dialog = require("@flipperdevices/fz-sdk/gui/dialog");
var submenu = require("@flipperdevices/fz-sdk/gui/submenu");
var textBox = require("@flipperdevices/fz-sdk/gui/text_box");
var textInput = require("@flipperdevices/fz-sdk/gui/text_input");
var widget = require("@flipperdevices/fz-sdk/gui/widget");
var notify = require("@flipperdevices/fz-sdk/notification");
function numStr(n) {
  return n.toString();
}
var views = {
  // Pick who serves first at the start of a match.
  // NOTE: this firmware's submenu takes list entries as makeWith's SECOND
  // argument (children), not an `items` prop. The bundled SDK 0.1.3 types are
  // out of sync (they declare `items`), so we cast to call the real 2-arg form.
  serve: submenu.makeWith({ header: "Who serves first?" }, ["Team A serves", "Team B serves"]),
  // The live scoreboard. Re-used for the PLAY, SET OVER and MATCH OVER modes
  // by rewriting its props.
  score: dialog.makeWith({
    header: "",
    text: "",
    left: "+A",
    center: "Undo",
    right: "+B"
  }),
  // In-game menu (opened with Back). Entries are children (2nd arg), see note above.
  menu: submenu.makeWith({ header: "Menu" }, ["Resume", "Adjust scores", "Swap serve", "Set history", "Rename teams", "Settings", "New match", "Exit app"]),
  // Scrollable set history.
  history: textBox.makeWith({ text: "", font: "text", focus: "start" }),
  // Keyboard for entering team names (reused for both teams).
  nameInput: textInput.makeWith({
    header: "Team A name",
    minLength: 0,
    maxLength: 7,
    defaultText: "A",
    defaultTextClear: true
  }),
  // Settings toggles. Children are refreshed on entry to reflect current state.
  settings: submenu.makeWith({ header: "Settings" }, ["Alert: ON (sound+vibe)", "Back"]),
  // Title splash (widget view). The widget only draws black-on-white (no
  // invert/white text), so this is a composed "card": a rounded frame, a
  // centered title, a rule with end-caps, and a subtitle. The Start button is
  // rendered by the firmware along the bottom. Elements are children; the
  // widget has no props of its own.
  splash: widget.makeWith({}, [
    { element: "rect", x: 3, y: 2, w: 122, h: 46, radius: 6, fill: false },
    // rounded frame
    { element: "rect", x: 5, y: 4, w: 118, h: 42, radius: 5, fill: false },
    // inner double border
    { element: "string", x: 64, y: 10, align: "tm", font: "primary", text: "VOLLEYBALL" },
    { element: "line", x1: 26, y1: 27, x2: 102, y2: 27 },
    // rule under title
    { element: "circle", x: 22, y: 27, radius: 2, fill: true },
    // left end-cap
    { element: "circle", x: 106, y: 27, radius: 2, fill: true },
    // right end-cap
    { element: "string", x: 64, y: 32, align: "tm", font: "secondary", text: "Score Keeper" },
    { element: "button", button: "center", text: "Start" }
  ])
};
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
  a: 0,
  // Team A points in the current set
  b: 0,
  // Team B points in the current set
  setsA: 0,
  // sets won by Team A
  setsB: 0,
  // sets won by Team B
  server: "A",
  // who is serving right now: "A" | "B"
  startServer: "A",
  // who served first in set 1 (sets alternate from here)
  sel: "A",
  // team selected in Adjust mode: "A" | "B"
  sets: [],
  // completed sets: array of { a, b, w } (w = winner "A"/"B")
  undoStack: [],
  // snapshots for Undo
  nameA: "A",
  // display name for team A (RAM only; resets on app exit)
  nameB: "B",
  // display name for team B
  naming: "A",
  // which team the keyboard is currently entering: "A" | "B"
  alertOn: true,
  // sound+vibration when a set/match ends (Settings toggle)
  // --- rules helpers ------------------------------------------------------
  setNum: function(self) {
    return self.setsA + self.setsB + 1;
  },
  // Display name for a team key ("A" | "B").
  teamName: function(self, t) {
    return t === "A" ? self.nameA : self.nameB;
  },
  // End-of-set / end-of-match feedback, gated by the alert setting. When off,
  // a silent green LED flash replaces the sound+vibration cue.
  endAlert: function(self) {
    if (self.alertOn) {
      notify.success();
    } else {
      notify.blink("green", "long");
    }
  },
  // Rebuild the Settings list to reflect the current toggle state.
  refreshSettings: function(self) {
    var label = self.alertOn ? "Alert: ON (sound+vibe)" : "Alert: OFF (silent)";
    self.views.settings.setChildren([label, "Back"]);
  },
  // First-to target for the current set: 15 for a 2-2 decider, else 25.
  target: function(self) {
    if (self.setsA === 2 && self.setsB === 2)
      return 15;
    return 25;
  },
  // Which team serves first in a given (1-based) set number. Teams alternate
  // the opening serve each set, starting from the match's chosen first server.
  firstServerForSet: function(self, n) {
    var other = self.startServer === "A" ? "B" : "A";
    return n % 2 === 1 ? self.startServer : other;
  },
  // --- match lifecycle ----------------------------------------------------
  newMatch: function(self) {
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
  snapshot: function(self) {
    self.undoStack.push({
      a: self.a,
      b: self.b,
      setsA: self.setsA,
      setsB: self.setsB,
      server: self.server,
      mode: self.mode,
      setsLen: self.sets.length
    });
    if (self.undoStack.length > 80)
      self.undoStack.splice(0, 1);
  },
  // Looks at the current points and, if the set is decided (target reached
  // with a 2-point lead), records the set and advances mode to setover or
  // matchover. Otherwise sets mode back to play. Returns true if the set
  // ended. Shared by normal scoring and manual correction.
  evaluate: function(self) {
    var t = self.target(self);
    var hi = self.a > self.b ? self.a : self.b;
    var lead = self.a - self.b;
    if (lead < 0)
      lead = -lead;
    if (hi >= t && lead >= 2) {
      var w = self.a > self.b ? "A" : "B";
      self.sets.push({ a: self.a, b: self.b, w: w });
      if (w === "A") {
        self.setsA += 1;
      } else {
        self.setsB += 1;
      }
      if (self.setsA === 3 || self.setsB === 3) {
        self.mode = "matchover";
      } else {
        self.mode = "setover";
      }
      return true;
    }
    self.mode = "play";
    return false;
  },
  // Award a rally to team "A" or "B".
  score: function(self, team) {
    if (self.mode !== "play")
      return;
    self.snapshot(self);
    if (team === "A") {
      self.a += 1;
    } else {
      self.b += 1;
    }
    self.server = team;
    if (self.evaluate(self)) {
      self.endAlert(self);
    } else {
      notify.blink("green", "short");
    }
    self.render(self);
  },
  undo: function(self) {
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
    while (self.sets.length > snap.setsLen) {
      self.sets.splice(self.sets.length - 1, 1);
    }
    notify.blink("blue", "short");
    self.render(self);
  },
  // Advance from SET OVER to the next set.
  nextSet: function(self) {
    if (self.mode !== "setover")
      return;
    self.a = 0;
    self.b = 0;
    self.server = self.firstServerForSet(self, self.setNum(self));
    self.mode = "play";
    self.undoStack = [];
    self.render(self);
  },
  // --- manual score correction -------------------------------------------
  // Free +/- adjustment of either team's points, for fixing courtside
  // mistakes (wrong button, a call reversal, a missed point). One screen:
  //   Left = -1, Right = +1 on the SELECTED team, OK = switch team,
  //   Back = done (re-checks whether the corrected score ends the set).
  enterAdjust: function(self) {
    var guard = 0;
    while ((self.mode === "setover" || self.mode === "matchover") && self.undoStack.length > 0 && guard < 10) {
      self.undo(self);
      guard += 1;
    }
    self.snapshot(self);
    self.mode = "adjust";
    self.sel = "A";
    self.render(self);
  },
  adjustDelta: function(self, d) {
    if (self.mode !== "adjust")
      return;
    if (self.sel === "A") {
      self.a += d;
      if (self.a < 0)
        self.a = 0;
    } else {
      self.b += d;
      if (self.b < 0)
        self.b = 0;
    }
    notify.blink(d > 0 ? "green" : "blue", "short");
    self.render(self);
  },
  switchSel: function(self) {
    if (self.mode !== "adjust")
      return;
    self.sel = self.sel === "A" ? "B" : "A";
    self.render(self);
  },
  exitAdjust: function(self) {
    if (self.mode !== "adjust")
      return;
    if (self.evaluate(self)) {
      self.endAlert(self);
    }
    self.render(self);
  },
  // --- rendering ----------------------------------------------------------
  render: function(self) {
    var v = self.views.score;
    if (self.mode === "play") {
      var srv = self.teamName(self, self.server);
      v.set("header", self.nameA + "  " + numStr(self.a) + "    " + numStr(self.b) + "  " + self.nameB);
      v.set("text", "Set " + numStr(self.setNum(self)) + "  -  first to " + numStr(self.target(self)) + "\nSets   A " + numStr(self.setsA) + "   B " + numStr(self.setsB) + "\nServing:  " + srv);
      v.set("left", "+A");
      v.set("center", "Undo");
      v.set("right", "+B");
    } else if (self.mode === "setover") {
      var last = self.sets[self.sets.length - 1];
      v.set("header", "Set " + numStr(self.sets.length) + ": " + self.teamName(self, last.w) + " wins");
      v.set("text", "Score   " + numStr(last.a) + " - " + numStr(last.b) + "\nSets    A " + numStr(self.setsA) + "   B " + numStr(self.setsB) + "\nOK = next set");
      v.set("left", "Undo");
      v.set("center", "Next");
      v.set("right", "");
    } else if (self.mode === "adjust") {
      var hdr = self.sel === "A" ? "[A " + numStr(self.a) + "]   " + numStr(self.b) + " B" : "A " + numStr(self.a) + "   [" + numStr(self.b) + " B]";
      v.set("header", hdr);
      v.set("text", "ADJUST  -  fixing Team " + self.sel + "\nLeft -1     Right +1\nOK = switch \xB7 Back = done");
      v.set("left", "-1");
      v.set("center", self.sel === "A" ? "To B" : "To A");
      v.set("right", "+1");
    } else {
      var champ = self.setsA === 3 ? "A" : "B";
      v.set("header", self.teamName(self, champ) + " WINS!");
      v.set("text", "Match   A " + numStr(self.setsA) + " - " + numStr(self.setsB) + " B\n" + self.setLine(self) + "\nOK = new match");
      v.set("left", "Undo");
      v.set("center", "New");
      v.set("right", "");
    }
  },
  // One-line summary of all completed set scores, e.g. "25-20 23-25 15-13".
  setLine: function(self) {
    var s = "";
    var i = 0;
    while (i < self.sets.length) {
      if (i > 0)
        s += " ";
      s += numStr(self.sets[i].a) + "-" + numStr(self.sets[i].b);
      i += 1;
    }
    return s;
  },
  historyText: function(self) {
    var s = "Set history\n";
    var i = 0;
    while (i < self.sets.length) {
      var row = self.sets[i];
      s += "Set " + numStr(i + 1) + ":  " + numStr(row.a) + " - " + numStr(row.b) + "   (" + self.teamName(self, row.w) + ")\n";
      i += 1;
    }
    if (self.mode === "play") {
      s += "Set " + numStr(self.setNum(self)) + ":  " + numStr(self.a) + " - " + numStr(self.b) + "   (in play)\n";
    }
    return s;
  }
};
eventLoop.subscribe(views.splash.button, function(_sub, _evt, S2) {
  if (S2.screen !== "splash")
    return;
  S2.screen = "serve";
  S2.gui.viewDispatcher.switchTo(S2.views.serve);
}, S);
eventLoop.subscribe(views.serve.chosen, function(_sub, index, S2) {
  S2.startServer = index === 0 ? "A" : "B";
  S2.newMatch(S2);
  S2.render(S2);
  S2.screen = "score";
  S2.gui.viewDispatcher.switchTo(S2.views.score);
}, S);
eventLoop.subscribe(views.score.input, function(_sub, button, S2) {
  if (S2.mode === "play") {
    if (button === "left") {
      S2.score(S2, "A");
    } else if (button === "right") {
      S2.score(S2, "B");
    } else if (button === "center") {
      S2.undo(S2);
    }
  } else if (S2.mode === "adjust") {
    if (button === "left") {
      S2.adjustDelta(S2, -1);
    } else if (button === "right") {
      S2.adjustDelta(S2, 1);
    } else if (button === "center") {
      S2.switchSel(S2);
    }
  } else if (S2.mode === "setover") {
    if (button === "left") {
      S2.undo(S2);
    } else if (button === "center") {
      S2.nextSet(S2);
    }
  } else {
    if (button === "left") {
      S2.undo(S2);
    } else if (button === "center") {
      S2.newMatch(S2);
      S2.render(S2);
      S2.screen = "serve";
      S2.gui.viewDispatcher.switchTo(S2.views.serve);
    }
  }
}, S);
eventLoop.subscribe(views.menu.chosen, function(_sub, index, S2) {
  if (index === 0) {
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  } else if (index === 1) {
    S2.enterAdjust(S2);
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  } else if (index === 2) {
    S2.server = S2.server === "A" ? "B" : "A";
    S2.render(S2);
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  } else if (index === 3) {
    S2.views.history.set("text", S2.historyText(S2));
    S2.screen = "history";
    S2.gui.viewDispatcher.switchTo(S2.views.history);
  } else if (index === 4) {
    S2.naming = "A";
    S2.views.nameInput.set("header", "Team A name");
    S2.views.nameInput.set("defaultText", S2.nameA);
    S2.screen = "nameInput";
    S2.gui.viewDispatcher.switchTo(S2.views.nameInput);
  } else if (index === 5) {
    S2.refreshSettings(S2);
    S2.screen = "settings";
    S2.gui.viewDispatcher.switchTo(S2.views.settings);
  } else if (index === 6) {
    S2.screen = "serve";
    S2.gui.viewDispatcher.switchTo(S2.views.serve);
  } else if (index === 7) {
    S2.loop.stop();
  }
}, S);
eventLoop.subscribe(views.nameInput.input, function(_sub, text, S2) {
  var t = text;
  if (S2.naming === "A") {
    S2.nameA = t === "" ? "A" : t;
    S2.naming = "B";
    S2.views.nameInput.set("header", "Team B name");
    S2.views.nameInput.set("defaultText", S2.nameB);
    S2.gui.viewDispatcher.switchTo(S2.views.nameInput);
  } else {
    S2.nameB = t === "" ? "B" : t;
    S2.render(S2);
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  }
}, S);
eventLoop.subscribe(views.settings.chosen, function(_sub, index, S2) {
  if (index === 0) {
    S2.alertOn = !S2.alertOn;
    S2.refreshSettings(S2);
  } else {
    S2.screen = "menu";
    S2.gui.viewDispatcher.switchTo(S2.views.menu);
  }
}, S);
eventLoop.subscribe(gui.viewDispatcher.navigation, function(_sub, _item, S2) {
  if (S2.screen === "score") {
    if (S2.mode === "adjust") {
      S2.exitAdjust(S2);
    } else {
      S2.screen = "menu";
      S2.gui.viewDispatcher.switchTo(S2.views.menu);
    }
  } else if (S2.screen === "menu") {
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  } else if (S2.screen === "history") {
    S2.screen = "menu";
    S2.gui.viewDispatcher.switchTo(S2.views.menu);
  } else if (S2.screen === "settings") {
    S2.screen = "menu";
    S2.gui.viewDispatcher.switchTo(S2.views.menu);
  } else if (S2.screen === "nameInput") {
    S2.screen = "menu";
    S2.gui.viewDispatcher.switchTo(S2.views.menu);
  } else {
    S2.loop.stop();
  }
}, S);
gui.viewDispatcher.switchTo(views.splash);
eventLoop.run();
