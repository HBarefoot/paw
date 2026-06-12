import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../src/web/public/ops/", import.meta.url);
function read(file: string): string {
	return readFileSync(new URL(file, ROOT), "utf8");
}

const MODULES = ["ui.js", "engine.js", "viz-stream.js", "shell.js"];

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
