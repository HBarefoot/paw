import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createSecurityHeaders } from "../../src/web/middleware/security-headers.js";

const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");

const MODULES = ["router.js", "topology.js", "engine.js", "shell.js"];

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
		expect(headers["Content-Security-Policy"]).toContain(
			"frame-ancestors 'self'",
		);
		expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
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
