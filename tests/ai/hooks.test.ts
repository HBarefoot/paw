import { describe, expect, test } from "bun:test";
import {
	HookManager,
	type ToolHookContext,
	createGuardrailHook,
	createMetricsHook,
} from "../../src/ai/hooks.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

const CTX: ToolHookContext = {
	toolName: "echo",
	plugin: "kernel",
	input: { text: "hi" },
	sessionId: "web-1",
	origin: { channel: "web", ref: "web-1" },
};

/** A registry with one `echo` tool that records whether it ran + the input it saw. */
function registryWithEcho() {
	const calls: Array<Record<string, unknown>> = [];
	const echo: ToolDefinition = {
		name: "echo",
		description: "echo",
		plugin: "kernel",
		input_schema: { type: "object" },
		handler: async (input) => {
			calls.push(input);
			return { content: `echo:${String(input.text ?? "")}` };
		},
	};
	const reg = new ToolRegistry();
	reg.register([echo]);
	return { reg, calls };
}

describe("HookManager.runBefore", () => {
	test("deny short-circuits with the verdict", async () => {
		const hm = new HookManager();
		hm.register({
			name: "d",
			failClosed: true,
			before: () => ({ kind: "deny", reason: "nope" }),
		});
		const { verdict } = await hm.runBefore(CTX);
		expect(verdict).toEqual({ kind: "deny", reason: "nope" });
	});

	test("modify threads the new input forward to later hooks", async () => {
		const hm = new HookManager();
		let secondSaw: unknown = null;
		hm.register({
			name: "m",
			before: () => ({ kind: "modify", input: { text: "X" } }),
		});
		hm.register({
			name: "observer",
			before: (c) => {
				secondSaw = c.input;
			},
		});
		const { verdict, input } = await hm.runBefore(CTX);
		expect(verdict.kind).toBe("allow");
		expect(input).toEqual({ text: "X" });
		expect(secondSaw).toEqual({ text: "X" });
	});

	test("require-approval short-circuits", async () => {
		const hm = new HookManager();
		hm.register({
			name: "g",
			failClosed: true,
			before: () => ({ kind: "require-approval", reason: "ask" }),
		});
		const { verdict } = await hm.runBefore(CTX);
		expect(verdict).toEqual({ kind: "require-approval", reason: "ask" });
	});

	test("throwing GATE (failClosed) → deny; throwing OBSERVER → proceed", async () => {
		const gate = new HookManager();
		gate.register({
			name: "boom",
			failClosed: true,
			before: () => {
				throw new Error("kaboom");
			},
		});
		expect((await gate.runBefore(CTX)).verdict.kind).toBe("deny");

		const obs = new HookManager();
		obs.register({
			name: "obs",
			before: () => {
				throw new Error("kaboom");
			},
		});
		expect((await obs.runBefore(CTX)).verdict.kind).toBe("allow");
	});
});

describe("HookManager.runAfter + metrics", () => {
	test("a throwing after-observer never propagates", async () => {
		const hm = new HookManager();
		hm.register({
			name: "boom",
			after: () => {
				throw new Error("x");
			},
		});
		await hm.runAfter(CTX, { content: "ok" }, 5); // resolves, no throw
	});

	test("metrics hook aggregates count/errors/timing", async () => {
		const hm = new HookManager();
		hm.register(createMetricsHook(hm));
		await hm.runAfter(CTX, { content: "ok" }, 10);
		await hm.runAfter(CTX, { content: "err", is_error: true }, 20);
		expect(hm.metrics().echo).toEqual({ count: 2, errors: 1, totalMs: 30 });
	});
});

describe("ToolRegistry.execute × hooks", () => {
	test("before deny → handler not called, denial surfaced as a tool error", async () => {
		const { reg, calls } = registryWithEcho();
		const hm = new HookManager();
		hm.register({
			name: "d",
			failClosed: true,
			before: () => ({ kind: "deny", reason: "policy" }),
		});
		reg.setHooks(hm);
		const res = await reg.execute("echo", { text: "hi" }, "web-1");
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Blocked by policy: policy");
		expect(calls).toHaveLength(0);
	});

	test("before modify → handler runs with modified input", async () => {
		const { reg, calls } = registryWithEcho();
		const hm = new HookManager();
		hm.register({
			name: "m",
			before: () => ({ kind: "modify", input: { text: "MOD" } }),
		});
		reg.setHooks(hm);
		const res = await reg.execute("echo", { text: "hi" }, "web-1");
		expect(res.content).toBe("echo:MOD");
		expect(calls[0]).toEqual({ text: "MOD" });
	});

	test("before require-approval → routes to the approval sink, handler not called", async () => {
		const { reg, calls } = registryWithEcho();
		const hm = new HookManager();
		const sink: Array<{ tool: string; reason: string }> = [];
		hm.setApprovalSink((ctx, reason) => {
			sink.push({ tool: ctx.toolName, reason });
			return "appr-1";
		});
		hm.register({
			name: "g",
			failClosed: true,
			before: () => ({ kind: "require-approval", reason: "needs ok" }),
		});
		reg.setHooks(hm);
		const res = await reg.execute("echo", { text: "hi" }, "web-1");
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Queued for human approval (id=appr-1)");
		expect(calls).toHaveLength(0);
		expect(sink).toEqual([{ tool: "echo", reason: "needs ok" }]);
	});

	test("a crashing GATE hook fails closed — the call is blocked, not allowed", async () => {
		const { reg, calls } = registryWithEcho();
		const hm = new HookManager();
		hm.register({
			name: "boom",
			failClosed: true,
			before: () => {
				throw new Error("crash");
			},
		});
		reg.setHooks(hm);
		const res = await reg.execute("echo", { text: "hi" }, "web-1");
		expect(res.is_error).toBe(true);
		expect(calls).toHaveLength(0); // security verdict not weakened by the crash
	});

	test("metrics hook populates per-tool stats via the registry; order respected", async () => {
		const { reg } = registryWithEcho();
		const hm = new HookManager();
		const order: string[] = [];
		hm.register({ name: "first", after: () => void order.push("first") });
		hm.register(createMetricsHook(hm));
		hm.register({ name: "last", after: () => void order.push("last") });
		reg.setHooks(hm);
		await reg.execute("echo", { text: "hi" }, "web-1");
		expect(hm.metrics().echo?.count).toBe(1);
		expect(order).toEqual(["first", "last"]);
	});

	test("guardrail built-in denies a configured tool (the documented extension)", async () => {
		const { reg, calls } = registryWithEcho();
		const hm = new HookManager();
		hm.register(
			createGuardrailHook({ denyTools: ["echo"], requireApprovalTools: [] }),
		);
		reg.setHooks(hm);
		const res = await reg.execute("echo", { text: "hi" }, "web-1");
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("denied by policy");
		expect(calls).toHaveLength(0);
	});

	test("no hooks registered → unchanged behavior", async () => {
		const { reg, calls } = registryWithEcho();
		reg.setHooks(new HookManager()); // present but empty
		const res = await reg.execute("echo", { text: "hi" }, "web-1");
		expect(res.content).toBe("echo:hi");
		expect(calls).toHaveLength(1);
	});
});
