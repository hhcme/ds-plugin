// dsh-plugin-balance browser half — an external classic-script bundle served at
// /plugins/dsh-plugin-balance/client.js and registered with the client module loader.
// Codex-style floating task panel: ONE dark rounded card (blur backdrop) anchored at
// the top-right, growing out of a corner checklist icon that never moves between the
// expanded and collapsed states. Content sits below the top divider. Module order:
// 用量与余额 → Git → 任务 (→ 目标). Data values are right-aligned; collapsible bodies
// animate their height. The shipped todo/goal/stats dock cells are replaced (migrated).
window.__ModuleLoader__.load({
  id: "dsh-plugin-balance",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var BALANCE_PATH = "/api/dsh-plugin-balance/balance";
    var GIT_PATH = "/api/dsh-plugin-balance/git";
    var inject = ["slots", "timer"];

    // 60s TTL caches: a value fetched within the last minute is reused in ANY
    // scenario (panel re-open, session switch, …) instead of re-fetching.
    var caches = {
      balance: { at: 0, payload: null },
      git: { at: 0, sid: null, payload: null },
    };
    function fresh(at) {
      return at > 0 && (Date.now() - at) < 60000;
    }

    // Official checklist paths (IconChecklistOutline14) inlined so the bundle
    // needs no extra module-graph rows.
    function ChecklistIcon(props) {
      var size = props.size || 16;
      return React.createElement("svg", { viewBox: "0 0 14 14", width: size, height: size, fill: "currentColor", "aria-hidden": true, style: { display: "block" } },
        React.createElement("path", { d: "M13.3277 9.69629V10.976H7.28086V9.69629H13.3277Z" }),
        React.createElement("path", { d: "M13.3277 2.97256V4.25225H7.28086V2.97256H13.3277Z" }),
        React.createElement("path", { d: "M4.64512 10.336C4.64505 9.62755 4.07081 9.05322 3.3623 9.05322C2.65386 9.05329 2.07956 9.62759 2.07949 10.336C2.07949 11.0445 2.65382 11.6188 3.3623 11.6188C4.07085 11.6188 4.64512 11.0446 4.64512 10.336ZM5.92559 10.336C5.92559 11.7515 4.77777 12.8993 3.3623 12.8993C1.94689 12.8993 0.799805 11.7515 0.799805 10.336C0.799871 8.92066 1.94693 7.7736 3.3623 7.77354C4.77773 7.77354 5.92552 8.92062 5.92559 10.336Z" }),
        React.createElement("path", { d: "M4.64531 3.6123C4.6453 2.90382 4.07098 2.32949 3.3625 2.32949C2.65403 2.32951 2.0797 2.90383 2.07969 3.6123C2.07969 4.32079 2.65402 4.8951 3.3625 4.89512C4.07099 4.89512 4.64531 4.3208 4.64531 3.6123ZM5.925 3.6123C5.925 5.02772 4.77792 6.1748 3.3625 6.1748C1.9471 6.17479 0.8 5.02771 0.8 3.6123C0.800013 2.19691 1.9471 1.04982 3.3625 1.0498C4.77791 1.0498 5.92499 2.1969 5.925 3.6123Z" }),
      );
    }

    var store = {
      data: { todos: null, goal: null, usage: null, stats: null, sessionId: null },
      listeners: [],
      get: function () { return this.data; },
      set: function (next) {
        this.data = next;
        for (var i = 0; i < this.listeners.length; i++) this.listeners[i](next);
      },
      subscribe: function (fn) {
        this.listeners.push(fn);
        var self = this;
        return function () {
          var i = self.listeners.indexOf(fn);
          if (i >= 0) self.listeners.splice(i, 1);
        };
      },
    };

    function fmt(n) {
      if (!(n >= 0)) return "0";
      if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
      if (n >= 1000) return (n / 1000).toFixed(1) + "k";
      return String(n);
    }
    function currencySymbol(code) {
      if (code === "CNY") return "\u00a5";
      if (code === "USD") return "$";
      if (code === "EUR") return "\u20ac";
      return code ? code + " " : "";
    }

    var T = {
      bg: "rgba(22, 24, 28, 0.92)",
      layer2: "rgba(255, 255, 255, 0.08)",
      divider: "rgba(255, 255, 255, 0.09)",
      border: "1px solid rgba(255, 255, 255, 0.10)",
      borderStrong: "rgba(255, 255, 255, 0.35)",
      hoverBg: "rgba(255, 255, 255, 0.06)",
      brand: "#4d8dff",
      success: "#35c47d",
      warn: "#e3a63c",
      error: "#e5534b",
      label: "#e9ebef",
      secondary: "#b6bbc4",
      tertiary: "#838994",
      shadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
      font: "Inter, var(--dsw-font-family)",
    };

    function ChevronDownIcon(props) {
      return React.createElement("svg", {
        viewBox: "0 0 16 16", width: props.size || 16, height: props.size || 16,
        fill: "none", stroke: "currentColor", strokeWidth: 1.5,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
        style: { display: "block" },
      }, React.createElement("path", { d: "M4.5 6 l3.5 3.5 l3.5 -3.5" }));
    }
    function RefreshIcon(props) {
      return React.createElement("svg", {
        viewBox: "0 0 16 16", width: props.size || 16, height: props.size || 16,
        fill: "none", stroke: "currentColor", strokeWidth: 1.5,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
        style: { display: "block" },
      }, React.createElement("path", { d: "M13 7 a5.5 5.5 0 1 1 -1.2 -3.4 M13 3.2 V7 h-3.8" }));
    }
    function GitBranchIcon(props) {
      return React.createElement("svg", {
        viewBox: "0 0 16 16", width: props.size || 16, height: props.size || 16,
        fill: "none", stroke: "currentColor", strokeWidth: 1.5,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
        style: { display: "block" },
      },
        React.createElement("circle", { cx: 5.5, cy: 3.5, r: 2 }),
        React.createElement("circle", { cx: 5.5, cy: 12.5, r: 2 }),
        React.createElement("path", { d: "M5.5 5.5 v5" }),
        React.createElement("path", { d: "M13.5 6 a4 4 0 0 1 -4 4 H7" }),
      );
    }

    function TodoStatusIcon(props) {
      var base = { viewBox: "0 0 14 14", width: 14, height: 14, style: { display: "block", flexShrink: 0 } };
      if (props.status === "completed") {
        return React.createElement("svg", base,
          React.createElement("circle", { cx: 7, cy: 7, r: 6.6, fill: T.success }),
          React.createElement("path", { d: "M4.4 7.2 l1.9 1.9 l3.3 -3.5", stroke: "#101215", strokeWidth: 1.6, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }),
        );
      }
      if (props.status === "in_progress") {
        return React.createElement("svg", Object.assign({}, base, { className: "tp-spin" }),
          React.createElement("circle", { cx: 7, cy: 7, r: 6.4, stroke: T.layer2, strokeWidth: 1.4, fill: "none" }),
          React.createElement("path", { d: "M7 0.6 a6.4 6.4 0 0 1 6.4 6.4", stroke: T.brand, strokeWidth: 1.4, fill: "none", strokeLinecap: "round" }),
        );
      }
      return React.createElement("svg", base,
        React.createElement("path", { d: "M3.2 7 h7.6", stroke: T.borderStrong, strokeWidth: 1.6, strokeLinecap: "round" }),
      );
    }

    var wrapperStyle = {
      position: "fixed", top: "88px", right: "16px", width: "304px",
      pointerEvents: "none", zIndex: 1000,
    };
    var cardStyle = {
      width: "304px",
      maxHeight: "calc(100vh - 112px)", display: "flex", flexDirection: "column",
      background: T.bg, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      color: T.secondary,
      border: T.border, borderRadius: "16px", boxShadow: T.shadow,
      pointerEvents: "auto",
      fontSize: "12px", lineHeight: "18px",
      fontFamily: T.font, overflow: "hidden",
    };
    var innerScrollStyle = { overflowY: "auto", scrollbarWidth: "thin", padding: "0 12px 12px 12px", display: "flex", flexDirection: "column", flexShrink: 1 };
    var headerStyle = { display: "flex", alignItems: "center", minHeight: "36px", padding: "0 44px 0 12px" };
    var titleStyle = { fontSize: "13px", fontWeight: "700", color: T.label };
    var cornerBtnStyle = {
      position: "absolute", top: "0", right: "0", width: "36px", height: "36px",
      border: "none",
      color: T.brand, cursor: "pointer", display: "grid", placeItems: "center", padding: 0, pointerEvents: "auto",
    };
    var collapsedBtnStyle = {
      position: "fixed", top: "88px", right: "16px", width: "36px", height: "36px",
      color: T.brand, cursor: "pointer", pointerEvents: "auto",
      zIndex: 1000, display: "grid", placeItems: "center", padding: 0,
    };
    var iconBtnStyle = { background: "none", border: "none", borderRadius: "8px", color: T.tertiary, cursor: "pointer", width: "26px", height: "26px", display: "grid", placeItems: "center", padding: "0" };
    var dividerStyle = { height: "1px", background: T.divider, flexShrink: 0, margin: "12px 0" };
    var moduleHeadBtnStyle = { display: "flex", alignItems: "center", gap: "6px", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" };
    var moduleTitleLeftStyle = { flex: "1", fontSize: "13px", fontWeight: "700", color: T.label, textAlign: "left" };
    var moduleChevronStyle = { color: T.tertiary, display: "grid", placeItems: "center", transform: "rotate(180deg)", transition: "transform 0.35s ease" };
    var moduleChevronClosedStyle = { color: T.tertiary, display: "grid", placeItems: "center", transform: "none", transition: "transform 0.35s ease" };
    var moduleBodyStyle = { marginTop: "6px" };
    var rowLabelStyle = { color: T.tertiary, fontWeight: "600", flexShrink: 0 };
    var rowValueStyle = { flex: "1", textAlign: "right", color: T.secondary, fontVariantNumeric: "tabular-nums" };
    var labelValueRowStyle = { display: "flex", alignItems: "center", gap: "8px", padding: "1px 0" };
    var monoStyle = { fontVariantNumeric: "tabular-nums" };
    var detailRowStyle = { padding: "4px 0 2px 0", color: T.tertiary, fontSize: "11.5px", lineHeight: "17px", textAlign: "right" };
    var emptyTodoStyle = { color: T.tertiary, padding: "8px 0", textAlign: "center" };

    function useStoreSnapshot() {
      var ref = React.useState(store.get());
      var snap = ref[0];
      var setSnap = ref[1];
      React.useEffect(function () {
        setSnap(store.get());
        return store.subscribe(function (next) { setSnap(next); });
      }, []);
      return snap;
    }

    // Session-scoped bridge: pumps projections + session id into the shared store.
    function Bridge(props) {
      var todos = props.useProjection("todos");
      var goal = props.useProjection("goal");
      var usage = props.useProjection("tokenUsage");
      var stats = props.useProjection("sessionStats");
      var sessionId = props.sessionId != null ? props.sessionId : null;
      React.useEffect(function () {
        store.set({
          todos: todos != null ? todos : null,
          goal: goal != null ? goal : null,
          usage: usage != null ? usage : null,
          stats: stats != null ? stats : null,
          sessionId: sessionId,
        });
        return function () {
          store.set({ todos: null, goal: null, usage: null, stats: null, sessionId: null });
        };
      }, [todos, goal, usage, stats, sessionId]);
      return null;
    }

    function TokenRow(props) {
      var expRef = React.useState(false);
      var expanded = expRef[0];
      var setExpanded = expRef[1];
      var snap = props.snap;
      var usage = snap.usage;
      var stats = snap.stats;
      var billed = 0;
      var out = 0;
      var cacheRead = 0;
      var cacheWrite = 0;
      var reasoning = 0;
      if (usage != null) {
        cacheRead = usage.cacheReadTokens || 0;
        cacheWrite = usage.cacheWriteTokens || 0;
        billed = (usage.uncachedInputTokens !== undefined
          ? usage.uncachedInputTokens
          : (usage.inputTokens || 0) - cacheRead - cacheWrite) + cacheRead + cacheWrite;
        out = usage.outputTokens || 0;
        reasoning = usage.reasoningTokens || 0;
      }
      var total = billed + out;
      var speed = stats != null && stats.decodeMs > 0 && stats.decodeTokens > 0
        ? (stats.decodeTokens / (stats.decodeMs / 1e3)).toFixed(1) + " tok/s"
        : null;
      if (!(total > 0) && speed == null) return null;
      var rightParts = [];
      if (total > 0) rightParts.push(fmt(total) + " \u8ba1");
      if (speed != null) rightParts.push(speed);
      var detail = [];
      if (billed > 0) detail.push("\u8f93\u5165 " + fmt(billed));
      if (out > 0) detail.push("\u8f93\u51fa " + fmt(out));
      if (reasoning > 0) detail.push("\u63a8\u7406 " + fmt(reasoning));
      if (cacheRead > 0) detail.push("\u7f13\u5b58\u8bfb " + fmt(cacheRead));
      if (cacheWrite > 0) detail.push("\u7f13\u5b58\u5199 " + fmt(cacheWrite));
      var expandable = detail.length > 0;
      return React.createElement("div", null,
        React.createElement("button", {
          type: "button",
          onClick: function () { if (expandable) setExpanded(!expanded); },
          style: {
            display: "flex", alignItems: "center", gap: "8px", width: "100%",
            background: "none", border: "none", color: "inherit",
            cursor: expandable ? "pointer" : "default", padding: "1px 0", font: "inherit",
          },
        },
          React.createElement("span", { style: rowLabelStyle }, "Token"),
          React.createElement("span", { style: rowValueStyle }, rightParts.join(" \u00b7 ")),
          expandable ? React.createElement("span", {
            style: {
              color: T.secondary, display: "grid", placeItems: "center", flexShrink: 0,
              transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.35s ease",
            },
          }, React.createElement(ChevronDownIcon, { size: 14 })) : null,
        ),
        React.createElement("div", { className: "tp-collapse" + (expanded ? " tp-open" : "") },
          React.createElement("div", { className: "tp-inner" },
            React.createElement("div", { style: detailRowStyle }, detail.join(" \u00b7 ")),
          ),
        ),
      );
    }

    function BalanceRow() {
      var ref = React.useState({ status: "loading", data: null, error: null });
      var bal = ref[0];
      var setBal = ref[1];
      React.useEffect(function () {
        var alive = true;
        function tick() {
          var c = caches.balance;
          if (fresh(c.at) && c.payload != null) {
            if (alive) setBal({ status: "ready", data: c.payload, error: null });
            return;
          }
          fetch(BALANCE_PATH)
            .then(function (r) { return r.json(); })
            .then(function (res) {
              c.at = Date.now();
              c.payload = res;
              if (alive) setBal({ status: "ready", data: res, error: null });
            })
            .catch(function (error) {
              if (alive) setBal({ status: "error", data: null, error: String(error && error.message ? error.message : error) });
            });
        }
        tick();
        var stop = ctx.interval(tick, 60000);
        return function () { alive = false; stop(); };
      }, []);
      var value = "\u2026";
      var color = T.secondary;
      if (bal.status === "ready" && bal.data != null && bal.data.ok) {
        var infos = bal.data.balance_infos || [];
        value = infos.length > 0
          ? infos.map(function (b) { return currencySymbol(b.currency) + " " + String(b.total_balance); }).join("  ")
          : (bal.data.is_available === false ? "\u4f59\u989d\u4e0d\u8db3" : "\u4f59\u989d\u672a\u77e5");
        if (bal.data.is_available === false) color = T.error;
      } else if (bal.status === "error") {
        value = "\u2014";
        color = T.error;
      }
      return React.createElement("div", { style: labelValueRowStyle },
        React.createElement("span", { style: rowLabelStyle }, "\u4f59\u989d"),
        React.createElement("span", { style: Object.assign({}, rowValueStyle, { color: color }) }, value),
      );
    }

    function UsageBalanceSection(props) {
      var openRef = React.useState(true);
      var open = openRef[0];
      var setOpen = openRef[1];
      return React.createElement("div", null,
        React.createElement("button", {
          type: "button",
          onClick: function () { setOpen(!open); },
          style: moduleHeadBtnStyle,
        },
          React.createElement("span", { style: moduleTitleLeftStyle }, "\u7528\u91cf\u4e0e\u4f59\u989d"),
          React.createElement("span", { style: open ? moduleChevronStyle : moduleChevronClosedStyle }, React.createElement(ChevronDownIcon, { size: 13 })),
        ),
        React.createElement("div", { className: "tp-collapse" + (open ? " tp-open" : "") },
          React.createElement("div", { className: "tp-inner" },
            React.createElement("div", { style: moduleBodyStyle },
              React.createElement(TokenRow, { snap: props.snap }),
              React.createElement(BalanceRow, null),
            ),
          ),
        ),
      );
    }

    function GitSection(props) {
      var ref = React.useState({ status: "loading", data: null, error: null });
      var git = ref[0];
      var setGit = ref[1];
      var openRef = React.useState(true);
      var open = openRef[0];
      var setOpen = openRef[1];
      var sessionId = props.snap.sessionId;
      React.useEffect(function () {
        var alive = true;
        function tick() {
          var c = caches.git;
          if (fresh(c.at) && c.sid === sessionId && c.payload != null) {
            if (alive) setGit({ status: "ready", data: c.payload, error: null });
            return;
          }
          fetch(GIT_PATH + "?sessionId=" + encodeURIComponent(sessionId))
            .then(function (r) { return r.json(); })
            .then(function (res) {
              c.at = Date.now();
              c.sid = sessionId;
              c.payload = res;
              if (alive) setGit({ status: "ready", data: res, error: null });
            })
            .catch(function (error) {
              if (alive) setGit({ status: "error", data: null, error: String(error && error.message ? error.message : error) });
            });
        }
        tick();
        var stop = ctx.interval(tick, 60000);
        return function () { alive = false; stop(); };
      }, [sessionId]);
      if (sessionId == null) return null;
      var branch = "\u2026";
      var statusText = "";
      var branchColor = T.label;
      if (git.status === "ready" && git.data != null && git.data.ok) {
        branch = String(git.data.branch || "HEAD");
        var parts = [];
        if (git.data.ahead > 0) parts.push("\u2191" + git.data.ahead);
        if (git.data.behind > 0) parts.push("\u2193" + git.data.behind);
        if (git.data.changed > 0) parts.push(git.data.changed + " \u6539\u52a8");
        statusText = parts.length > 0 ? parts.join(" \u00b7 ") : "\u5e72\u51c0";
        if (git.data.changed > 0) branchColor = T.warn;
      }
      var notRepo = git.status === "error" || (git.data != null && git.data.ok === false);
      return React.createElement("div", null,
        React.createElement("button", {
          type: "button",
          onClick: function () { setOpen(!open); },
          style: moduleHeadBtnStyle,
        },
          React.createElement("span", { style: moduleTitleLeftStyle }, "Git"),
          React.createElement("span", { style: open ? moduleChevronStyle : moduleChevronClosedStyle }, React.createElement(ChevronDownIcon, { size: 13 })),
        ),
        React.createElement("div", { className: "tp-collapse" + (open ? " tp-open" : "") },
          React.createElement("div", { className: "tp-inner" },
            React.createElement("div", { style: moduleBodyStyle },
              notRepo ? React.createElement("div", { style: emptyTodoStyle }, "\u672a\u521b\u5efa Git \u4ed3\u5e93")
                : React.createElement("div", { style: labelValueRowStyle },
                  React.createElement("span", { style: { display: "flex", alignItems: "center", gap: "6px", color: branchColor, fontWeight: "600", flexShrink: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                    React.createElement("span", { style: { color: T.brand, display: "grid", placeItems: "center", flexShrink: 0 } }, React.createElement(GitBranchIcon, { size: 14 })),
                    branch,
                  ),
                  React.createElement("span", { style: rowValueStyle }, statusText),
                ),
            ),
          ),
        ),
      );
    }

    function TodoSection(props) {
      var openRef = React.useState(true);
      var open = openRef[0];
      var setOpen = openRef[1];
      var todos = props.snap.todos;
      var list = Array.isArray(todos) ? todos : [];
      var done = list.filter(function (t) { return t.status === "completed"; }).length;
      var active = list.filter(function (t) { return t.status === "in_progress"; }).length;
      var summary = (active > 0 ? "\u8fdb\u884c\u4e2d " + active + " \u00b7 " : "") + done + "/" + list.length;
      return React.createElement("div", null,
        React.createElement("button", {
          type: "button",
          onClick: function () { setOpen(!open); },
          style: moduleHeadBtnStyle,
        },
          React.createElement("span", { style: moduleTitleLeftStyle }, "\u5f85\u529e"),
          React.createElement("span", { style: { fontSize: "11px", color: T.tertiary, fontVariantNumeric: "tabular-nums" } }, summary),
          React.createElement("span", { style: open ? moduleChevronStyle : moduleChevronClosedStyle }, React.createElement(ChevronDownIcon, { size: 13 })),
        ),
        React.createElement("div", { className: "tp-collapse" + (open ? " tp-open" : "") },
          React.createElement("div", { className: "tp-inner" },
            React.createElement("div", { style: moduleBodyStyle },
              list.length > 0 ? React.createElement("div", null,
                list.map(function (item) {
                  var doneItem = item.status === "completed";
                  return React.createElement("div", {
                    key: String(item.content),
                    style: { display: "flex", gap: "8px", alignItems: "center", padding: "3px 6px", borderRadius: "8px" },
                  },
                    React.createElement(TodoStatusIcon, { status: item.status }),
                    React.createElement("span", {
                      style: {
                        flex: "1", color: doneItem ? T.tertiary : T.secondary,
                        textDecoration: doneItem ? "line-through" : "none",
                        wordBreak: "break-word", lineHeight: "17px",
                      },
                    }, String(item.content)),
                  );
                }),
              ) : React.createElement("div", { style: emptyTodoStyle }, "\u6682\u65e0\u5f85\u529e"),
            ),
          ),
        ),
      );
    }

    function GoalSection(props) {
      var openRef = React.useState(true);
      var open = openRef[0];
      var setOpen = openRef[1];
      var goal = props.snap.goal;
      if (goal == null) return null;
      var phaseMap = {
        active: { text: "\u8fdb\u884c\u4e2d", color: T.brand },
        paused: { text: "\u5df2\u6682\u505c", color: T.warn },
        completed: { text: "\u5df2\u5b8c\u6210", color: T.success },
        blocked: { text: "\u5df2\u963b\u585e", color: T.error },
      };
      var phase = phaseMap[goal.phase] || { text: goal.phase, color: T.tertiary };
      var chipStyle = { fontSize: "10.5px", fontWeight: "600", color: phase.color, background: T.layer2, borderRadius: "999px", padding: "1px 8px", flexShrink: 0 };
      return React.createElement("div", null,
        React.createElement("button", {
          type: "button",
          onClick: function () { setOpen(!open); },
          style: moduleHeadBtnStyle,
        },
          React.createElement("span", { style: moduleTitleLeftStyle }, "\u76ee\u6807"),
          React.createElement("span", { style: open ? moduleChevronStyle : moduleChevronClosedStyle }, React.createElement(ChevronDownIcon, { size: 13 })),
        ),
        React.createElement("div", { className: "tp-collapse" + (open ? " tp-open" : "") },
          React.createElement("div", { className: "tp-inner" },
            React.createElement("div", { style: moduleBodyStyle },
              React.createElement("div", { style: { color: T.secondary, lineHeight: "1.55" } }, String(goal.objective)),
              React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", color: T.tertiary } },
                React.createElement("span", { style: chipStyle }, phase.text),
                React.createElement("span", { style: monoStyle }, (goal.roundsStarted || 0) + "/" + (goal.maxGoalRounds || 0) + " \u8f6e"),
                goal.blockedReason ? React.createElement("span", { style: { flex: "1", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, String(goal.blockedReason)) : null,
              ),
            ),
          ),
        ),
      );
    }

    function Panel() {
      var snap = useStoreSnapshot();
      var colRef = React.useState(false);
      var collapsed = colRef[0];
      var setCollapsed = colRef[1];
      var closRef = React.useState(false);
      var closing = closRef[0];
      var setClosing = closRef[1];
      if (collapsed) {
        return React.createElement("button", {
          type: "button",
          title: "\u4efb\u52a1\u9762\u677f",
          onClick: function () { setCollapsed(false); },
          style: collapsedBtnStyle,
          className: "tp-icobtn",
        }, React.createElement(ChecklistIcon, { size: 16 }));
      }
      var sections = [
        React.createElement(UsageBalanceSection, { snap: snap, key: "ub" }),
        snap.sessionId != null ? React.createElement(GitSection, { snap: snap, key: "git" }) : null,
        React.createElement(TodoSection, { snap: snap, key: "todo" }),
        snap.goal != null ? React.createElement(GoalSection, { snap: snap, key: "goal" }) : null,
      ];
      var children = [];
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        if (s == null) continue;
        if (children.length > 0) children.push(React.createElement("div", { key: "d" + children.length, style: dividerStyle }));
        children.push(s);
      }
      function collapse() {
        if (closing) return;
        setClosing(true);
        ctx.timeout(function () {
          setCollapsed(true);
          setClosing(false);
        }, 350);
      }
      return React.createElement("div", { style: wrapperStyle },
        React.createElement("div", { style: cardStyle, className: "tp-grow" + (closing ? " tp-shrink" : "") },
          React.createElement("div", { style: headerStyle },
            React.createElement("span", { style: titleStyle }, "\u4efb\u52a1\u9762\u677f"),
          ),
          React.createElement("div", { style: innerScrollStyle },
            React.createElement("div", { key: "dh", style: dividerStyle }),
            children,
          ),
        ),
        React.createElement("button", {
          type: "button", style: cornerBtnStyle, className: "tp-icobtn", title: "\u6536\u8d77",
          onClick: collapse,
        }, React.createElement(ChecklistIcon, { size: 16 })),
      );
    }

    function apply(ctx) {
      // Collapsible-body and grow-from-corner CSS (guarded injection, like the shipped bundles).
      if (typeof document !== "undefined" && document.querySelector("style[data-plugin=dsh-plugin-balance]") == null) {
        var tag = document.createElement("style");
        tag.setAttribute("data-plugin", "dsh-plugin-balance");
        tag.textContent = ".tp-collapse{display:grid;grid-template-rows:0fr;transition:grid-template-rows 0.35s ease}.tp-collapse.tp-open{grid-template-rows:1fr}.tp-collapse>.tp-inner{overflow:hidden;min-height:0}.tp-grow{transform-origin:286px 18px;animation:tp-grow 0.35s cubic-bezier(0.16,1,0.3,1)}@keyframes tp-grow{from{transform:scale(0.85)}to{transform:scale(1)}}.tp-shrink{pointer-events:none;animation:tp-shrink 0.35s cubic-bezier(0.4,0,1,1) forwards}@keyframes tp-shrink{from{transform:scale(1)}to{transform:scale(0.02)}}.tp-spin{animation:tp-spin 1s linear infinite;transform-origin:50% 50%}@keyframes tp-spin{to{transform:rotate(360deg)}}.tp-icobtn{background:transparent;border-radius:12px;transition:background 0.15s ease}.tp-icobtn:hover{background:rgba(255,255,255,0.06)}";
        document.head.appendChild(tag);
      }
      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register({ name: "shell.overlay", id: "task-panel", order: 0 }, Panel);
      });
      ctx.slots.inject("conversation.input.dock", function () {
        var disposeBridge = ctx.slots.register({ name: "conversation.input.dock", id: "task-panel-bridge", order: 0 }, Bridge);
        var disposeTodo = ctx.slots.register({ name: "conversation.input.dock", id: "todo", order: 0 }, function () { return null; });
        var disposeGoal = ctx.slots.register({ name: "conversation.input.dock", id: "goal", order: 10 }, function () { return null; });
        return function () { disposeTodo(); disposeGoal(); disposeBridge(); };
      });
      ctx.slots.inject("conversation.composer.dock", function () {
        var disposeStats = ctx.slots.register({ name: "conversation.composer.dock", id: "stats", order: 0 }, function () { return null; });
        return disposeStats;
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
