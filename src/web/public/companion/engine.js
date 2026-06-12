/**
 * CompanionEngine — the live data layer for the Skill Dock companion.
 *
 * Skills come from the injected config (ordered, humanized — so the column +
 * overflow are right immediately). Sub-agents come from GET /api/ops/feed
 * (~2s). Per-tool liveliness comes from the chat page's postMessage `paw:tool`
 * relay (skillKey + agentName), so a beam lights the instant a tool runs and
 * routes to the acting agent. Motion is event-driven (skills wind down on a
 * timer; no idle churn). Op labels are the REAL tool summary/name, not a sim.
 */
(() => {
	const HOLD_MS = 2200; // base active-glow duration (prototype: 2200–4000ms)
	const HOLD_JITTER = 1800;
	const THINK_MS = 1500;
	const FEED_MAX = 6;

	function CompanionEngine() {
		this.skills = []; // [{key,label}] from config
		this.agents = []; // [{id,name}] from the feed
		this.active = new Map(); // key -> {untilTs, actor}
		this.ops = []; // [{label, agentName, isError, ts, toolId}]
		this.thinkingUntil = 0;
		this.mainPops = 0; // bumps when the orchestrator (not a sub-agent) acts
		this._cursor = 0;
		this._timer = null;
		this._stopped = false;
	}

	CompanionEngine.prototype.start = function (cfg) {
		cfg = cfg || {};
		this.setSkills(cfg.skills || []);
		this._stopped = false;
		this._poll();
	};

	CompanionEngine.prototype.setSkills = function (list) {
		this.skills = (list || []).map((s) => ({
			key: String(s.key),
			label: String(s.label || s.key),
		}));
	};

	CompanionEngine.prototype.stop = function () {
		this._stopped = true;
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
	};

	CompanionEngine.prototype._poll = function () {
		const self = this;
		fetch(`/api/ops/feed?since=${this._cursor}`, { credentials: "same-origin" })
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (data) self._ingestFeed(data);
			})
			.catch(() => {})
			.finally(() => {
				if (!self._stopped) self._timer = setTimeout(() => self._poll(), 2000);
			});
	};

	CompanionEngine.prototype._ingestFeed = function (data) {
		if (typeof data.cursor === "number") this._cursor = data.cursor;
		if (Array.isArray(data.agents)) {
			this.agents = data.agents.map((a) => ({
				id: String(a.id),
				name: String(a.name || a.id),
			}));
		}
		// Fallback: if config supplied no skills, derive them from the topology.
		if (this.skills.length === 0 && Array.isArray(data.topology)) {
			const seen = {};
			const out = [];
			for (const n of data.topology) {
				const key = String(n.id || n.key || "");
				if (!key || key === "core" || seen[key]) continue;
				seen[key] = 1;
				out.push({ key, label: String(n.label || key) });
			}
			this.skills = out;
		}
	};

	/** Handle a relayed `paw:tool` message (phase: start|end|work|done). */
	CompanionEngine.prototype.ingestTool = function (msg, now) {
		now = now || Date.now();
		if (!msg || msg.type !== "paw:tool") return;
		if (msg.phase === "done") {
			this.active.clear();
			return;
		}
		if (msg.phase === "work") {
			this.thinkingUntil = now + THINK_MS;
			return;
		}
		const key = msg.skillKey || null;
		const actor = msg.agentName || null;
		if (msg.phase === "start") {
			this.thinkingUntil = now + THINK_MS;
			if (!actor) this.mainPops++;
			if (key) {
				this.active.set(key, {
					untilTs: now + HOLD_MS + Math.random() * HOLD_JITTER,
					actor,
				});
			}
			this.ops.unshift({
				label: msg.summary || msg.toolName || key || "tool",
				agentName: actor,
				isError: !!msg.isError,
				ts: now,
				toolId: msg.toolId || null,
			});
			if (this.ops.length > FEED_MAX) this.ops.length = FEED_MAX;
		} else if (msg.phase === "end" && msg.isError) {
			// A failure surfaces at end — flag the matching op's dot red.
			for (const o of this.ops) {
				if (msg.toolId && o.toolId === msg.toolId) {
					o.isError = true;
					break;
				}
			}
		}
	};

	/** Prune expired skills and return a render snapshot. */
	CompanionEngine.prototype.getState = function (now) {
		now = now || Date.now();
		for (const [k, v] of this.active) {
			if (v.untilTs < now) this.active.delete(k);
		}
		// An agent is "working" while it owns an active skill.
		const working = new Set();
		for (const [, v] of this.active) if (v.actor) working.add(v.actor);
		const agents = this.agents.map((a, i) => ({
			id: a.id,
			name: a.name,
			gradIndex: i % 3,
			working: working.has(a.name) || working.has(a.id),
		}));
		return {
			skills: this.skills,
			active: this.active,
			agents,
			ops: this.ops,
			thinking: now < this.thinkingUntil,
			busy: this.active.size > 0,
			mainPops: this.mainPops,
			now,
		};
	};

	window.CompanionEngine = CompanionEngine;
})();
