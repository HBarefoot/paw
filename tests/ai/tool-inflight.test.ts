import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "../../src/ai/tools.js";
import type { ToolDefinition, ToolResult } from "../../src/types/message.js";

function tool(
	name: string,
	handler: (i: Record<string, unknown>) => Promise<ToolResult>,
): ToolDefinition {
	return { name, description: "", input_schema: {}, plugin: "kernel", handler };
}

describe("ToolRegistry in-flight registry (Rider 1: fail-open, bounded)", () => {
	test("populates during execution and clears after success", async () => {
		const reg = new ToolRegistry();
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		reg.register([
			tool("slow", async () => {
				await gate;
				return { content: "ok" };
			}),
		]);

		const p = reg.execute("slow", { a: 1 });
		// trackStart runs synchronously before the awaited handler.
		const live = reg.getInFlight();
		expect(live.length).toBe(1);
		expect(live[0].toolName).toBe("slow");
		expect(live[0].plugin).toBe("kernel");
		expect(typeof live[0].startedAt).toBe("number");

		release();
		await p;
		expect(reg.getInFlight().length).toBe(0);
	});

	test("clears in-flight even when the tool throws (finally path)", async () => {
		const reg = new ToolRegistry();
		reg.register([
			tool("boom", async () => {
				throw new Error("nope");
			}),
		]);
		const res = await reg.execute("boom", {});
		expect(res.is_error).toBe(true);
		expect(reg.getInFlight().length).toBe(0);
	});

	test("getInFlight always returns an array (never throws)", () => {
		const reg = new ToolRegistry();
		expect(Array.isArray(reg.getInFlight())).toBe(true);
		expect(reg.getInFlight().length).toBe(0);
	});

	test("unknown tool never enters the in-flight set", async () => {
		const reg = new ToolRegistry();
		await reg.execute("does-not-exist", {});
		expect(reg.getInFlight().length).toBe(0);
	});
});
