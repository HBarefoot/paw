import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OpsPage } from "../../src/web/views/ops-page.js";

const ROOT = new URL("../../src/web/public/ops/", import.meta.url);
function read(file: string): string {
	return readFileSync(new URL(file, ROOT), "utf8");
}

// The new dashboard module set (the old canvas lenses were removed).
const MODULES = ["ui.js", "charts.js", "engine.js", "dash.js"];

/* ── DOM + canvas stubs (no jsdom) ──────────────────────────────────────── */
// biome-ignore lint/suspicious/noExplicitAny: intentionally untyped DOM stubs
type Any = any;
function makeCtx2d() {
	const grad = { addColorStop() {} };
	return new Proxy({} as Record<string, unknown>, {
		get(t, p: string) {
			if (p in t) return t[p];
			if (p === "createLinearGradient") return () => grad;
			return () => grad;
		},
		set(t, p: string, v) {
			t[p] = v;
			return true;
		},
	});
}
function mkNode(tag: string): Any {
	const node: Any = {
		tagName: tag,
		nodeType: tag === "#text" ? 3 : 1,
		children: [],
		style: { setProperty() {} },
		className: "",
		id: "",
		textContent: "",
		innerHTML: "",
		clientWidth: 320,
		clientHeight: 140,
		scrollTop: 0,
		parentElement: null,
		dataset: {},
		appendChild(c: Any) {
			this.children.push(c);
			if (c) c.parentElement = this;
			return c;
		},
		removeChild(c: Any) {
			const i = this.children.indexOf(c);
			if (i >= 0) this.children.splice(i, 1);
			return c;
		},
		setAttribute(k: string, v: string) {
			if (k === "class") this.className = v;
			this[k] = v;
		},
		getAttribute(k: string) {
			return this[k] ?? null;
		},
		addEventListener() {},
		removeEventListener() {},
		classList: {
			add() {},
			remove() {},
			toggle: () => true,
			contains: () => false,
		},
		getContext: () => makeCtx2d(),
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 24 }),
		querySelector: () => null,
		querySelectorAll: () => [],
	};
	return node;
}
function makeDoc(): Any {
	const body = mkNode("body");
	return {
		body,
		documentElement: mkNode("html"),
		createElement: (t: string) => mkNode(t),
		createTextNode: (t: string) => {
			const n = mkNode("#text");
			n.textContent = t;
			return n;
		},
		querySelector: () => null,
		getElementById: () => null,
	};
}
function makeWin(): Any {
	return {
		devicePixelRatio: 1,
		innerWidth: 1400,
		innerHeight: 900,
		addEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener() {} }),
	};
}
function runModule(win: Any, doc: Any, src: string) {
	const fn = new Function(
		"window",
		"document",
		"performance",
		"requestAnimationFrame",
		"fetch",
		"setTimeout",
		"clearTimeout",
		"setInterval",
		"clearInterval",
		"getComputedStyle",
		src,
	);
	fn(
		win,
		doc,
		{ now: () => 0 },
		() => 1,
		() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
		() => 0,
		() => {},
		() => 0, // setInterval no-op so render isn't rescheduled in tests
		() => {},
		() => ({ getPropertyValue: () => "" }), // palette → fallbacks
	);
}
function bootAll(): { win: Any; doc: Any } {
	const win = makeWin();
	const doc = makeDoc();
	for (const m of MODULES) runModule(win, doc, read(m));
	return { win, doc };
}

