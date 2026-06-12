/**
 * CompanionExpression — the avatar's pure expression state machine.
 *
 * No DOM, no timers, no I/O: every function is `(state, …) -> value` so the face
 * is exhaustively unit-testable. The renderer (shell.js) owns a `machine` of
 * transient holds, feeds it real signals via `note()`, and each frame asks
 * `resolve(snapshot, machine, now)` which expression to wear. Sustained facts
 * (busy/thinking/waiting/agentFailed/idle) come from the engine snapshot; brief
 * reactions (listening/success/wince) are time-held in the machine so the face
 * can't twitch.
 *
 * Every state is driven by a REAL signal — there is no simulated emoting:
 *   sleepy    idle longer than GUARD.sleepyAfterMs
 *   idle      resting (default)
 *   listening chat input focused / typing (relayed from the chat page)
 *   thinking  reasoning between tools (engine `thinking` flag) — drives the dots
 *   working   one+ tools running (a burst coalesces to ONE working, no re-pop)
 *   success   a tool/turn just finished ok (held briefly, then decays)
 *   waiting   a GitHub action is pending human approval
 *   worried   a sub-agent failed
 *   wince     a tool errored at/above the severity threshold (and wasn't
 *             auto-recovered by a later success)
 */
(() => {
	// Ascending priority — the LAST matching state wins when several are live.
	// working outranks thinking/success so a turn never flickers "success" while
	// more tools run; waiting (blocked on a human) outranks working; failures top.
	const PRIORITY = [
		"sleepy",
		"idle",
		"listening",
		"success",
		"thinking",
		"working",
		"waiting",
		"worried",
		"wince",
	];

	const GUARD = {
		sleepyAfterMs: 120000, // 2 min of no activity → sleepy
		listenHoldMs: 2600, // typing keeps "listening" alive this long after a keypress
		successHoldMs: 1200, // min time a success smile is shown
		winceHoldMs: 1600, // min time a wince is shown
		worriedHoldMs: 2600, // a sub-agent failure latches "worried" this long
		severityMin: 2, // tool errors below this never reach the face (transient)
	};

	function freshMachine() {
		return { listenUntil: 0, successUntil: 0, winceUntil: 0 };
	}

	/**
	 * Fold a transient real signal into the machine. Returns the same machine.
	 *  - {type:"input", state:"typing"|"focus"} / "blur"|"idle"
	 *  - {type:"success"}                      a tool/turn ended ok
	 *  - {type:"error", severity:number}       a tool errored (sub-threshold = ignored)
	 *  - {type:"recovered"}                    a later success cancels a pending wince
	 */
	function note(machine, event, now) {
		if (!event) return machine;
		switch (event.type) {
			case "input":
				machine.listenUntil =
					event.state === "blur" || event.state === "idle"
						? 0
						: now + GUARD.listenHoldMs;
				break;
			case "success":
				machine.successUntil = now + GUARD.successHoldMs;
				break;
			case "error":
				if ((event.severity || 0) >= GUARD.severityMin) {
					machine.winceUntil = now + GUARD.winceHoldMs;
				}
				break;
			case "recovered":
				machine.winceUntil = 0; // a subsequent success cancels the wince
				break;
		}
		return machine;
	}

	/**
	 * Resolve the worn expression from sustained facts + transient holds.
	 * @param {{busy?:boolean, thinking?:boolean, waiting?:boolean,
	 *          agentFailed?:boolean, lastActiveAt?:number}} snapshot
	 * @param {{listenUntil:number,successUntil:number,winceUntil:number}} machine
	 * @param {number} now
	 * @returns {string} one of PRIORITY
	 */
	function resolve(snapshot, machine, now) {
		snapshot = snapshot || {};
		machine = machine || freshMachine();
		const live = [];
		const idleMs = now - (snapshot.lastActiveAt || now);
		live.push(idleMs > GUARD.sleepyAfterMs ? "sleepy" : "idle");
		if (machine.listenUntil > now) live.push("listening");
		if (machine.successUntil > now) live.push("success");
		if (snapshot.thinking) live.push("thinking");
		if (snapshot.busy) live.push("working");
		if (snapshot.waiting) live.push("waiting");
		if (snapshot.agentFailed) live.push("worried");
		if (machine.winceUntil > now) live.push("wince");
		let best = "idle";
		let rank = -1;
		for (const s of live) {
			const r = PRIORITY.indexOf(s);
			if (r > rank) {
				rank = r;
				best = s;
			}
		}
		return best;
	}

	/** A squash/stretch pop should fire only on the entry into a "busy" face. */
	function shouldPop(prev, next) {
		const busyFace = (s) => s === "working" || s === "thinking";
		return busyFace(next) && !busyFace(prev);
	}

	window.CompanionExpression = {
		PRIORITY,
		GUARD,
		freshMachine,
		note,
		resolve,
		shouldPop,
	};
})();
