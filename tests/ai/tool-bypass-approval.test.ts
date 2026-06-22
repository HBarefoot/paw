import { describe, expect, test } from "bun:test";
import { HookManager } from "../../src/ai/hooks.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import { Sandbox } from "../../src/kernel/sandbox.js";
import { createLogger } from "../../src/observability/logger.js";
import type { ToolDefinition } from "../../src/types/message.js";

// PR1 (execute-on-approve): ToolRegistry.execute(..., { bypassApproval: true })
// must run an already-approved tool by converting ONLY the `require-approval`
// verdict to "proceed" — without enqueuing a fresh approval (no loop) — while
// every other check (sandbox, `deny`) still applies.

const logger = createLogger("test");

function setup(opts: { approvalReason?: string } = {}) {
	const calls: Array<Record<string, unknown>> = [];
	const send: ToolDefinition = {
		name: "send",
		description: "send",
		plugin: "kernel",
		input_schema: { type: "object" },
		handler: async (input) => {
			calls.push(input);
			return { content: "sent" };
		},
	};
	const reg = new ToolRegistry();
	reg.register([send]);

	const hm = new HookManager();
	hm.register({
		name: "gate",
		failClosed: true,
		before: (ctx) =>
			ctx.toolName === "send"
				? {
						kind: "require-approval",
						reason: opts.approvalReason ?? "needs ok",
					}
				: undefined,
	});
	const sinkCalls: Array<{ tool: string; reason: string }> = [];
	hm.setApprovalSink((ctx, reason) => {
		sinkCalls.push({ tool: ctx.toolName, reason });
		return "appr-1";
	});
	reg.setHooks(hm);
	return { reg, calls, sinkCalls };
}

describe("ToolRegistry.execute — bypassApproval", () => {
	test("WITHOUT bypass: require-approval enqueues + returns is_error, handler NOT run", async () => {
		const { reg, calls, sinkCalls } = setup();
		const res = await reg.execute("send", { to: "a" }, "agent-x-1");
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("approval");
		expect(sinkCalls).toHaveLength(1); // queued
		expect(calls).toHaveLength(0); // handler never ran
	});

	test("WITH bypass: handler runs, returns its result, and does NOT re-enqueue (no loop)", async () => {
		const { reg, calls, sinkCalls } = setup();
		const res = await reg.execute("send", { to: "a" }, "agent-x-1", {
			bypassApproval: true,
		});
		expect(res.is_error).toBeFalsy();
		expect(res.content).toBe("sent");
		expect(calls).toEqual([{ to: "a" }]); // ran once with the exact input
		expect(sinkCalls).toHaveLength(0); // crucially: no fresh approval enqueued
	});

	test("bypass is scoped to require-approval: a `deny` hook still blocks", async () => {
		const { reg, calls } = setup();
		// Add a deny hook that fires first for `send`.
		const hm = new HookManager();
		hm.register({
			name: "deny",
			failClosed: true,
			before: () => ({ kind: "deny", reason: "policy" }),
		});
		reg.setHooks(hm);
		const res = await reg.execute("send", {}, "agent-x-1", {
			bypassApproval: true,
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Blocked by policy");
		expect(calls).toHaveLength(0);
	});

	test("bypass does NOT skip the sandbox permission check", async () => {
		const sandbox = new Sandbox(logger);
		// Manifest grants nothing relevant → `send` (inferred perm) is denied.
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: [],
		});
		const send: ToolDefinition = {
			name: "exec_command",
			description: "run",
			plugin: "kernel",
			input_schema: { type: "object" },
			handler: async () => ({ content: "ran" }),
		};
		const reg = new ToolRegistry();
		reg.setSandbox(sandbox, true);
		reg.register([send]);
		const res = await reg.execute("exec_command", {}, "agent-x-1", {
			bypassApproval: true,
		});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Permission denied");
	});
});
