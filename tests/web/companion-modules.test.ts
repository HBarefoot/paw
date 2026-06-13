import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createSecurityHeaders } from "../../src/web/middleware/security-headers.js";
import { buildOpsFeed } from "../../src/web/routes/ops-feed.js";

const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");

// Load order matters: shell + engine read CompanionExpression / CompanionSpring
// off `window`, so those modules must be evaluated before them.
const MODULES = [
	"router.js",
	"topology.js",
	"expression.js",
	"spring.js",
	"engine.js",
	"shell.js",
];

/** A minimal DOM node for the shell's build/render path. */
// biome-ignore lint/suspicious/noExplicitAny: a permissive DOM stub is intentionally untyped
function makeNode(): any {
	const style: Record<string, unknown> = { setProperty() {} };
	const children: unknown[] = [];
	const node = {
		className: "",
		title: "",
		textContent: "",
		style,
		classList: { add() {}, remove() {}, contains: () => false },
		children,
		firstChild: null as unknown,
		lastChild: null as unknown,
		// biome-ignore lint/suspicious/noExplicitAny: stub
		appendChild(c: any) {
			children.push(c);
			node.firstChild = children[0];
			node.lastChild = c;
			return c;
		},
		setAttribute() {},
		removeAttribute() {},
		getAttribute: () => null,
		querySelector: () => makeNode(),
		querySelectorAll: () => [] as unknown[],
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 24 }),
		offsetWidth: 240,
		offsetHeight: 160,
		clientWidth: 480,
		clientHeight: 360,
		ownerDocument: { documentElement: { style: { setProperty() {} } } },
	};
	return node;
}

/** Run a module's source in an isolated scope sharing one fake `window`. */
function runModule(win: Record<string, unknown>, doc: unknown, src: string) {
	const fetchStub = () =>
		Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
	class ROStub {
		observe() {}
		disconnect() {}
	}
	// setTimeout: fire the 90ms tether-debounce synchronously (so paintTethers is
	// exercised) but never the 2000ms engine poll (avoid recursion).
	const setT = (fn: () => void, ms: number) => {
		if (ms === 90) fn();
		return 1;
	};
	const fn = new Function(
		"window",
		"document",
		"fetch",
		"setTimeout",
		"clearTimeout",
		"ResizeObserver",
		src,
	);
	fn(win, doc, fetchStub, setT, () => {}, ROStub);
}

function loadAll(win: Record<string, unknown>, doc: unknown) {
	for (const m of MODULES) runModule(win, doc, read(m));
}

