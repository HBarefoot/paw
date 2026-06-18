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
	const AGENT_WORK_MS = 2400; // an orb stays "working" this long after its last tool
	const DONE_LINGER_MS = 1600; // a finished orb plays its absorb, then leaves
	const PENDING_TTL_MS = 6000; // drop a relay spawn the feed never confirmed
	const POLL_BUSY_MS = 700; // poll fast while a swarm is live…
	const POLL_IDLE_MS = 2000; // …and lazily when idle
	// How long the main face stays "working" after the last feed poll that
	// reported in-flight ops. Debounces stop (so it doesn't flicker between bursts)
	// and is fail-open: if an op-end is ever missed, the face self-idles after this
	// window instead of sticking. Kept > POLL_IDLE_MS so continuous background work
	// stays lit even across the lazy cadence.
	const FEED_BUSY_LINGER_MS = 2500;

	function freshMachine() {
		return window.CompanionExpression
			? window.CompanionExpression.freshMachine()
			: { listenUntil: 0, successUntil: 0, winceUntil: 0 };
	}

	/** The spawned agent's name from a relayed spawn_agent chunk, else null. */
	function spawnNameOf(msg) {
		const s = msg.summary || "";
		const PREFIX = "Spawning agent:";
		if (s.indexOf(PREFIX) === 0) {
			const name = s.slice(PREFIX.length).trim();
			if (name && name !== "unknown") return name;
		}
		return null;
	}

	function CompanionEngine() {
		this.skills = []; // [{key,label}] from config
		this.agents = []; // [{id,name}] from the feed
		this.active = new Map(); // key -> {untilTs, actor}
		this.ops = []; // [{label, agentName, isError, ts, toolId}]
		this.thinkingUntil = 0;
		this.mainPops = 0; // bumps when the orchestrator (not a sub-agent) acts
		// Sub-agent fidelity: the feed (kernel.activeAgents, stored in this.agents)
		// is the authoritative SET, but these give the orbs real-time appearance +
		// correct liveliness so they match the chat's "Spawning agent" rows.
		this.workingUntil = new Map(); // name -> ts: an agent is "working" while it
		// runs ANY [name]-attributed tool (independent of whether it maps to a skill)
		this.pendingSpawns = new Map(); // name -> ts: spawned (relay) but not yet in feed
		this.subDone = new Map(); // name -> {doneAt, ok}: display-linger + tombstone
		this._spawnTool = new Map(); // spawn_agent toolId -> agent name (to finalize)
		// Expression inputs (real signals → the pure CompanionExpression machine).
		this.machine = freshMachine(); // transient holds: listen/success/wince
		this.waiting = false; // a GitHub action is pending human approval
		this.waitingLabel = ""; // informative caption for the waiting face
		this.unreadByKind = {}; // {skillKey: unreadCount} → badges the skill pill
		this.agentFailedUntil = 0; // latched "worried" window after a sub-agent fails
		this.lastActiveAt = 0; // for idle → sleepy decay
		this._errAt = 0; // last tool-error time…
		this._errRecovered = true; // …cleared once a later tool succeeds
		this._seenFailed = {}; // sub-agent ids already counted as failed (latch once)
		// Feed-driven "is anything running" — the SAME signal the Agent Ops panel
		// uses (ops feed `working`/`inflight`). Lit by _ingestFeed for ANY in-flight
		// op (foreground chat, cron, sub-agent, background tool), so the face no
		// longer relies solely on the foreground chat's paw:tool relay. Held until
		// FEED_BUSY_LINGER_MS after the last working poll (debounce + fail-open).
		this._feedBusyUntil = 0;
		this._cursor = 0;
		this._timer = null;
		this._stopped = false;
	}

	CompanionEngine.prototype.start = function (cfg) {
		cfg = cfg || {};
		this.setSkills(cfg.skills || []);
		this.lastActiveAt = Date.now(); // boot is "just active" → idle, not sleepy
		this._stopped = false;
		this._poll();
	};

	function noteMachine(self, event, now) {
		if (window.CompanionExpression) {
			window.CompanionExpression.note(self.machine, event, now);
		}
	}

	/** Relay the chat input's focus/typing state → the "listening" face. */
	CompanionEngine.prototype.ingestInput = function (state, now) {
		now = now || Date.now();
		this.lastActiveAt = now;
		noteMachine(this, { type: "input", state: state }, now);
	};

	/** Ambient signal: GitHub actions awaiting human approval → "waiting".
	 *  `label` is an optional informative caption (what + how many). */
	CompanionEngine.prototype.setWaiting = function (pending, label) {
		this.waiting = pending > 0;
		this.waitingLabel = this.waiting && label ? String(label) : "";
	};

	/** Per-kind unread notification counts → badges on the matching skill pills. */
	CompanionEngine.prototype.setNotifications = function (byKind) {
		this.unreadByKind = byKind && typeof byKind === "object" ? byKind : {};
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
				if (self._stopped) return;
				// Poll fast while any agent is live/pending so orbs track the chat,
				// or while the feed reports in-flight work, so background/cron bursts
				// are caught promptly and the busy linger keeps refreshing.
				const live =
					self.pendingSpawns.size > 0 ||
					self.agents.some((a) => !a.done) ||
					self.subDone.size > 0 ||
					Date.now() < self._feedBusyUntil;
				self._timer = setTimeout(
					() => self._poll(),
					live ? POLL_BUSY_MS : POLL_IDLE_MS,
				);
			});
	};

	CompanionEngine.prototype._ingestFeed = function (data, now) {
		now = now || Date.now();
		if (typeof data.cursor === "number") this._cursor = data.cursor;
		// Live activity from the SAME source the Agent Ops dashboard consumes: the
		// feed's `working` flag (in-flight ops OR a live sub-agent) plus a defensive
		// check of the `inflight` array. This is what makes the avatar reflect
		// background/cron/sub-agent work and fast bursts — not just the foreground
		// chat's paw:tool relay. Refreshes the linger on every working poll.
		const feedWorking =
			data.working === true ||
			(Array.isArray(data.inflight) && data.inflight.length > 0);
		if (feedWorking) {
			this._feedBusyUntil = now + FEED_BUSY_LINGER_MS;
			this.lastActiveAt = now; // keep the idle→sleepy decay from firing mid-work
		}
		// Pending GitHub approvals → "waiting" (feed read-path, default 0 when off).
		if (typeof data.pendingApprovals === "number") {
			this.setWaiting(data.pendingApprovals, data.pendingApprovalsLabel);
		}
		if (Array.isArray(data.agents)) {
			this.agents = data.agents.map((a) => ({
				id: String(a.id),
				name: String(a.name || a.id),
				done: a.done === true,
				ok: a.ok !== false,
			}));
			// Once the feed confirms a spawned agent, drop its real-time placeholder.
			for (const a of this.agents) this.pendingSpawns.delete(a.name);
			// A sub-agent that finished NOT-ok → latch "worried" once per agent.
			for (const a of data.agents) {
				if (a.done === true && a.ok === false) {
					const id = String(a.id);
					if (!this._seenFailed[id]) {
						this._seenFailed[id] = 1;
						const hold = window.CompanionExpression
							? window.CompanionExpression.GUARD.worriedHoldMs
							: 2600;
						this.agentFailedUntil = now + hold;
					}
				}
			}
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
			this.lastActiveAt = now;
			return;
		}
		const key = msg.skillKey || null;
		const actor = msg.agentName || null;
		if (msg.phase === "start") {
			this.thinkingUntil = now + THINK_MS;
			this.lastActiveAt = now;
			// A new tool running after an unrecovered error = the agent moved on:
			// cancel the pending wince so a transient failure never reaches the face.
			if (this._errAt && !this._errRecovered) {
				this._errRecovered = true;
				noteMachine(this, { type: "recovered" }, now);
			}
			if (!actor) this.mainPops++;
			// A spawn (orchestrator calling spawn_agent) → an orb appears the instant
			// the chat shows its "Spawning agent: X" row, before the feed catches up.
			const spawnName = spawnNameOf(msg);
			if (spawnName) {
				this.subDone.delete(spawnName); // a re-spawn clears the tombstone
				this.pendingSpawns.set(spawnName, now);
				if (msg.toolId) this._spawnTool.set(msg.toolId, spawnName);
			}
			// An agent is "working" while it runs ANY of its own tools — regardless
			// of whether the tool maps to a skill pill (the core IDLE-while-busy fix).
			if (actor) this.workingUntil.set(actor, now + AGENT_WORK_MS);
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
		} else if (msg.phase === "end") {
			this.lastActiveAt = now;
			// A spawn_agent tool ending = that sub-agent finished → start its absorb.
			const endedName = msg.toolId && this._spawnTool.get(msg.toolId);
			if (endedName) {
				this._spawnTool.delete(msg.toolId);
				this.pendingSpawns.delete(endedName);
				this.workingUntil.delete(endedName);
				this.subDone.set(endedName, { doneAt: now, ok: !msg.isError });
			}
			if (msg.isError) {
				// A failure surfaces at end — flag the matching op's dot red and arm
				// a wince (severity 2). A later success will mark it recovered.
				this._errAt = now;
				this._errRecovered = false;
				noteMachine(this, { type: "error", severity: 2 }, now);
				for (const o of this.ops) {
					if (msg.toolId && o.toolId === msg.toolId) {
						o.isError = true;
						break;
					}
				}
			} else {
				noteMachine(this, { type: "success" }, now);
				if (this._errAt && !this._errRecovered) {
					this._errRecovered = true;
					noteMachine(this, { type: "recovered" }, now);
				}
			}
		}
	};

	/**
	 * The faithful sub-agent set for the orbs: the feed (authoritative) unioned
	 * with relay spawns the feed hasn't confirmed yet and any name currently
	 * running a tool — one entry per agent, tagged working/done. A finished orb
	 * lingers briefly (absorb animation) then leaves; a tombstone keeps the
	 * still-lingering feed row from re-adding it.
	 */
	CompanionEngine.prototype._buildAgents = function (now) {
		for (const [n, ts] of this.pendingSpawns) {
			if (now - ts > PENDING_TTL_MS) this.pendingSpawns.delete(n);
		}
		for (const [n, ts] of this.workingUntil) {
			if (ts < now) this.workingUntil.delete(n);
		}
		const byName = new Map();
		for (const a of this.agents) byName.set(a.name, a);

		const names = [];
		const seen = new Set();
		const push = (n) => {
			if (n && !seen.has(n)) {
				seen.add(n);
				names.push(n);
			}
		};
		for (const a of this.agents) push(a.name); // feed order ≈ spawn order
		for (const [n] of this.pendingSpawns) push(n);
		for (const [n, ts] of this.workingUntil) if (ts > now) push(n);

		const out = [];
		let gi = 0;
		for (const name of names) {
			const feed = byName.get(name);
			const working = (this.workingUntil.get(name) || 0) > now;
			let done = false;
			let ok = true;
			if (feed?.done) {
				done = true;
				ok = feed.ok;
			}
			if (done && !this.subDone.has(name)) this.subDone.set(name, { doneAt: now, ok });
			const rec = this.subDone.get(name);
			if (rec) {
				done = true;
				ok = rec.ok;
				if (now - rec.doneAt > DONE_LINGER_MS) continue; // absorbed → leave
			}
			out.push({
				id: feed ? feed.id : `pending-${name}`,
				name,
				gradIndex: gi++ % 3,
				working: working && !done,
				done,
				ok,
				status: done ? "done" : working ? "working" : "idle",
			});
		}
		// Drop tombstones the feed no longer reports, so a re-spawn can re-appear.
		for (const [n, rec] of this.subDone) {
			if (now - rec.doneAt > DONE_LINGER_MS && !byName.has(n)) {
				this.subDone.delete(n);
			}
		}
		return out;
	};

	/** Prune expired skills and return a render snapshot. */
	CompanionEngine.prototype.getState = function (now) {
		now = now || Date.now();
		for (const [k, v] of this.active) {
			if (v.untilTs < now) this.active.delete(k);
		}
		const agents = this._buildAgents(now);
		const snapshot = {
			// Busy = a foreground skill is lit (paw:tool relay) OR the ops feed
			// reports live work (cron/sub-agent/background) within the linger window.
			busy: this.active.size > 0 || now < this._feedBusyUntil,
			thinking: now < this.thinkingUntil,
			waiting: this.waiting,
			waitingLabel: this.waitingLabel,
			agentFailed: now < this.agentFailedUntil,
			lastActiveAt: this.lastActiveAt || now,
		};
		const expression = window.CompanionExpression
			? window.CompanionExpression.resolve(snapshot, this.machine, now)
			: snapshot.busy
				? "working"
				: "idle";
		return {
			skills: this.skills,
			active: this.active,
			agents,
			ops: this.ops,
			thinking: snapshot.thinking,
			busy: snapshot.busy,
			waiting: snapshot.waiting,
			agentFailed: snapshot.agentFailed,
			expression,
			unreadByKind: this.unreadByKind,
			mainPops: this.mainPops,
			now,
		};
	};

	window.CompanionEngine = CompanionEngine;
})();
