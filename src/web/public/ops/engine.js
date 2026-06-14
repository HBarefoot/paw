/* ===========================================================================
   engine.js — Agent Operations live engine (REAL feed edition).
   Polls GET /api/ops/feed every ~2s, merges completed ops (by id) + swaps the
   in-flight set, and derives every aggregate the dashboard renders — windowed
   throughput/latency, per-tool health, session stats, a client-bucketed history
   for the charts, and sub-agent "tasks" grouped by taskId. NOTHING is invented:
   every number traces to a real field (tool_log durations, in-flight registry,
   topology, toolMetrics, usage_log cost/tokens). Vanilla — exposes window.AgentOps.
   =========================================================================== */
(() => {
	const POLL_OK = 2000; // normal cadence (~2s)
	const POLL_MAX = 30000; // error backoff ceiling
	const RING_MAX = 4000; // completed-op ring cap
	const HIST_SEC = 240; // history horizon (seconds) for the charts

	const state = {
		tools: [],
		toolById: {},
		ops: [], // completed, ascending by startedAt, deduped by id
		seenIds: new Set(),
		inflight: [],
		agents: [],
		model: "",
		working: false,
		usage: { costUsd: 0, tokIn: 0, tokOut: 0 },
		toolMetrics: {},
		serverNow: 0, // last server `now`
		perfAtSync: 0, // performance.now() when we synced serverNow
		cursor: 0,
		running: true, // poll active (Pause stops it)
		connected: false, // a poll has succeeded
		startedAt: 0, // client clock at first data (session uptime base)
		lastActivityAt: 0,
		hist: [], // cached history buckets {t,ok,err,inFlight,p50,p95}
	};
	const listeners = { data: [] };
	function emit(evt) {
		(listeners[evt] || []).forEach((cb) => cb(state));
	}

	/** Smooth client clock aligned to the last server `now`. */
	function now() {
		return state.serverNow + (performance.now() - state.perfAtSync);
	}

	function percentile(arr, q) {
		if (!arr.length) return 0;
		const s = arr.slice().sort((a, b) => a - b);
		const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
		return s[i];
	}

	// --- merge a feed payload --------------------------------------------------
	function ingest(d) {
		state.serverNow = d.now || Date.now();
		state.perfAtSync = performance.now();
		if (!state.startedAt) state.startedAt = state.serverNow;
		state.model = d.model || state.model;
		state.working = !!d.working;
		state.usage = d.usage || state.usage;
		state.toolMetrics = d.toolMetrics || {};
		state.agents = d.agents || [];
		if (typeof d.cursor === "number") state.cursor = d.cursor;
		if (Array.isArray(d.topology)) {
			state.tools = d.topology;
			state.toolById = {};
			for (const t of d.topology) state.toolById[t.id] = t;
		}
		// completed ops accumulate by id (incremental polls only send new rows;
		// the since=0 backfill seeds the window).
		if (Array.isArray(d.ops)) {
			for (const o of d.ops) {
				if (state.seenIds.has(o.id)) continue;
				state.seenIds.add(o.id);
				state.ops.push(o);
			}
			state.ops.sort((a, b) => a.startedAt - b.startedAt);
			if (state.ops.length > RING_MAX) {
				const drop = state.ops.splice(0, state.ops.length - RING_MAX);
				for (const o of drop) state.seenIds.delete(o.id);
			}
		}
		// in-flight is swapped wholesale each poll.
		state.inflight = Array.isArray(d.inflight) ? d.inflight : [];
		const lastOp = state.ops[state.ops.length - 1];
		if (state.inflight.length) state.lastActivityAt = now();
		else if (lastOp)
			state.lastActivityAt = Math.max(state.lastActivityAt, lastOp.endAt);
		rebuildHistory();
		state.connected = true;
		emit("data");
	}

	// --- client-bucketed history (per-second ok/err/inFlight/p50/p95) ----------
	function rebuildHistory() {
		const end = now();
		const start = end - HIST_SEC * 1000;
		const n = HIST_SEC;
		const buckets = new Array(n);
		for (let i = 0; i < n; i++)
			buckets[i] = { ok: 0, err: 0, inFlight: 0, durs: null };
		const idxFor = (t) => Math.floor((t - start) / 1000);
		for (const o of state.ops) {
			const bi = idxFor(o.endAt);
			if (bi < 0 || bi >= n) continue;
			if (o.status === "error") buckets[bi].err++;
			else buckets[bi].ok++;
			(buckets[bi].durs || (buckets[bi].durs = [])).push(o.duration);
		}
		// concurrency: every op (completed + running) marks the buckets it spanned.
		const markSpan = (s, e) => {
			let a = idxFor(s);
			let b = idxFor(e);
			if (b < 0 || a >= n) return;
			a = Math.max(0, a);
			b = Math.min(n - 1, b);
			for (let i = a; i <= b; i++) buckets[i].inFlight++;
		};
		for (const o of state.ops) markSpan(o.startedAt, o.endAt);
		for (const f of state.inflight) markSpan(f.startedAt, end);
		state.hist = buckets.map((b, i) => ({
			t: start + (i + 1) * 1000,
			ok: b.ok,
			err: b.err,
			inFlight: b.inFlight,
			p50: b.durs ? percentile(b.durs, 0.5) : 0,
			p95: b.durs ? percentile(b.durs, 0.95) : 0,
		}));
	}

	// --- derived aggregates (all from real ops) --------------------------------
	function windowStats(toolId, win = 5000) {
		const from = now() - win;
		let total = 0;
		let errors = 0;
		let durSum = 0;
		for (const o of state.ops) {
			if (o.toolId !== toolId) continue;
			if (o.endAt < from) continue;
			total++;
			durSum += o.duration;
			if (o.status === "error") errors++;
		}
		const active = state.inflight.filter((f) => f.toolId === toolId).length;
		return {
			tps: total / (win / 1000),
			errorRate: total ? errors / total : 0,
			avgDuration: total ? durSum / total : 0,
			active,
			total,
		};
	}

	function totals(win = 5000) {
		const per = state.tools.map((t) => ({ tool: t, ...windowStats(t.id, win) }));
		const tps = per.reduce((s, p) => s + p.tps, 0);
		const totalOps = per.reduce((s, p) => s + p.total, 0);
		const errs = per.reduce((s, p) => s + p.errorRate * p.total, 0);
		per.sort((a, b) => b.tps - a.tps);
		return {
			tps,
			active: state.inflight.length,
			errorRate: totalOps ? errs / totalOps : 0,
			total: state.ops.length,
			byTool: per,
		};
	}

	function latencyPctl(win = 10000) {
		const from = now() - win;
		const durs = [];
		for (const o of state.ops) {
			if (o.endAt < from) continue;
			durs.push(o.duration);
		}
		return { p50: percentile(durs, 0.5), p95: percentile(durs, 0.95), n: durs.length };
	}

	/** Per-tool ops-per-second ring (last `len` seconds) for the health sparkline. */
	function toolSpark(toolId, len = 30) {
		const end = now();
		const arr = new Array(len).fill(0);
		for (const o of state.ops) {
			if (o.toolId !== toolId) continue;
			const bi = len - 1 - Math.floor((end - o.endAt) / 1000);
			if (bi >= 0 && bi < len) arr[bi]++;
		}
		return arr;
	}

	function toolHealth() {
		const t = now();
		return state.tools.map((tool) => {
			let opsTotal = 0;
			let errTotal = 0;
			let lastSeenAt = -1e15;
			for (const o of state.ops) {
				if (o.toolId !== tool.id) continue;
				opsTotal++;
				if (o.status === "error") errTotal++;
				if (o.endAt > lastSeenAt) lastSeenAt = o.endAt;
			}
			const w = windowStats(tool.id, 8000);
			const since = t - lastSeenAt;
			const errorRate = opsTotal ? errTotal / opsTotal : 0;
			let status;
			if (opsTotal === 0) status = "never";
			else if (w.active > 0 || since < 4000)
				status = errorRate > 0.12 ? "degraded" : "live";
			else status = "idle";
			if (status !== "never" && errorRate > 0.1 && since < 30000)
				status = "degraded";
			// group: MCP servers (mcp:* / service nodes) vs built-in tools.
			const group =
				tool.id.indexOf("mcp:") === 0 ||
				tool.kind === "service" ||
				tool.kind === "mcp"
					? "mcp"
					: "agent";
			return {
				tool,
				group,
				status,
				lastSeenAt,
				since,
				opsTotal,
				errTotal,
				errorRate,
				tps: w.tps,
				active: w.active,
				avgDuration: w.avgDuration,
				spark: toolSpark(tool.id),
			};
		});
	}

	// sub-agent runs as "tasks": group real ops by non-zero taskId.
	function tasks() {
		const byId = new Map();
		const agentByTask = new Map(state.agents.map((a) => [a.task, a]));
		const consider = state.ops.concat(state.inflight);
		for (const o of consider) {
			if (!o.taskId) continue;
			let task = byId.get(o.taskId);
			if (!task) {
				task = {
					id: o.taskId,
					label: o.taskLabel || "sub-agent",
					startedAt: o.startedAt,
					endedAt: o.endAt,
					opCount: 0,
					errCount: 0,
					tokIn: 0,
					tokOut: 0,
					tools: new Set(),
					running: false,
				};
				byId.set(o.taskId, task);
			}
			task.opCount++;
			task.tokIn += o.tokIn || 0;
			task.tokOut += o.tokOut || 0;
			task.tools.add(o.toolId);
			task.startedAt = Math.min(task.startedAt, o.startedAt);
			task.endedAt = Math.max(task.endedAt, o.endAt);
			if (o.status === "error") task.errCount++;
			if (o.status === "running") task.running = true;
		}
		const arr = [...byId.values()];
		for (const task of arr) {
			const agent = agentByTask.get(task.label);
			task.status =
				task.running || (agent && !agent.done) ? "running" : "done";
		}
		arr.sort((a, b) => b.startedAt - a.startedAt);
		return arr;
	}

	function sessionStats() {
		// lifetime ops/errors from the metrics hook (real, since boot); tokens +
		// cost from usage_log (real). opsPerMin/tokPerSec over session uptime.
		let opsTotal = 0;
		let errTotal = 0;
		let totalMs = 0;
		for (const k in state.toolMetrics) {
			const m = state.toolMetrics[k];
			opsTotal += m.count || 0;
			errTotal += m.errors || 0;
			totalMs += m.totalMs || 0;
		}
		const dur = Math.max(1, now() - state.startedAt);
		const ts = tasks();
		return {
			opsTotal,
			errTotal,
			errorRate: opsTotal ? errTotal / opsTotal : 0,
			avgDuration: opsTotal ? totalMs / opsTotal : 0,
			tokIn: state.usage.tokIn || 0,
			tokOut: state.usage.tokOut || 0,
			cost: state.usage.costUsd || 0,
			durationMs: dur,
			opsPerMin: opsTotal / (dur / 60000),
			tokPerSec:
				((state.usage.tokIn || 0) + (state.usage.tokOut || 0)) / (dur / 1000),
			tasksDone: ts.filter((x) => x.status === "done").length,
			tasksStarted: ts.length,
		};
	}

	function recent(n) {
		const merged = state.inflight.concat(state.ops);
		merged.sort((a, b) => {
			const ta = a.status === "running" ? Number.MAX_SAFE_INTEGER : a.endAt;
			const tb = b.status === "running" ? Number.MAX_SAFE_INTEGER : b.endAt;
			return tb - ta;
		});
		return merged.slice(0, n);
	}

	function getActivity() {
		return {
			state: state.working ? "working" : "standby",
			inFlight: state.inflight.length,
			lastActivityAt: state.lastActivityAt,
			since: now() - state.lastActivityAt,
		};
	}

	// --- poll loop -------------------------------------------------------------
	let pollDelay = POLL_OK;
	let timer = null;
	async function poll() {
		if (!state.running) return;
		try {
			const r = await fetch(`/api/ops/feed?since=${state.cursor}`, {
				headers: { Accept: "application/json" },
			});
			if (!r.ok) throw new Error(`feed ${r.status}`);
			ingest(await r.json());
			pollDelay = POLL_OK;
		} catch (_e) {
			state.connected = false;
			pollDelay = Math.min(POLL_MAX, pollDelay * 2);
			emit("data");
		}
		if (state.running) timer = setTimeout(poll, pollDelay);
	}

	const API = {
		on(evt, cb) {
			(listeners[evt] = listeners[evt] || []).push(cb);
			return () => {
				const a = listeners[evt];
				const i = a.indexOf(cb);
				if (i >= 0) a.splice(i, 1);
			};
		},
		start() {
			if (timer) return;
			state.running = true;
			poll();
		},
		setRunning(v) {
			state.running = !!v;
			if (v) {
				if (!timer) poll();
			} else if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			emit("data");
		},
		get running() {
			return state.running;
		},
		get connected() {
			return state.connected;
		},
		get tools() {
			return state.tools;
		},
		toolById(id) {
			return state.toolById[id];
		},
		get model() {
			return state.model;
		},
		get agents() {
			return state.agents;
		},
		now,
		windowStats,
		totals,
		latencyPctl,
		toolHealth,
		tasks,
		sessionStats,
		recent,
		getActivity,
		history() {
			return state.hist;
		},
		// test seam: feed a payload directly without the network.
		_ingest: ingest,
	};

	window.AgentOps = API;
})();
