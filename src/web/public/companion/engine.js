/**
 * CompanionEngine — the live data layer for the Skill Dock companion.
 *
 * Two real sources, no mock:
 *  - GET /api/ops/feed (~2s): topology (skills + connected services), spawned
 *    sub-agents, and recent ops. A same-origin module CAN fetch this (the old
 *    null-origin portrait iframe could not).
 *  - postMessage `paw:tool` from the chat page: low-latency per-tool start/end/
 *    work/done with skillKey + agentName, so beams light the instant a tool runs.
 *
 * Motion is event-driven: skills/beams light on activation and wind down; there
 * is no idle churn.
 */
(() => {
	const HOLD_MS = 900; // minimum readable glow once a skill lights
	const GRACE_MS = 2600; // wind-down after a tool ends
	const BEAM_MS = 1100; // a tether beam's lifetime
	const THINK_MS = 1500; // antenna thinking-dots linger after a heartbeat
	const FEED_MAX = 8;

	function CompanionEngine() {
		this.skills = []; // [{key,label}]
		this.agents = []; // [{id,name,task,done,ok}]
		this.active = new Map(); // key -> untilTs
		this.agentActive = new Map(); // agentId -> untilTs
		this.beams = []; // {id,fromKey,target,bornAt,untilTs}
		this.feed = []; // [{label,skillKey,agentName,isError,ts}]
		this.model = "";
		this.thinkingUntil = 0;
		this.activeCount = 0;
		this._beamSeq = 0;
		this._cursor = 0;
		this._timer = null;
		this._stopped = false;
	}

	CompanionEngine.prototype.start = function (cfg) {
		this.model = (cfg && cfg.model) || "";
		this._stopped = false;
		this._poll();
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
				if (!self._stopped) {
					self._timer = setTimeout(() => self._poll(), 2000);
				}
			});
	};

	/** Merge a /api/ops/feed payload: skills (topology), agents, model. */
	CompanionEngine.prototype._ingestFeed = function (data) {
		if (typeof data.cursor === "number") this._cursor = data.cursor;
		if (data.model) this.model = data.model;
		if (Array.isArray(data.topology)) {
			const skills = [];
			const seen = {};
			for (const n of data.topology) {
				const key = String(n.id || n.key || "");
				if (!key || key === "core" || seen[key]) continue;
				seen[key] = 1;
				skills.push({ key, label: String(n.label || key) });
			}
			if (skills.length) this.skills = skills;
		}
		if (Array.isArray(data.agents)) {
			this.agents = data.agents.map((a) => ({
				id: String(a.id),
				name: String(a.name || a.id),
				task: String(a.task || ""),
				done: !!a.done,
				ok: a.ok !== false,
			}));
		}
	};

	/** Handle a relayed `paw:tool` message (phase: start|end|work|done). */
	CompanionEngine.prototype.ingestTool = function (msg, now) {
		now = now || Date.now();
		if (!msg || msg.type !== "paw:tool") return;
		if (msg.phase === "done") {
			this.active.clear();
			this.agentActive.clear();
			this.beams = [];
			this.activeCount = 0;
			return;
		}
		if (msg.phase === "work") {
			this.thinkingUntil = now + THINK_MS;
			return;
		}
		const key = msg.skillKey || null;
		if (msg.phase === "start") {
			this.activeCount++;
			this.thinkingUntil = now + THINK_MS;
			if (key) this.active.set(key, now + HOLD_MS);
			const target = window.CompanionTopology.beamTarget(
				{ agentName: msg.agentName },
				this.agents,
			);
			if (target.kind === "agent") {
				this.agentActive.set(target.id, now + HOLD_MS);
			}
			if (key) {
				this.beams.push({
					id: ++this._beamSeq,
					fromKey: key,
					target,
					bornAt: now,
					untilTs: now + BEAM_MS,
				});
			}
			this.feed.unshift({
				label: msg.summary || msg.toolName || key || "tool",
				skillKey: key,
				agentName: msg.agentName || null,
				isError: !!msg.isError,
				ts: now,
			});
			if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
		} else if (msg.phase === "end") {
			this.activeCount = Math.max(0, this.activeCount - 1);
			if (key) this.active.set(key, now + GRACE_MS); // begin wind-down
			if (msg.isError) {
				for (const f of this.feed) {
					if (f.skillKey === key) {
						f.isError = true;
						break;
					}
				}
			}
		}
	};

	/** Prune expired state and return a render snapshot. */
	CompanionEngine.prototype.getState = function (now) {
		now = now || Date.now();
		for (const [k, until] of this.active) {
			if (until < now) this.active.delete(k);
		}
		for (const [k, until] of this.agentActive) {
			if (until < now) this.agentActive.delete(k);
		}
		this.beams = this.beams.filter((b) => b.untilTs >= now);
		return {
			skills: this.skills,
			agents: this.agents,
			active: this.active,
			agentActive: this.agentActive,
			beams: this.beams,
			feed: this.feed,
			model: this.model,
			thinking: now < this.thinkingUntil,
			busy: this.activeCount > 0 || this.beams.length > 0,
			now,
		};
	};

	window.CompanionEngine = CompanionEngine;
})();