/** A realistic feed payload (mirrors /api/ops/feed shape). */
function realFeed(now: number) {
	return {
		now,
		cursor: 3,
		working: true,
		model: "kimi-k2-cloud",
		windowMs: 600000,
		usage: { costUsd: 0.18, tokIn: 4200, tokOut: 1900 },
		toolMetrics: { file_read: { count: 12, errors: 1, totalMs: 2400 } },
		topology: [
			{ id: "core", label: "Core", kind: "reason", color: "#3fe08f" },
			{ id: "files", label: "Files", kind: "skill", color: "#7ee06a" },
			{ id: "mcp:web", label: "Web Pilot", kind: "service", color: "#34cfa8" },
		],
		agents: [
			{
				id: "agent-x-1",
				name: "x",
				task: "deep dig",
				done: false,
				ok: false,
				ageMs: 1000,
			},
		],
		ops: [
			{
				id: 1,
				toolId: "files",
				op: "file_read",
				status: "ok",
				startedAt: now - 3000,
				endAt: now - 2800,
				duration: 200,
				tokIn: 50,
				tokOut: 20,
				args: "app.ts",
				taskId: 0,
				taskLabel: "",
			},
			{
				id: 2,
				toolId: "files",
				op: "file_read",
				status: "error",
				startedAt: now - 2000,
				endAt: now - 1900,
				duration: 100,
				tokIn: 10,
				tokOut: 0,
				args: "b.ts",
				taskId: 0,
				taskLabel: "",
			},
			{
				id: 3,
				toolId: "mcp:web",
				op: "web_search",
				status: "ok",
				startedAt: now - 1500,
				endAt: now - 500,
				duration: 1000,
				tokIn: 80,
				tokOut: 200,
				args: "",
				taskId: 42,
				taskLabel: "deep dig",
			},
		],
		inflight: [
			{
				id: -1,
				toolId: "core",
				op: "plan",
				status: "running",
				startedAt: now - 400,
				endAt: now,
				duration: 400,
				tokIn: 5,
				tokOut: 0,
				args: "",
				taskId: 0,
				taskLabel: "",
			},
		],
	};
}

/** Recursively gather rendered text from the stub tree. */
function serialize(node: Any): string {
	if (!node) return "";
	let s = "";
	if (typeof node.textContent === "string") s += node.textContent;
	if (typeof node.innerHTML === "string") s += node.innerHTML;
	if (Array.isArray(node.children))
		for (const c of node.children) s += serialize(c);
	return s;
}

describe("ops static modules", () => {
	test("each module parses (no SyntaxError)", () => {
		for (const m of MODULES) expect(() => new Function(read(m))).not.toThrow();
	});

	test("ui.js exposes a working kit", () => {
		const { win } = bootAll();
		const ui = win.OpsUI;
		expect(ui).toBeTruthy();
		expect(ui.fmtMs(1500)).toBe("1.50s");
		expect(ui.fmtMs(250)).toBe("250ms");
		expect(ui.fmtPct(0.5)).toBe("50%");
		expect(ui.fmtCost(0.123)).toBe("$0.123");
		expect(typeof ui.palette().accent).toBe("string");
	});

	test("charts.js exposes draw helpers that don't throw on a stub canvas", () => {
		const { win, doc } = bootAll();
		const charts = win.OpsCharts;
		expect(typeof charts.sparkline).toBe("function");
		const canvas = doc.createElement("canvas");
		const wrap = doc.createElement("div");
		wrap.appendChild(canvas);
		const hist = Array.from({ length: 50 }, (_, i) => ({
			ok: i % 3,
			err: i % 7 === 0 ? 1 : 0,
			inFlight: 1,
			p50: 100,
			p95: 400,
		}));
		expect(() =>
			charts.sparkline(canvas, [1, 2, 3], { color: "#3fe08f" }),
		).not.toThrow();
		expect(() => charts.throughput(canvas, hist, 120)).not.toThrow();
		expect(() => charts.latency(canvas, hist, 120)).not.toThrow();
	});
});

describe("engine derives aggregates from the REAL feed", () => {
	test("ingest → totals / session / health / tasks / history", () => {
		const { win } = bootAll();
		const eng = win.AgentOps;
		const now = 1_000_000;
		eng._ingest(realFeed(now));

		const tot = eng.totals(10000);
		expect(tot.active).toBe(1); // the in-flight op
		expect(tot.total).toBe(3); // completed ops

		const sess = eng.sessionStats();
		expect(sess.opsTotal).toBe(12); // from toolMetrics (real, since boot)
		expect(sess.errTotal).toBe(1);
		expect(sess.cost).toBe(0.18); // from usage_log (real)
		expect(sess.tokIn).toBe(4200);

		const health = eng.toolHealth();
		const files = health.find((h: Any) => h.tool.id === "files");
		expect(files.opsTotal).toBe(2);
		expect(files.group).toBe("agent");
		expect(health.find((h: Any) => h.tool.id === "mcp:web").group).toBe("mcp");

		const tasks = eng.tasks();
		expect(tasks.length).toBe(1);
		expect(tasks[0].label).toBe("deep dig");
		expect(tasks[0].status).toBe("running");

		const hist = eng.history();
		expect(hist.length).toBe(240);
		expect(hist.reduce((s: number, b: Any) => s + b.ok + b.err, 0)).toBe(3);

		// recent merges in-flight first
		expect(eng.recent(10)[0].status).toBe("running");
	});
});

