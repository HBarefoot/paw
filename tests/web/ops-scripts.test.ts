import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OpsPage } from "../../src/web/views/ops-page.js";

const ROOT = new URL("../../src/web/public/ops/", import.meta.url);
function read(file: string): string {
	return readFileSync(new URL(file, ROOT), "utf8");
}

const MODULES = [
	"ui.js",
	"engine.js",
	"viz-stream.js",
	"viz-swarm.js",
	"shell.js",
];

// A 2D-context stub: any method is a no-op returning a gradient stub; property
// assignments are accepted. Enough to drive a lens frame without a real canvas.
function makeCtx2d() {
	const grad = { addColorStop() {} };
	return new Proxy(
		{},
		{
			get(target: Record<string, unknown>, prop: string) {
				if (prop in target) return target[prop];
				return () => grad;
			},
			set(target: Record<string, unknown>, prop: string, val: unknown) {
				target[prop] = val;
				return true;
			},
		},
	);
}

function makeCanvas() {
	return {
		width: 800,
		height: 600,
		style: {} as Record<string, string>,
		getContext: () => makeCtx2d(),
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
		addEventListener() {},
	};
}

/** Run a module's source in an isolated scope sharing one fake `window`. */
function runModule(win: Record<string, unknown>, doc: unknown, src: string) {
	const raf = () => 1;
	const perf = { now: () => 0 };
	const fetchStub = () =>
		Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
	class ROStub {
		observe() {}
		disconnect() {}
	}
	const fn = new Function(
		"window",
		"document",
		"performance",
		"requestAnimationFrame",
		"fetch",
		"ResizeObserver",
		src,
	);
	fn(win, doc, perf, raf, fetchStub, ROStub);
}

