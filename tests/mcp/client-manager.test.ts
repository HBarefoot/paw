import { describe, expect, test } from "bun:test";
import {
	type MCPClient,
	MCPClientManager,
} from "../../src/mcp/client-manager.js";
import { createLogger } from "../../src/observability/logger.js";

// A fake MCPClient so the discovery / namespacing / wrapping / error paths can
// be tested without the real MCP SDK transport (injected via registerTestServer).
function fakeClient(opts: {
	tools?: Array<{ name: string; inputSchema?: Record<string, unknown> }>;
	listToolsThrows?: boolean;
	callTool?: MCPClient["callTool"];
}): MCPClient {
	return {
		connect: async () => {},
		close: async () => {},
		listTools: async () => {
			if (opts.listToolsThrows) throw new Error("server unreachable");
			return { tools: opts.tools ?? [] };
		},
		callTool:
			opts.callTool ??
			(async () => ({ content: [{ type: "text", text: "ok" }] })),
	};
}

function manager(): MCPClientManager {
	return new MCPClientManager(createLogger("test-mcp"));
}

describe("MCPClientManager.discoverTools", () => {
	test("namespaces tools as mcp__<server>__<tool> with plugin mcp:<server>", async () => {
		const m = manager();
		m.registerTestServer(
			"n8n",
			fakeClient({
				tools: [
					{ name: "run_workflow", inputSchema: { type: "object" } },
					{ name: "list_workflows" },
				],
			}),
		);
		const tools = await m.discoverTools("n8n");
		expect(tools.map((t) => t.name).sort()).toEqual([
			"mcp__n8n__list_workflows",
			"mcp__n8n__run_workflow",
		]);
		expect(tools.every((t) => t.plugin === "mcp:n8n")).toBe(true);
	});

	test("skips tools with unsafe names (would break the __ namespacing)", async () => {
		const m = manager();
		m.registerTestServer(
			"srv",
			fakeClient({
				tools: [
					{ name: "good_tool" },
					{ name: "bad__tool" }, // contains __
					{ name: "1bad" }, // must start with a letter
				],
			}),
		);
		const tools = await m.discoverTools("srv");
		expect(tools.map((t) => t.name)).toEqual(["mcp__srv__good_tool"]);
	});

	test("a server tool-call error surfaces as a tool error result, not a crash", async () => {
		const m = manager();
		m.registerTestServer(
			"srv",
			fakeClient({
				tools: [{ name: "boom" }],
				callTool: async () => {
					throw new Error("upstream 500");
				},
			}),
		);
		const [tool] = await m.discoverTools("srv");
		let result: Awaited<ReturnType<typeof tool.handler>>;
		// Must not throw out of the handler.
		await expect(
			(async () => {
				result = await tool.handler({});
				return result;
			})(),
		).resolves.toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: assigned above
		expect(result!.is_error).toBe(true);
	});

	test("a failing server doesn't block discovery of others", async () => {
		const m = manager();
		m.registerTestServer("down", fakeClient({ listToolsThrows: true }));
		m.registerTestServer("up", fakeClient({ tools: [{ name: "ping" }] }));

		const down = await m.discoverTools("down"); // caught internally → []
		const up = await m.discoverTools("up");
		expect(down).toEqual([]);
		expect(up.map((t) => t.name)).toEqual(["mcp__up__ping"]);
	});

	test("unknown server → empty list", async () => {
		const m = manager();
		expect(await m.discoverTools("nope")).toEqual([]);
	});
});
