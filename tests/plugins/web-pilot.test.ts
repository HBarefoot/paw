import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "../../src/types/message.js";

// ---- Fake Playwright (no real browser launches in tests) -------------------
// biome-ignore lint/suspicious/noExplicitAny: test doubles
type Any = any;

let createdPages: Any[] = [];
let addedCookies: Any[] = [];
let lastContextOpts: Any = null;
let videoPath = "";

function makePage(): Any {
	const hs: Record<string, Array<(a: Any) => void>> = {};
	const page = {
		_hs: hs,
		on: (ev: string, fn: (a: Any) => void) => {
			if (!hs[ev]) hs[ev] = [];
			hs[ev].push(fn);
		},
		emit: (ev: string, arg: Any) => {
			for (const f of hs[ev] || []) f(arg);
		},
		setDefaultTimeout: () => {},
		isClosed: () => false,
		close: async () => {},
		goto: async () => {},
		title: async () => "t",
		video: () => ({ path: async () => videoPath }),
		context: () => ({
			addCookies: async (c: Any[]) => addedCookies.push(...c),
		}),
	};
	createdPages.push(page);
	return page;
}

const fakeBrowser = {
	newPage: async () => makePage(),
	newContext: async (opts: Any) => {
		lastContextOpts = opts;
		return { newPage: async () => makePage(), close: async () => {} };
	},
	close: async () => {},
};

mock.module("playwright", () => ({
	chromium: { launch: async () => fakeBrowser },
}));

const { default: WebPilotPlugin } = await import(
	"../../plugins/web-pilot/index.js"
);

async function setup(config: Record<string, unknown> = {}) {
	const plugin = new WebPilotPlugin();
	let tools: ToolDefinition[] = [];
	const ctx = {
		registerTools: (t: ToolDefinition[]) => {
			tools = t;
		},
		logger: { info() {}, error() {}, warn() {}, debug() {} },
		config,
		bus: {},
		store: {},
		llm: async () => "",
		hooks: {},
	};
	// biome-ignore lint/suspicious/noExplicitAny: minimal PluginContext stub
	await plugin.register(ctx as any);
	const tool = (name: string) => {
		const t = tools.find((x) => x.name === name);
		if (!t) throw new Error(`no tool ${name}`);
		return t;
	};
	return { plugin, tool };
}

beforeEach(() => {
	createdPages = [];
	addedCookies = [];
	lastContextOpts = null;
	videoPath = "";
});

describe("web-pilot plugin internals (mocked browser)", () => {
	test("console capture: an emitted error is readable via browser_console", async () => {
		const { tool } = await setup();
		await tool("browser_navigate").handler({
			url: "https://x",
			session_id: "s",
		});
		// The page was instrumented; simulate a console error + a page error.
		createdPages[0].emit("console", {
			type: () => "error",
			text: () => "boom",
		});
		createdPages[0].emit("pageerror", { message: "kaboom" });

		const all = await tool("browser_console").handler({ session_id: "s" });
		expect(all.content).toContain("[error] boom");
		expect(all.content).toContain("kaboom");

		const onlyErr = await tool("browser_console").handler({
			session_id: "s",
			level: "error",
		});
		expect(onlyErr.content).toContain("boom");
	});

	test("network capture: 4xx/5xx + failed requests surface via browser_network", async () => {
		const { tool } = await setup();
		await tool("browser_navigate").handler({
			url: "https://x",
			session_id: "s",
		});
		createdPages[0].emit("response", {
			status: () => 500,
			url: () => "https://x/api",
			request: () => ({ method: () => "GET" }),
		});
		createdPages[0].emit("requestfailed", {
			url: () => "https://x/bad",
			method: () => "POST",
			failure: () => ({ errorText: "net::ERR" }),
		});
		// A 200 must NOT appear (only failures by default).
		createdPages[0].emit("response", {
			status: () => 200,
			url: () => "https://x/ok",
			request: () => ({ method: () => "GET" }),
		});

		const res = await tool("browser_network").handler({ session_id: "s" });
		expect(res.content).toContain("500 GET https://x/api");
		expect(res.content).toContain("ERR POST https://x/bad (net::ERR)");
		expect(res.content).not.toContain("https://x/ok");
	});

	test("recording: start opens a recordVideo context; stop returns the artifact + bytes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wp-rec-"));
		videoPath = join(dir, "v.webm");
		writeFileSync(videoPath, "abcdef"); // 6 bytes
		const { tool } = await setup({ recordingDir: dir });

		const start = await tool("browser_record_start").handler({
			session_id: "r",
		});
		expect(start.is_error).toBeUndefined();
		expect(lastContextOpts?.recordVideo?.dir).toBeDefined();

		const stop = await tool("browser_record_stop").handler({ session_id: "r" });
		expect(stop.content).toContain(videoPath);
		expect(stop.content).toContain("6 bytes");
		expect(stop.content).not.toContain("exceeds size cap");
	});

	test("recording: over-cap is flagged", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wp-rec-"));
		videoPath = join(dir, "v.webm");
		writeFileSync(videoPath, "abcdef");
		const { tool } = await setup({ recordingDir: dir, maxRecordingBytes: 1 });
		await tool("browser_record_start").handler({ session_id: "r" });
		const stop = await tool("browser_record_stop").handler({ session_id: "r" });
		expect(stop.content).toContain("exceeds size cap");
	});

	test("recording: double-start is rejected", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wp-rec-"));
		const { tool } = await setup({ recordingDir: dir });
		await tool("browser_record_start").handler({ session_id: "r" });
		const again = await tool("browser_record_start").handler({
			session_id: "r",
		});
		expect(again.is_error).toBe(true);
		expect(again.content).toContain("Already recording");
	});

	test("attach_session: rejected with no owner config; host-scoped cookie when configured", async () => {
		const none = await setup();
		const r1 = await none.tool("browser_attach_session").handler({});
		expect(r1.is_error).toBe(true);

		const configured = await setup({
			pawBaseUrl: "https://paw.example",
			pawSessionToken: "secret-token",
		});
		const r2 = await configured
			.tool("browser_attach_session")
			.handler({ session_id: "s" });
		expect(r2.is_error).toBeUndefined();
		expect(addedCookies).toHaveLength(1);
		expect(addedCookies[0]).toMatchObject({
			name: "paw_session",
			value: "secret-token",
			url: "https://paw.example",
		});
	});

	test("page cap holds: opening more sessions than maxPages evicts the oldest", async () => {
		const { plugin, tool } = await setup({ maxPages: 2 });
		await tool("browser_navigate").handler({
			url: "https://a",
			session_id: "a",
		});
		await tool("browser_navigate").handler({
			url: "https://b",
			session_id: "b",
		});
		await tool("browser_navigate").handler({
			url: "https://c",
			session_id: "c",
		});
		const health = await plugin.health();
		expect(health.details).toContain("Pages: 2/2");
	});
});