describe("companion static modules", () => {
	test("each module parses (no SyntaxError)", () => {
		for (const m of MODULES) {
			expect(() => new Function(read(m))).not.toThrow();
		}
	});

	test("router.orthPath: near-aligned pairs collapse to a straight line", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			orthPath: (a: number, b: number, c: number, d: number) => string | null;
		};
		const d = R.orthPath(0, 50, 100, 52); // |dy|=2 < 8 → straight
		expect(d).toBe("M 0 50 L 100 52");
		expect(d).not.toContain("Q");
	});

	test("router.orthPath: horizontal-dominant has a rounded mid bend", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			orthPath: (a: number, b: number, c: number, d: number) => string;
		};
		const d = R.orthPath(0, 0, 100, 40); // |dx|≥|dy|, |dy|≥8 → H-V-H w/ Q elbows
		expect(d).toContain("Q");
		expect(d).toContain("50"); // midX
	});

	test("router.orthPath: vertical-dominant routes V-H-V", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			orthPath: (a: number, b: number, c: number, d: number) => string;
		};
		const d = R.orthPath(0, 0, 30, 200); // |dy|>|dx|, |dx|≥8 → V-H-V
		expect(d).toContain("Q");
		expect(d).toContain("100"); // midY
	});

	test("router.anchor: exits the pill edge toward the target on the dominant axis", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			anchor: (
				s: { cx: number; cy: number; w: number; h: number },
				t: { cx: number; cy: number; rad: number },
				p?: number,
				tp?: number,
			) => { sx: number; sy: number; ex: number; ey: number };
		};
		// pill at x=0 to avatar far right → exit right edge, land left edge
		const a = R.anchor(
			{ cx: 0, cy: 100, w: 80, h: 24 },
			{ cx: 400, cy: 100, rad: 89 },
		);
		expect(a.sx).toBe(45); // 0 + 80/2 + 5
		expect(a.ex).toBe(301); // 400 - (89 + 10)
		expect(a.sy).toBe(100);
	});

	test("topology: beam routes to the acting sub-agent, else the avatar", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("topology.js"));
		const T = win.CompanionTopology as {
			beamTarget: (
				op: { agentName?: string | null },
				agents: Array<{ id: string; name: string }>,
			) => { kind: string; id?: string };
		};
		const agents = [{ id: "a1", name: "Scout" }];
		expect(T.beamTarget({ agentName: "Scout" }, agents)).toEqual({
			kind: "agent",
			id: "a1",
		});
		expect(T.beamTarget({ agentName: null }, agents)).toEqual({
			kind: "avatar",
		});
		expect(T.beamTarget({ agentName: "Ghost" }, agents)).toEqual({
			kind: "avatar",
		});
	});

	test("engine: tool_start lights a skill with its actor; done resets", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("engine.js"));
		const Engine = win.CompanionEngine as new () => {
			agents: Array<{ id: string; name: string }>;
			start: (cfg: unknown) => void;
			ingestTool: (m: unknown, now?: number) => void;
			getState: (now?: number) => {
				active: Map<string, { actor: string | null }>;
				agents: Array<{ name: string; working: boolean }>;
				ops: unknown[];
			};
		};
		const e = new Engine();
		e.agents = [{ id: "a1", name: "Scout" }];
		const t0 = 1000;
		e.ingestTool(
			{
				type: "paw:tool",
				phase: "start",
				skillKey: "slack",
				toolName: "slack_send",
				agentName: "Scout",
			},
			t0,
		);
		const st = e.getState(t0 + 10);
		expect(st.active.get("slack")?.actor).toBe("Scout");
		expect(st.ops.length).toBe(1);
		expect(st.agents.find((a) => a.name === "Scout")?.working).toBe(true);

		e.ingestTool({ type: "paw:tool", phase: "done" }, t0 + 20);
		expect(e.getState(t0 + 30).active.size).toBe(0);
	});

	// ── Reactivity core (PR A): the pure expression state machine ──
	type Expr = {
		PRIORITY: string[];
		GUARD: Record<string, number>;
		freshMachine: () => Record<string, number>;
		note: (
			m: Record<string, number>,
			e: { type: string; state?: string; severity?: number },
			now: number,
		) => Record<string, number>;
		resolve: (
			s: Record<string, unknown>,
			m: Record<string, number>,
			now: number,
		) => string;
		shouldPop: (a: string, b: string) => boolean;
	};
	function loadExpression(): Expr {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("expression.js"));
		return win.CompanionExpression as Expr;
	}

	test("expression: each state resolves from its real signal, priority-ordered", () => {
		const X = loadExpression();
		const m = X.freshMachine();
		const now = 1000;
		expect(X.resolve({ lastActiveAt: now }, m, now)).toBe("idle");
		expect(
			X.resolve({ lastActiveAt: now - X.GUARD.sleepyAfterMs - 1 }, m, now),
		).toBe("sleepy");
		expect(X.resolve({ thinking: true, lastActiveAt: now }, m, now)).toBe(
			"thinking",
		);
		// working outranks thinking; waiting outranks working; worried outranks waiting
		expect(
			X.resolve({ thinking: true, busy: true, lastActiveAt: now }, m, now),
		).toBe("working");
		expect(
			X.resolve({ busy: true, waiting: true, lastActiveAt: now }, m, now),
		).toBe("waiting");
		expect(
			X.resolve(
				{ waiting: true, agentFailed: true, lastActiveAt: now },
				m,
				now,
			),
		).toBe("worried");
	});

	test("expression: listening note holds then decays; blur clears it", () => {
		const X = loadExpression();
		const m = X.freshMachine();
		X.note(m, { type: "input", state: "typing" }, 1000);
		expect(X.resolve({ lastActiveAt: 1000 }, m, 1000)).toBe("listening");
		expect(
			X.resolve({ lastActiveAt: 1000 }, m, 1000 + X.GUARD.listenHoldMs + 1),
		).toBe("idle");
		X.note(m, { type: "input", state: "blur" }, 1000);
		expect(X.resolve({ lastActiveAt: 1000 }, m, 1000)).toBe("idle");
	});

	test("expression guardrail: sub-threshold errors never reach the face; recovery cancels a wince", () => {
		const X = loadExpression();
		const m = X.freshMachine();
		X.note(m, { type: "error", severity: 1 }, 1000); // below GUARD.severityMin
		expect(X.resolve({ lastActiveAt: 1000 }, m, 1000)).toBe("idle");
		X.note(m, { type: "error", severity: 2 }, 1000);
		expect(X.resolve({ lastActiveAt: 1000 }, m, 1000)).toBe("wince");
		X.note(m, { type: "recovered" }, 1000); // a later success cancels it
		expect(X.resolve({ lastActiveAt: 1000 }, m, 1000)).toBe("idle");
	});

	test("expression guardrail: success holds briefly, working outranks it (no mid-turn flicker)", () => {
		const X = loadExpression();
		const m = X.freshMachine();
		X.note(m, { type: "success" }, 1000);
		expect(X.resolve({ lastActiveAt: 1000 }, m, 1000)).toBe("success");
		expect(X.resolve({ busy: true, lastActiveAt: 1000 }, m, 1000)).toBe(
			"working",
		);
		expect(
			X.resolve({ lastActiveAt: 1000 }, m, 1000 + X.GUARD.successHoldMs + 1),
		).toBe("idle");
	});

	test("expression.shouldPop: pops on entry into a busy face, coalesces a burst", () => {
		const X = loadExpression();
		expect(X.shouldPop("idle", "working")).toBe(true);
		expect(X.shouldPop("idle", "thinking")).toBe(true);
		expect(X.shouldPop("thinking", "working")).toBe(false); // already busy → no re-pop
		expect(X.shouldPop("working", "working")).toBe(false); // burst coalesces
		expect(X.shouldPop("working", "idle")).toBe(false);
	});

	// ── Micro-physics (PR A): the spring ──
	test("spring: under-damped step overshoots then settles on the target", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("spring.js"));
		const S = win.CompanionSpring as {
			make: (v: number) => { value: number; velocity: number };
			step: (
				s: { value: number; velocity: number },
				t: number,
				dt: number,
				cfg?: { reduced?: boolean },
			) => { value: number; velocity: number };
		};
		const s = S.make(0);
		let peak = 0;
		for (let i = 0; i < 240; i++) {
			S.step(s, 1, 1 / 60);
			peak = Math.max(peak, s.value);
		}
		expect(peak).toBeGreaterThan(1); // overshoot
		expect(Math.abs(s.value - 1)).toBeLessThan(0.01); // settled

		const r = S.make(0);
		S.step(r, 1, 1 / 60, { reduced: true });
		expect(r.value).toBe(1); // reduced-motion snaps instantly
		expect(r.velocity).toBe(0);
	});

	// ── Gaze + dynamic caption (PR A) — pure helpers exported on Companion ──
	function loadShellEnv(): Record<string, unknown> {
		const win: Record<string, unknown> = {};
		for (const m of MODULES) runModule(win, {}, read(m));
		return win;
	}

	test("gaze: targets active pill > acting sub-agent > input > center", () => {
		const C = loadShellEnv().Companion as {
			gazeTarget: (st: unknown, expr: string) => { kind: string; key?: string; idx?: number };
		};
		expect(
			C.gazeTarget({ active: new Map([["slack", {}]]), agents: [] }, "working"),
		).toEqual({ kind: "pill", key: "slack" });
		expect(
			C.gazeTarget({ active: new Map(), agents: [{ working: true }] }, "working"),
		).toEqual({ kind: "sub", idx: 0 });
		expect(C.gazeTarget({ active: new Map(), agents: [] }, "listening")).toEqual({
			kind: "input",
		});
		expect(C.gazeTarget({ active: new Map(), agents: [] }, "idle")).toEqual({
			kind: "center",
		});
	});

	test("captionFor: live action line, default greeting when idle", () => {
		const C = loadShellEnv().Companion as {
			captionFor: (st: unknown, expr: string) => string;
		};
		const st = {
			active: new Map([["slack", { actor: null }]]),
			skills: [{ key: "slack", label: "Slack" }],
			ops: [],
		};
		expect(C.captionFor(st, "working")).toContain("Slack");
		expect(C.captionFor(st, "thinking")).toBe("Thinking…");
		expect(
			C.captionFor({ active: new Map(), skills: [], ops: [] }, "idle"),
		).toContain("Ask me to build");
	});

	test("engine: feed pendingApprovals → waiting; a failed sub-agent → worried", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("expression.js"));
		runModule(win, {}, read("engine.js"));
		const Engine = win.CompanionEngine as new () => {
			_ingestFeed: (data: unknown, now?: number) => void;
			getState: (now?: number) => { expression: string };
		};
		const now = 5000;
		const e1 = new Engine();
		e1._ingestFeed({ pendingApprovals: 2, agents: [] }, now);
		expect(e1.getState(now).expression).toBe("waiting");
		const e2 = new Engine();
		e2._ingestFeed(
			{ pendingApprovals: 0, agents: [{ id: "a1", name: "Scout", done: true, ok: false }] },
			now,
		);
		expect(e2.getState(now).expression).toBe("worried");
	});

	// ── Sub-agent fidelity (PR B) ──
	type AgentEngine = new () => {
		ingestTool: (m: unknown, now?: number) => void;
		_ingestFeed: (data: unknown, now?: number) => void;
		getState: (now?: number) => {
			agents: Array<{ name: string; working: boolean; done: boolean; ok: boolean; status: string }>;
		};
	};
	function loadAgentEngine(): AgentEngine {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("expression.js"));
		runModule(win, {}, read("engine.js"));
		return win.CompanionEngine as AgentEngine;
	}

	test("agent fidelity: an orb is WORKING when it runs a tool with NO skillKey (the reported bug)", () => {
		const Engine = loadAgentEngine();
		const e = new Engine();
		const t0 = 1000;
		// estimate_revenue-style tool: attributed to agent-3 but maps to no skill.
		e.ingestTool(
			{ type: "paw:tool", phase: "start", agentName: "agent-3", toolName: "estimate_revenue" },
			t0,
		);
		const a = e.getState(t0 + 10).agents.find((x) => x.name === "agent-3");
		expect(a?.working).toBe(true);
	});

	test("agent fidelity: one orb per spawned agent; many tools from one agent stay one orb", () => {
		const Engine = loadAgentEngine();
		const e = new Engine();
		const t0 = 1000;
		for (const n of ["agent-1", "agent-2", "agent-3"]) {
			e.ingestTool(
				{ type: "paw:tool", phase: "start", toolName: "spawn_agent", summary: `Spawning agent: ${n}` },
				t0,
			);
		}
		// agent-3 fires many of its own tools — must NOT create extra orbs.
		for (let i = 0; i < 6; i++) {
			e.ingestTool(
				{ type: "paw:tool", phase: "start", agentName: "agent-3", toolName: "estimate_revenue" },
				t0 + i,
			);
		}
		const names = e.getState(t0 + 20).agents.map((x) => x.name).sort();
		expect(names).toEqual(["agent-1", "agent-2", "agent-3"]);
	});

	test("agent fidelity: a spawn relay shows the orb instantly; the feed doesn't duplicate it", () => {
		const Engine = loadAgentEngine();
		const e = new Engine();
		const t0 = 1000;
		e.ingestTool(
			{ type: "paw:tool", phase: "start", toolName: "spawn_agent", summary: "Spawning agent: Scout" },
			t0,
		);
		expect(e.getState(t0 + 5).agents.map((x) => x.name)).toEqual(["Scout"]);
		// feed confirms the same agent (full session id) — still ONE orb.
		e._ingestFeed(
			{ agents: [{ id: "agent-Scout-1", name: "Scout", done: false, ok: true }] },
			t0 + 10,
		);
		expect(e.getState(t0 + 15).agents.filter((x) => x.name === "Scout").length).toBe(1);
	});

	test("agent fidelity: completion → done, absorbs, then leaves; failure flags ok=false", () => {
		const Engine = loadAgentEngine();
		const ok = new Engine();
		const t0 = 1000;
		ok._ingestFeed({ agents: [{ id: "a1", name: "Scout", done: true, ok: true }] }, t0);
		expect(ok.getState(t0).agents.find((x) => x.name === "Scout")?.status).toBe("done");
		// after the display-linger the orb is gone.
		expect(ok.getState(t0 + 4000).agents.find((x) => x.name === "Scout")).toBeUndefined();

		const bad = new Engine();
		bad._ingestFeed({ agents: [{ id: "a2", name: "Builder", done: true, ok: false }] }, t0);
		const f = bad.getState(t0).agents.find((x) => x.name === "Builder");
		expect(f?.status).toBe("done");
		expect(f?.ok).toBe(false);
	});

	test("swarm cap: > 8 agents collapse the tail into one overflow slot", () => {
		const win: Record<string, unknown> = {};
		for (const m of MODULES) runModule(win, {}, read(m));
		const C = win.Companion as {
			visibleAgents: (
				all: unknown[],
				cap: number,
			) => { visible: unknown[]; overflow: number };
		};
		const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `a${i}` }));
		expect(C.visibleAgents(mk(3), 8)).toMatchObject({ overflow: 0 });
		expect(C.visibleAgents(mk(8), 8).visible.length).toBe(8);
		const big = C.visibleAgents(mk(12), 8);
		expect(big.visible.length).toBe(7); // 7 real + 1 "+N" = 8 slots
		expect(big.overflow).toBe(5);
	});

	test("engine: ambient unreadByKind is exposed for skill-pill badges", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("expression.js"));
		runModule(win, {}, read("engine.js"));
		const Engine = win.CompanionEngine as new () => {
			setNotifications: (byKind: unknown) => void;
			getState: (now?: number) => { unreadByKind: Record<string, number> };
		};
		const e = new Engine();
		e.setNotifications({ github: 3, slack: 1 });
		expect(e.getState(1000).unreadByKind).toEqual({ github: 3, slack: 1 });
		// a malformed payload resets to an empty map (no badge)
		e.setNotifications(null);
		expect(e.getState(1000).unreadByKind).toEqual({});
	});

	test("ops-feed: response carries pendingApprovals (default 0)", () => {
		const base = {
			toolLog: null,
			inFlight: [],
			nodes: [],
			rowKey: () => null,
			agents: [],
			model: "m",
			now: 1000,
		};
		expect(buildOpsFeed(base, 0).pendingApprovals).toBe(0);
		expect(buildOpsFeed({ ...base, pendingApprovals: 3 }, 0).pendingApprovals).toBe(
			3,
		);
	});

	test("/companion is framable (SAMEORIGIN, not the default DENY)", async () => {
		const mw = createSecurityHeaders(false, {});
		const headers: Record<string, string> = {};
		const c = {
			req: { path: "/companion" },
			header: (k: string, v: string) => {
				headers[k] = v;
			},
		};
		await mw(c as never, (async () => {}) as never);
		expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
		const csp = headers["Content-Security-Policy"];
		expect(csp).toContain("frame-ancestors 'self'");
		expect(csp).toContain("connect-src 'self'");
		// Cloudflare's auto-injected analytics beacon must be allowed (matches the
		// default app CSP) so it doesn't throw a CSP error on the framed companion.
		expect(csp).toContain("https://static.cloudflareinsights.com");
		expect(csp).toContain("https://cloudflareinsights.com");
	});

	test("chat: only listed/persisted sessions hit the DB history fetch (no 404)", () => {
		const src = readFileSync(
			new URL("../../src/web/views/chat.tsx", import.meta.url),
			"utf8",
		);
		// The guard must sit in loadMessagesForSession, before the fetch: a
		// client-only `canvas-<uuid>` id that isn't in the (persisted-only)
		// dropdown is skipped, so it never hits /api/sessions/<id>/messages.
		// Persisted canvas sessions ARE in the dropdown and DO load.
		const fn = src.slice(src.indexOf("function loadMessagesForSession"));
		const body = fn.slice(0, fn.indexOf('fetch("/api/sessions/'));
		expect(body).toContain("if (!sessionIsListed(sid)) return;");
		// The old blanket prefix block is gone (it hid persisted canvas history).
		expect(body).not.toContain('indexOf("canvas-") === 0');
	});

	test("the /companion inline bootstrap cooks and parses (template-trap guard)", () => {
		const src = readFileSync(
			new URL("../../src/web/app.ts", import.meta.url),
			"utf8",
		);
		const marker = "window.Companion.mount";
		expect(src).toContain(marker);
		const open = src.lastIndexOf("<script>", src.indexOf(marker));
		const start = open + "<script>".length;
		const end = src.indexOf("</script>", start);
		const inner = src.slice(start, end).replace(/\$\{[^}]*\}/g, "null");
		expect(() => new Function(inner)).not.toThrow();
	});

	test("shell: mount builds the DOM home + paints tethers without throwing", () => {
		const handlers: Record<string, (e: unknown) => void> = {};
		const win: Record<string, unknown> = {
			requestAnimationFrame: () => 1, // one frame, no recursion
			cancelAnimationFrame: () => {},
			addEventListener: (t: string, fn: (e: unknown) => void) => {
				handlers[t] = fn;
			},
		};
		const doc = {
			createElement: () => makeNode(),
			createElementNS: () => makeNode(),
		};
		loadAll(win, doc);
		const root = makeNode();
		const C = win.Companion as {
			mount: (root: unknown, cfg: unknown) => { stop: () => void };
		};
		expect(typeof C.mount).toBe("function");
		// A full skill set so the wrap dock builds many pills.
		const skills = Array.from({ length: 18 }, (_, i) => ({
			key: `s${i}`,
			label: `Skill ${i}`,
		}));
		const inst = C.mount(root, {
			accent: "#2ee6a8",
			brandName: "Barefoot Digital",
			tools: 105,
			operations: 528,
			skills,
		});
		// deliver a live tool event through the captured handler
		expect(() =>
			handlers.message?.({
				data: {
					type: "paw:tool",
					phase: "start",
					skillKey: "s3",
					agentName: null,
				},
			}),
		).not.toThrow();
		expect(typeof inst.stop).toBe("function");
		inst.stop();
	});
});
