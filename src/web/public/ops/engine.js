/* Agent Ops — live engine. Reproduces the design sim's `AgentSim` surface, but
   backed by paw's REAL operation stream: polls /api/ops/feed (~2s, backoff on
   error), keeps a ring buffer of completed ops + a live in-flight set, runs a
   server-aligned clock, and derives windowStats/totals/recent locally (same as
   the sim — the engine is the single source the views read from).

   Op shape (matches the views): {id,toolId,op,status,startedAt,endAt,duration,
   tokIn,tokOut,latency,args,taskId,taskLabel}. Timestamps + simNow share one
   clock (server epoch ms). Exposed as window.AgentOps. */
(function () {
	"use strict";

	var POLL_OK = 2000; // live cadence (~2s, like the canvas poller)
	var POLL_MAX = 30000; // backoff ceiling
	var BUF_CAP = 4000; // completed-op ring buffer cap

	var topology = []; // [{id,label,color,kind}]
	var byId = {};
	var completed = []; // ascending by startedAt
	var running = []; // live in-flight ops (status:"running")
	var merged = []; // completed.concat(running) — what the views iterate
	var activeArr = []; // running ops (alias of `running`)
	var agents = [];
	var cursor = 0;
	var model = "";
	var working = false;
	var horizonMs = 600000;

	var serverNow = Date.now();
	var perfAtSync = (typeof performance !== "undefined" ? performance.now() : 0);
	var state = { running: true, speed: 1 };
	var pausedAt = null; // frozen simNow while paused

	var listeners = { frame: [], "op:start": [], "op:end": [] };
	function emit(evt, payload) {
		var a = listeners[evt] || [];
		for (var i = 0; i < a.length; i++) {
			try {
				a[i](payload, API);
			} catch (e) {
				/* a bad listener must not kill the loop */
			}
		}
	}

	function nowPerf() {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
	}
	function liveNow() {
		return serverNow + (nowPerf() - perfAtSync);
	}

	function rebuildMerged() {
		merged = completed.concat(running);
		activeArr = running;
	}

	function ingest(d) {
		if (!d) return;
		serverNow = d.now;
		perfAtSync = nowPerf();
		model = d.model || model;
		working = !!d.working;
		if (typeof d.windowMs === "number") horizonMs = d.windowMs;
		if (d.cursor != null) cursor = Math.max(cursor, d.cursor);
		agents = d.agents || [];

		if (Array.isArray(d.topology) && d.topology.length) {
			topology = d.topology;
			byId = {};
			for (var i = 0; i < topology.length; i++) byId[topology[i].id] = topology[i];
		}

		// Append new completed ops by id (backfill replaces, increments append).
		var ops = d.ops || [];
		for (var j = 0; j < ops.length; j++) completed.push(ops[j]);
		// Keep ascending + bounded.
		completed.sort(function (a, b) {
			return a.startedAt - b.startedAt;
		});
		if (completed.length > BUF_CAP) completed.splice(0, completed.length - BUF_CAP);

		// Running set is replaced wholesale each poll (current in-flight snapshot).
		running = d.inflight || [];
		rebuildMerged();
	}

	var pollTimer = null;
	var pollDelay = POLL_OK;
	function poll() {
		fetch("/api/ops/feed?since=" + cursor, { credentials: "same-origin" })
			.then(function (r) {
				if (!r.ok) throw new Error("ops feed " + r.status);
				return r.json();
			})
			.then(function (d) {
				ingest(d);
				pollDelay = POLL_OK;
			})
			.catch(function () {
				pollDelay = Math.min(POLL_MAX, pollDelay * 2);
			})
			.finally(function () {
				pollTimer = setTimeout(poll, pollDelay);
			});
	}

	// rAF frame pump — the clock is a getter, so the loop just emits 'frame'.
	function loop() {
		emit("frame", API);
		requestAnimationFrame(loop);
	}

	// --- sliding-window aggregates (ported verbatim from the design sim) -------
	function windowStats(toolId, win) {
		win = win || 5000;
		var from = API.simNow - win;
		var total = 0,
			errors = 0,
			latSum = 0,
			durSum = 0,
			act = 0;
		for (var i = merged.length - 1; i >= 0; i--) {
			var o = merged[i];
			if (o.toolId !== toolId) continue;
			if (o.status === "running") {
				act++;
				continue;
			}
			if (o.endAt >= from) {
				total++;
				latSum += o.latency || 0;
				durSum += o.duration;
				if (o.status === "error") errors++;
			}
		}
		return {
			tps: total / (win / 1000),
			errorRate: total ? errors / total : 0,
			avgLatency: total ? latSum / total : 0,
			avgDuration: total ? durSum / total : 0,
			active: act,
			total: total,
		};
	}

	function totals(win) {
		win = win || 5000;
		var per = topology.map(function (t) {
			var s = windowStats(t.id, win);
			s.tool = t;
			return s;
		});
		var tps = per.reduce(function (s, p) {
			return s + p.tps;
		}, 0);
		var totalOps = per.reduce(function (s, p) {
			return s + p.total;
		}, 0);
		var errs = per.reduce(function (s, p) {
			return s + p.errorRate * p.total;
		}, 0);
		per.sort(function (a, b) {
			return b.tps - a.tps;
		});
		return {
			tps: tps,
			active: running.length,
			errorRate: totalOps ? errs / totalOps : 0,
			total: merged.length,
			byTool: per,
		};
	}

	function recent(n) {
		return merged.slice(Math.max(0, merged.length - n)).reverse();
	}
	function opsInWindow(fromT, toT) {
		return merged.filter(function (o) {
			return o.endAt >= fromT && o.startedAt <= toT;
		});
	}

	var API = {
		get TOOLS() {
			return topology;
		},
		get TOOL_BY_ID() {
			return byId;
		},
		get ops() {
			return merged;
		},
		get active() {
			return activeArr;
		},
		get agents() {
			return agents;
		},
		get model() {
			return model;
		},
		get working() {
			return working;
		},
		get HORIZON_MS() {
			return horizonMs;
		},
		get simNow() {
			return state.running ? liveNow() : pausedAt != null ? pausedAt : liveNow();
		},
		get running() {
			return state.running;
		},
		get speed() {
			return state.speed;
		},
		setRunning: function (v) {
			v = !!v;
			if (v === state.running) return;
			state.running = v;
			pausedAt = v ? null : liveNow();
		},
		toggleRunning: function () {
			API.setRunning(!state.running);
			return state.running;
		},
		setSpeed: function (x) {
			state.speed = x;
		},
		on: function (evt, cb) {
			(listeners[evt] = listeners[evt] || []).push(cb);
			return function () {
				var a = listeners[evt];
				var i = a.indexOf(cb);
				if (i >= 0) a.splice(i, 1);
			};
		},
		windowStats: windowStats,
		totals: totals,
		recent: recent,
		opsInWindow: opsInWindow,
		start: function () {
			if (pollTimer) return API;
			poll();
			requestAnimationFrame(loop);
			return API;
		},
	};

	window.AgentOps = API;
})();
