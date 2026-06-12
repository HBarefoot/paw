import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../src/web/public/companion/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");

const MODULES = [
	"router.js",
	"dock.js",
	"topology.js",
	"engine.js",
	"shell.js",
];

// A permissive 2D-context stub (any method no-ops; gradient returns a stub).
function makeCtx2d() {
	const grad = { addColorStop() {} };
	return new Proxy(
		{},
		{
			get(t: Record<string, unknown>, p: string) {
				if (p in t) return t[p];
				if (p === "measureText") return () => ({ width: 10 });
				return () => grad;
			},
			set(t: Record<string, unknown>, p: string, v: unknown) {
				t[p] = v;
				return true;
			},
		},
	);
}

/** Run a module's source in an isolated scope sharing one fake `window`. */
function runModule(win: Record<string, unknown>, doc: unknown, src: string) {
	const fetchStub = () =>
		Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
	class ROStub {
		observe() {}
		disconnect() {}
	}
	const fn = new Function(
		"window",
		"document",
		"fetch",
		"setTimeout",
		"clearTimeout",
		"ResizeObserver",
		src,
	);
	fn(
		win,
		doc,
		fetchStub,
		() => 0,
		() => {},
		ROStub,
	);
}

function loadAll(win: Record<string, unknown>, doc: unknown = {}) {
	for (const m of MODULES) runModule(win, doc, read(m));
}

describe("companion static modules", () => {
	test("each module parses (no SyntaxError / template-trap)", () => {
		for (const m of MODULES) {
			expect(() => new Function(read(m))).not.toThrow();
		}
	});

	test("router: collapses near-aligned to a straight line", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			route: (a: unknown, b: unknown) => Array<{ x: number; y: number }>;
		};
		// Same y (aligned) → 2-point straight line, no elbow.
		const pts = R.route({ x: 0, y: 50 }, { x: 100, y: 52 });
		expect(pts.length).toBe(2);
	});

	test("router: horizontal-dominant routes H→V→H with a mid bend", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			route: (a: unknown, b: unknown) => Array<{ x: number; y: number }>;
		};
		const pts = R.route({ x: 0, y: 0 }, { x: 100, y: 40 });
		expect(pts.length).toBe(4);
		// the two middle points share the mid x (a vertical run between them)
		expect(pts[1].x).toBe(pts[2].x);
		expect(pts[1].x).toBe(50);
	});

	test("router: vertical-dominant routes V→H→V", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		const R = win.CompanionRouter as {
			route: (a: unknown, b: unknown) => Array<{ x: number; y: number }>;
		};
		const pts = R.route({ x: 0, y: 0 }, { x: 30, y: 200 });
		expect(pts.length).toBe(4);
		expect(pts[1].y).toBe(pts[2].y); // shared mid y (a horizontal run)
		expect(pts[1].y).toBe(100);
	});

	test("dock: >16 skills caps the column and builds the overflow chip", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("dock.js"));
		const Dock = win.CompanionDock as {
			computeColumn: (
				skills: Array<{ key: string; label: string }>,
				opts: { max: number; activeHiddenKey?: string | null },
			) => {
				visible: unknown[];
				overflow: null | { count: number; label: string; hot: boolean };
			};
		};
		const skills = Array.from({ length: 100 }, (_, i) => ({
			key: i === 90 ? "webhooks" : `s${i}`,
			label: i === 90 ? "webhooks" : `Skill ${i}`,
		}));
		const plain = Dock.computeColumn(skills, { max: 16 });
		expect(plain.visible.length).toBe(16);
		expect(plain.overflow?.count).toBe(84);
		expect(plain.overflow?.label).toBe("+84");
		expect(plain.overflow?.hot).toBe(false);

		// A hidden skill firing lights the chip and surfaces its label.
		const hot = Dock.computeColumn(skills, {
			max: 16,
			activeHiddenKey: "webhooks",
		});
		expect(hot.overflow?.hot).toBe(true);
		expect(hot.overflow?.label).toBe("+84 · webhooks");
	});

	test("dock: ≤16 skills → no overflow chip", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("dock.js"));
		const Dock = win.CompanionDock as {
			computeColumn: (
				s: unknown[],
				o: { max: number },
			) => { overflow: unknown };
		};
		const out = Dock.computeColumn([{ key: "a", label: "A" }], { max: 16 });
		expect(out.overflow).toBeNull();
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
		// unknown agent → falls back to the orchestrator (avatar)
		expect(T.beamTarget({ agentName: "Ghost" }, agents)).toEqual({
			kind: "avatar",
		});
	});

	test("engine: a tool_start lights the skill + opens a beam to its agent", () => {
		const win: Record<string, unknown> = {};
		runModule(win, {}, read("router.js"));
		runModule(win, {}, read("topology.js"));
		runModule(win, {}, read("engine.js"));
		const Engine = win.CompanionEngine as new () => {
			agents: Array<{ id: string; name: string }>;
			ingestTool: (m: unknown, now?: number) => void;
			getState: (now?: number) => {
				active: Map<string, number>;
				beams: Array<{ target: { kind: string; id?: string } }>;
				feed: unknown[];
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
		expect(st.active.has("slack")).toBe(true);
		expect(st.beams.length).toBe(1);
		expect(st.beams[0].target).toEqual({ kind: "agent", id: "a1" });
		expect(st.feed.length).toBe(1);

		// `done` resets everything.
		e.ingestTool({ type: "paw:tool", phase: "done" }, t0 + 20);
		const after = e.getState(t0 + 30);
		expect(after.active.size).toBe(0);
		expect(after.beams.length).toBe(0);
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

	test("shell: mount() runs a frame without throwing (runtime guard)", () => {
		const handlers: Record<string, (e: unknown) => void> = {};
		const win: Record<string, unknown> = {
			devicePixelRatio: 1,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			addEventListener: (t: string, fn: (e: unknown) => void) => {
				handlers[t] = fn;
			},
		};
		const canvas = {
			width: 0,
			height: 0,
			style: {} as Record<string, string>,
			getContext: () => makeCtx2d(),
		};
		const root = {
			appendChild() {},
			getBoundingClientRect: () => ({ width: 480, height: 360 }),
		};
		const doc = { createElement: () => canvas };
		loadAll(win, doc);
		const C = win.Companion as {
			mount: (root: unknown, cfg: unknown) => { stop: () => void };
		};
		expect(typeof C.mount).toBe("function");
		const inst = C.mount(root, { accent: "#7458f5", model: "m" });
		// deliver a live tool event through the captured message handler
		expect(() =>
			handlers.message?.({
				data: { type: "paw:tool", phase: "start", skillKey: "memory" },
			}),
		).not.toThrow();
		inst.stop();
	});
});