describe("ops static modules", () => {
	test("each module parses (no SyntaxError)", () => {
		for (const m of MODULES) {
			expect(() => new Function(read(m))).not.toThrow();
		}
	});

	test("ui.js loads and exposes a working kit", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(
			win,
			{ createElement: () => ({}), body: { appendChild() {} } },
			read("ui.js"),
		);
		const ui = win.OpsUI as {
			fmtMs: (n: number) => string;
			statusColor: (s: string) => string;
			MODE_GLYPHS: Record<string, string>;
		};
		expect(typeof ui.fmtMs).toBe("function");
		expect(ui.fmtMs(1500)).toBe("1.50s");
		expect(ui.fmtMs(250)).toBe("250ms");
		expect(ui.statusColor("error")).toBe("#e5604d");
		expect(ui.statusColor("running")).toBe("#45c8d8");
		expect(typeof ui.MODE_GLYPHS.swarm).toBe("string");
		expect(ui.MODE_GLYPHS.stream).toContain("<svg");
	});

	test("engine.js loads and exposes the AgentOps contract", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(win, {}, read("engine.js"));
		const eng = win.AgentOps as Record<string, unknown>;
		for (const k of ["TOOLS", "ops", "simNow", "running", "speed"]) {
			expect(k in eng).toBe(true);
		}
		for (const fn of [
			"on",
			"windowStats",
			"totals",
			"recent",
			"opsInWindow",
			"setRunning",
			"setSpeed",
			"start",
		]) {
			expect(typeof eng[fn]).toBe("function");
		}
		expect(typeof eng.simNow).toBe("number");
		// derived stats must not throw on an empty buffer
		const totals = eng.totals as () => { byTool: unknown[] };
		const recent = eng.recent as (n: number) => unknown[];
		expect(() => totals()).not.toThrow();
		expect(totals().byTool).toEqual([]);
		expect(recent(5)).toEqual([]);
	});

	test("viz-stream.js draws a frame without throwing (runtime guard)", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(win, {}, read("ui.js"));
		runModule(win, {}, read("viz-stream.js"));
		const VizStream = win.VizStream as (ctx: unknown) => { frame: () => void };
		expect(typeof VizStream).toBe("function");

		const engine = {
			TOOLS: [
				{ id: "core", label: "Core", color: "#3fe08f" },
				{ id: "files", label: "Files", color: "#7ee06a" },
			],
			TOOL_BY_ID: { core: { color: "#3fe08f" }, files: { color: "#7ee06a" } },
			simNow: 100000,
			ops: [
				{
					id: 1,
					toolId: "files",
					op: "file_read",
					status: "ok",
					startedAt: 99000,
					endAt: 99200,
					duration: 200,
				},
				{
					id: 2,
					toolId: "core",
					op: "plan",
					status: "running",
					startedAt: 99500,
					endAt: 100000,
					duration: 500,
				},
			],
		};
		const ctx = {
			canvas: makeCanvas(),
			size: { w: 800, h: 600, dpr: 1 },
			engine,
			ui: win.OpsUI,
			state: {
				enabled: new Set(["core", "files"]),
				viewTime: "live" as string | number,
				selectedId: -1,
			},
			actions: { toggleTool() {}, selectOp() {} },
		};
		const lens = VizStream(ctx);
		expect(() => lens.frame()).not.toThrow();
		// also exercise the review (scrubbed) path
		ctx.state.viewTime = 99800;
		expect(() => lens.frame()).not.toThrow();
	});

	test("viz-swarm.js draws a frame without throwing (runtime guard)", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(win, {}, read("ui.js"));
		runModule(win, {}, read("viz-swarm.js"));
		const VizSwarm = win.VizSwarm as (ctx: unknown) => { frame: () => void };
		expect(typeof VizSwarm).toBe("function");

		const engine = {
			TOOLS: [
				{ id: "core", label: "Core", color: "#3fe08f" },
				{ id: "files", label: "Files", color: "#7ee06a" },
			],
			TOOL_BY_ID: { core: { color: "#3fe08f" }, files: { color: "#7ee06a" } },
			simNow: 100000,
			model: "test-model",
			windowStats: () => ({
				tps: 1,
				active: 1,
				errorRate: 0,
				avgLatency: 10,
				avgDuration: 100,
				total: 3,
			}),
			ops: [
				{
					id: 1,
					toolId: "files",
					op: "file_read",
					status: "ok",
					startedAt: 99000,
					endAt: 99200,
					duration: 200,
					taskId: 42,
					taskLabel: "dig",
				},
				{
					id: 2,
					toolId: "core",
					op: "plan",
					status: "running",
					startedAt: 99600,
					endAt: 100000,
					duration: 500,
					taskId: 42,
					taskLabel: "dig",
				},
			],
		};
		const ctx = {
			canvas: makeCanvas(),
			size: { w: 900, h: 600, dpr: 1 },
			engine,
			ui: win.OpsUI,
			accent: "#3fe08f",
			state: {
				enabled: new Set(["core", "files"]),
				viewTime: "live" as string | number,
				selectedId: -1,
			},
			actions: { toggleTool() {}, selectOp() {} },
		};
		const lens = VizSwarm(ctx);
		expect(() => lens.frame()).not.toThrow();
		ctx.state.viewTime = 99800;
		expect(() => lens.frame()).not.toThrow();
	});

	test("viz-swarm orthWaypoints: companion-style orthogonal routing", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(win, {}, read("viz-swarm.js"));
		const route = (
			win.VizSwarm as {
				_route: (
					a: number,
					b: number,
					c: number,
					d: number,
				) => Array<{ x: number; y: number }>;
			}
		)._route;
		// near-aligned pair → straight (2 points)
		expect(route(0, 50, 100, 52)).toEqual([
			{ x: 0, y: 50 },
			{ x: 100, y: 52 },
		]);
		// horizontal-dominant → H-V-H corners at the mid-x
		const h = route(0, 0, 100, 40);
		expect(h).toHaveLength(4);
		expect(h[1]).toEqual({ x: 50, y: 0 });
		expect(h[2]).toEqual({ x: 50, y: 40 });
		// vertical-dominant → V-H-V corners at the mid-y
		const v = route(0, 0, 30, 200);
		expect(v).toHaveLength(4);
		expect(v[1]).toEqual({ x: 0, y: 100 });
		expect(v[2]).toEqual({ x: 30, y: 100 });
	});

	test("engine totals: OPS/SEC, IN FLIGHT, ERROR RATE wired from the feed", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(win, {}, read("engine.js"));
		const eng = win.AgentOps as {
			ingest: (d: unknown) => void;
			totals: () => { tps: number; active: number; errorRate: number };
		};
		eng.ingest({
			now: 100000,
			topology: [
				{ id: "files", label: "Files", color: "#7ee06a", kind: "tool" },
				{ id: "core", label: "Core", color: "#3fe08f", kind: "reason" },
			],
			ops: [
				{
					id: 1,
					toolId: "files",
					status: "ok",
					startedAt: 99000,
					endAt: 99200,
					duration: 200,
				},
				{
					id: 2,
					toolId: "files",
					status: "ok",
					startedAt: 99300,
					endAt: 99500,
					duration: 200,
				},
				{
					id: 3,
					toolId: "core",
					status: "error",
					startedAt: 99600,
					endAt: 99800,
					duration: 200,
				},
			],
			inflight: [
				{
					id: -1,
					toolId: "files",
					status: "running",
					startedAt: 99900,
					endAt: 100000,
					duration: 100,
				},
			],
		});
		const t = eng.totals();
		expect(t.active).toBe(1); // IN FLIGHT = inflight.length
		expect(t.tps).toBeGreaterThan(0); // OPS/SEC over the 3 completed ops
		expect(t.errorRate).toBeCloseTo(1 / 3, 5); // 1 error / 3 completed
	});

	test("shell.js loads and exposes a mount()", () => {
		const win: Record<string, unknown> = { devicePixelRatio: 1 };
		runModule(win, {}, read("shell.js"));
		const shell = win.OpsShell as { mount: unknown };
		expect(typeof shell.mount).toBe("function");
	});
});

