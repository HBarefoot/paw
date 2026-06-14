import { describe, expect, test } from "bun:test";
import {
	type WebPilotDeps,
	createWebPilotTools,
} from "../../plugins/web-pilot/tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

// A fake deps object — the tool layer is tested without a real browser.
function fakeDeps(over: Partial<WebPilotDeps> = {}): WebPilotDeps {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: minimal page stub
		getPage: async () => ({}) as any,
		readConsole: () => [],
		readNetwork: () => [],
		startRecording: async () => ({ dir: "/tmp/rec" }),
		stopRecording: async () => ({
			path: "/tmp/rec/x.webm",
			bytes: 1234,
			durationMs: 2000,
			overCap: false,
		}),
		attachPawSession: async () => ({ host: "https://paw.example" }),
		...over,
	};
}

function byName(tools: ToolDefinition[], name: string): ToolDefinition {
	const t = tools.find((x) => x.name === name);
	if (!t) throw new Error(`tool ${name} not registered`);
	return t;
}

describe("web-pilot QA tools", () => {
	test("registers the new QA tools alongside the originals", () => {
		const names = createWebPilotTools(fakeDeps()).map((t) => t.name);
		// Originals preserved.
		for (const n of [
			"browser_navigate",
			"browser_screenshot",
			"browser_evaluate",
		]) {
			expect(names).toContain(n);
		}
		// New QA tools.
		for (const n of [
			"browser_console",
			"browser_network",
			"browser_record_start",
			"browser_record_stop",
			"browser_attach_session",
		]) {
			expect(names).toContain(n);
		}
	});

	test("browser_console returns structured entries and filters by level", async () => {
		let askedLevel: string | undefined = "unset";
		const tools = createWebPilotTools(
			fakeDeps({
				readConsole: (_sid, level) => {
					askedLevel = level;
					return [
						{ level: "error", text: "boom", ts: 1 },
						{ level: "log", text: "hi", ts: 2 },
					];
				},
			}),
		);
		const res = await byName(tools, "browser_console").handler({
			level: "error",
		});
		expect(askedLevel).toBe("error");
		expect(res.content).toContain("[error] boom");
	});

	test("browser_console reports empty state", async () => {
		const tools = createWebPilotTools(fakeDeps({ readConsole: () => [] }));
		const res = await byName(tools, "browser_console").handler({});
		expect(res.content).toContain("No console messages");
	});

	test("browser_network defaults to only_failures=true", async () => {
		let onlyFailures: boolean | undefined;
		const tools = createWebPilotTools(
			fakeDeps({
				readNetwork: (_sid, of) => {
					onlyFailures = of;
					return [
						{ url: "https://x/y", method: "GET", status: 500, ts: 1 },
						{
							url: "https://x/z",
							method: "GET",
							status: 0,
							failure: "abort",
							ts: 2,
						},
					];
				},
			}),
		);
		const res = await byName(tools, "browser_network").handler({});
		expect(onlyFailures).toBe(true);
		expect(res.content).toContain("500 GET https://x/y");
		expect(res.content).toContain("ERR GET https://x/z (abort)");
	});

	test("browser_record_stop surfaces the artifact path + over-cap flag", async () => {
		const ok = createWebPilotTools(fakeDeps());
		const r1 = await byName(ok, "browser_record_stop").handler({});
		expect(r1.content).toContain("/tmp/rec/x.webm");
		expect(r1.content).not.toContain("exceeds size cap");

		const over = createWebPilotTools(
			fakeDeps({
				stopRecording: async () => ({
					path: "/tmp/rec/big.webm",
					bytes: 999,
					durationMs: 10,
					overCap: true,
				}),
			}),
		);
		const r2 = await byName(over, "browser_record_stop").handler({});
		expect(r2.content).toContain("exceeds size cap");
	});

	test("browser_record_start relays a start error (already recording)", async () => {
		const tools = createWebPilotTools(
			fakeDeps({
				startRecording: async () => ({ error: "Already recording" }),
			}),
		);
		const res = await byName(tools, "browser_record_start").handler({});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Already recording");
	});

	test("browser_attach_session rejects when no owner session is configured", async () => {
		const tools = createWebPilotTools(
			fakeDeps({
				attachPawSession: async () => ({
					error: "No owner paw session configured.",
				}),
			}),
		);
		const res = await byName(tools, "browser_attach_session").handler({});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("No owner paw session configured");
	});

	test("browser_attach_session confirms the host on success", async () => {
		const tools = createWebPilotTools(fakeDeps());
		const res = await byName(tools, "browser_attach_session").handler({});
		expect(res.is_error).toBeUndefined();
		expect(res.content).toContain("https://paw.example");
	});
});