describe("dash renders from real data (no mock numbers) + empty state", () => {
	test("populated feed → topbar + KPIs + op log render real values", () => {
		const { win, doc } = bootAll();
		const eng = win.AgentOps;
		eng._ingest(realFeed(1_000_000));
		const root = doc.createElement("div");
		expect(() =>
			win.OpsDash.mount(root, {
				model: "kimi-k2-cloud",
				uptimeMs: 60000,
				accent: "#3fe08f",
			}),
		).not.toThrow();
		const out = serialize(root);
		expect(out).toContain("AGENT OPS");
		expect(out).toContain("file_read"); // real op from the feed in the log
		expect(out).toContain("Web Pilot"); // real topology node in tool health
		expect(out).toContain("deep dig"); // real sub-agent task in the recap
		expect(out).toContain("$0.18"); // real cost KPI from usage
	});

	test("empty feed renders clean empty states (no fake numbers)", () => {
		const { win, doc } = bootAll();
		const eng = win.AgentOps;
		eng._ingest({
			now: 1_000_000,
			cursor: 0,
			working: false,
			model: "kimi-k2-cloud",
			windowMs: 600000,
			usage: { costUsd: 0, tokIn: 0, tokOut: 0 },
			toolMetrics: {},
			topology: [
				{ id: "core", label: "Core", kind: "reason", color: "#3fe08f" },
			],
			agents: [],
			ops: [],
			inflight: [],
		});
		const root = doc.createElement("div");
		expect(() =>
			win.OpsDash.mount(root, {
				model: "kimi-k2-cloud",
				uptimeMs: 0,
				accent: "#3fe08f",
			}),
		).not.toThrow();
		const out = serialize(root);
		expect(out).toContain("No operations yet");
		expect(out).toContain("STANDBY");
	});
});

describe("ops-page inline bootstrap (template-trap guard)", () => {
	test("the injected bootstrap cooks, parses, and calls OpsDash.mount", () => {
		const html = String(
			OpsPage({
				accent: "#3fe08f",
				model: "m",
				uptimeMs: 0,
				assetVersion: "abc",
			}),
		);
		const re = /<script>([\s\S]*?)<\/script>/g;
		const scripts: string[] = [];
		let mm: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
		while ((mm = re.exec(html)) !== null) scripts.push(mm[1]);
		const boot = scripts.find((s) => s.includes("window.OpsDash.mount"));
		expect(boot).toBeTruthy();
		expect(
			() => new Function("window", "document", boot as string),
		).not.toThrow();
		// cache-busting + new module set are wired
		expect(html).toContain("/ops/static/dash.js?v=abc");
		expect(html).toContain("/ops/static/engine.js?v=abc");
		expect(html).not.toContain("viz-stream");
		expect(html).not.toContain("OpsShell");
	});
});

describe("OpsPage accent theming", () => {
	test("a valid accent is inlined as --accent; an evil value is rejected", () => {
		const ok = String(OpsPage({ accent: "#7458f5", model: "m", uptimeMs: 0 }));
		expect(ok).toContain("--accent:#7458f5");
		const evil = String(
			OpsPage({
				accent: "</style><script>alert(1)</script>",
				model: "m",
				uptimeMs: 0,
			}),
		);
		expect(evil).toContain("--accent:#3fe08f"); // fell back to the safe default
		expect(evil).not.toContain("<script>alert(1)");
	});
});