// The #37-class guard: the ops page injects ONE inline <script> (the bootstrap)
// inside a .tsx template literal. Cook it (stub ${...}) and ensure it parses.
describe("ops-page inline bootstrap (template-trap guard)", () => {
	test("the injected bootstrap script cooks and parses", () => {
		const src = readFileSync(
			new URL("../../src/web/views/ops-page.tsx", import.meta.url),
			"utf8",
		);
		// The bootstrap is the raw(`<script>…</script>`) that calls OpsShell.mount.
		const marker = "window.OpsShell.mount";
		expect(src).toContain(marker);
		const open = src.lastIndexOf("raw(`<script>", src.indexOf(marker));
		const start = src.indexOf("<script>", open) + "<script>".length;
		const end = src.indexOf("</script>", start);
		const inner = src.slice(start, end).replace(/\$\{[^}]*\}/g, "null");
		expect(() => new Function(inner)).not.toThrow();
		expect(inner).toContain("ops-content");
	});
});

describe("OpsPage accent theming", () => {
	test("inlines a valid brand accent as --ops-green", () => {
		const html = String(OpsPage({ accent: "#0af", model: "m", uptimeMs: 0 }));
		expect(html).toContain("--ops-green:#0af");
		expect(html).toContain('id="ops-root"');
	});

	test("falls back to the design green for a missing/invalid accent", () => {
		expect(String(OpsPage({ accent: "", model: "m", uptimeMs: 0 }))).toContain(
			"--ops-green:#3fe08f",
		);
		// CSS-injection attempt is rejected → fallback (no raw payload in style)
		const evil = String(
			OpsPage({ accent: "red;}</style><script>", model: "m", uptimeMs: 0 }),
		);
		expect(evil).toContain("--ops-green:#3fe08f");
		expect(evil).not.toContain("</style><script>");
	});
});

describe("ops Live operations list stays scroll-capped (no layout overflow)", () => {
	const css = read("styles.css");

	test("the .feed list can shrink and scroll inside the rail", () => {
		// REGRESSION: the Live operations list grew to its full content height and
		// pushed the right rail past the viewport. The fix: .feed is a flex child
		// that must be allowed to shrink (min-height:0) so its own overflow-y:auto
		// scroll engages instead of the list expanding the (overflow:hidden) parent.
		const feed = css.match(/\.ops-app \.feed \{[^}]*\}/)?.[0] ?? "";
		expect(feed).toContain("min-height: 0");
		expect(feed).toContain("overflow-y: auto");
		expect(feed).toContain("flex: 1");
		// The parent that constrains it stays overflow:hidden (so the cap holds).
		const grow = css.match(/\.ops-app \.insp \.sec\.grow \{[^}]*\}/)?.[0] ?? "";
		expect(grow).toContain("min-height: 0");
		expect(grow).toContain("overflow: hidden");
	});
});
