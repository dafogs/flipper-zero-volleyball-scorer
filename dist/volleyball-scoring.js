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
var notify = require("@flipperdevices/fz-sdk/notification");
var views = {
  // Pick who serves first at the start of a match.
  serve: submenu.makeWith({
    header: "Who serves first?",
    items: ["Team A serves", "Team B serves"]
  }),
  // The live scoreboard. Re-used for the PLAY, SET OVER and MATCH OVER modes
  // by rewriting its props.
  score: dialog.makeWith({
    header: "",
    text: "",
    left: "+A",
    center: "Undo",
    right: "+B"
  }),
  // In-game menu (opened with Back).
  menu: submenu.makeWith({
    header: "Menu",
    items: ["Resume", "Swap serve", "Set history", "New match", "Exit app"]
  }),
  // Scrollable set history.
  history: textBox.makeWith({ text: "", font: "text", focus: "start" })
};
var S = {
  // module handles, reached via self.* inside callbacks (no closures allowed)
  gui: gui,
  loop: eventLoop,
  views: views,
  // which view is currently on screen: "serve" | "score" | "menu" | "history"
  screen: "serve",
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
  sets: [],
  // completed sets: array of { a, b, w } (w = winner "A"/"B")
  undoStack: [],
  // snapshots for Undo
  // --- rules helpers ------------------------------------------------------
  setNum: function(self) {
    return self.setsA + self.setsB + 1;
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
  // Award a rally to team "A" or "B".
  score: function(self, team) {
    if (self.mode !== "play")
      return;
    self.snapshot(self);
    if (team === "A")
      self.a += 1;
    else
      self.b += 1;
    self.server = team;
    var t = self.target(self);
    var hi = self.a > self.b ? self.a : self.b;
    var lead = self.a - self.b;
    if (lead < 0)
      lead = -lead;
    if (hi >= t && lead >= 2) {
      var w = self.a > self.b ? "A" : "B";
      self.sets.push({ a: self.a, b: self.b, w: w });
      if (w === "A")
        self.setsA += 1;
      else
        self.setsB += 1;
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
  // --- rendering ----------------------------------------------------------
  render: function(self) {
    var v = self.views.score;
    if (self.mode === "play") {
      var srv = self.server === "A" ? "Team A" : "Team B";
      v.set("header", "A  " + self.a + "    " + self.b + "  B");
      v.set("text", "Set " + self.setNum(self) + "  -  first to " + self.target(self) + "\nSets   A " + self.setsA + "   B " + self.setsB + "\nServing:  " + srv);
      v.set("left", "+A");
      v.set("center", "Undo");
      v.set("right", "+B");
    } else if (self.mode === "setover") {
      var last = self.sets[self.sets.length - 1];
      v.set("header", "Set " + self.sets.length + ": Team " + last.w + " wins");
      v.set("text", "Score   " + last.a + " - " + last.b + "\nSets    A " + self.setsA + "   B " + self.setsB + "\nOK = next set");
      v.set("left", "Undo");
      v.set("center", "Next");
      v.set("right", "");
    } else {
      var champ = self.setsA === 3 ? "A" : "B";
      v.set("header", "TEAM " + champ + " WINS!");
      v.set("text", "Match   A " + self.setsA + " - " + self.setsB + " B\n" + self.setLine(self) + "\nOK = new match");
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
      s += self.sets[i].a + "-" + self.sets[i].b;
      i += 1;
    }
    return s;
  },
  historyText: function(self) {
    var s = "Set history\n";
    var i = 0;
    while (i < self.sets.length) {
      var row = self.sets[i];
      s += "Set " + (i + 1) + ":  " + row.a + " - " + row.b + "   (Team " + row.w + ")\n";
      i += 1;
    }
    if (self.mode === "play") {
      s += "Set " + self.setNum(self) + ":  " + self.a + " - " + self.b + "   (in play)\n";
    }
    return s;
  }
};
eventLoop.subscribe(views.serve.chosen, function(_sub, index, S2) {
  S2.startServer = index === 0 ? "A" : "B";
  S2.newMatch(S2);
  S2.render(S2);
  S2.screen = "score";
  S2.gui.viewDispatcher.switchTo(S2.views.score);
}, S);
eventLoop.subscribe(views.score.input, function(_sub, button, S2) {
  if (S2.mode === "play") {
    if (button === "left")
      S2.score(S2, "A");
    else if (button === "right")
      S2.score(S2, "B");
    else if (button === "center")
      S2.undo(S2);
  } else if (S2.mode === "setover") {
    if (button === "left")
      S2.undo(S2);
    else if (button === "center")
      S2.nextSet(S2);
  } else {
    if (button === "left")
      S2.undo(S2);
    else if (button === "center") {
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
    S2.server = S2.server === "A" ? "B" : "A";
    S2.render(S2);
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  } else if (index === 2) {
    S2.views.history.set("text", S2.historyText(S2));
    S2.screen = "history";
    S2.gui.viewDispatcher.switchTo(S2.views.history);
  } else if (index === 3) {
    S2.screen = "serve";
    S2.gui.viewDispatcher.switchTo(S2.views.serve);
  } else if (index === 4) {
    S2.loop.stop();
  }
}, S);
eventLoop.subscribe(gui.viewDispatcher.navigation, function(_sub, _item, S2) {
  if (S2.screen === "score") {
    S2.screen = "menu";
    S2.gui.viewDispatcher.switchTo(S2.views.menu);
  } else if (S2.screen === "menu") {
    S2.screen = "score";
    S2.gui.viewDispatcher.switchTo(S2.views.score);
  } else if (S2.screen === "history") {
    S2.screen = "menu";
    S2.gui.viewDispatcher.switchTo(S2.views.menu);
  } else {
    S2.loop.stop();
  }
}, S);
gui.viewDispatcher.switchTo(views.serve);
eventLoop.run();
