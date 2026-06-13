import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "../../src/ai/tools.js";
import { Sandbox } from "../../src/kernel/sandbox.js";
import { createLogger } from "../../src/observability/logger.js";

const logger = createLogger("test");

describe("ToolRegistry sandbox enforcement (H-NEW-4)", () => {
	test("enforces permission for built-in kernel tools (no bypass)", async () => {
		const sandbox = new Sandbox(logger);
		// Mirror the kernel manifest registration. Note: this test does
		// NOT register file:write, so file_write should be denied.
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: ["file:read", "memory:read"],
		});

		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		registry.register([
			{
				name: "file_read",
				description: "Read a file",
				input_schema: { type: "object" },
				plugin: "kernel",
				handler: async () => ({ content: "ok" }),
			},
			{
				name: "file_write",
				description: "Write a file",
				input_schema: { type: "object" },
				plugin: "kernel",
				handler: async () => ({ content: "ok" }),
			},
		]);

		// file_read has file:read permission, allowed
		const allowed = await registry.execute("file_read", {});
		expect(allowed.is_error).toBeFalsy();
		expect(allowed.content).toBe("ok");

		// file_write is NOT in the manifest, denied
		const denied = await registry.execute("file_write", { path: "/etc/x" });
		expect(denied.is_error).toBe(true);
		expect(denied.content).toContain("Permission denied");
	});

	test("canvas_submissions_list is reachable under the same canvas grants as canvas_action_list", async () => {
		// REGRESSION (#88 fallout): canvas_submissions_list matched no inferPermission
		// rule and fell through to the bare plugin name "kernel" (not a granted
		// permission) → denied. It is a read, so it now maps to canvas:read, which the
		// kernel manifest grants — same reachability as the canvas_action_* tools.
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: ["canvas:read", "canvas:write"],
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		const mk = (name: string) => ({
			name,
			description: name,
			input_schema: { type: "object" as const },
			plugin: "kernel",
			handler: async () => ({ content: "ok" }),
		});
		registry.register([
			mk("canvas_action_list"),
			mk("canvas_submissions_list"),
		]);

		const control = await registry.execute("canvas_action_list", {});
		expect(control.is_error).toBeFalsy();
		const subs = await registry.execute("canvas_submissions_list", {});
		expect(subs.is_error).toBeFalsy();
		expect(subs.content).toBe("ok");
	});

	test("denies unknown plugin", async () => {
		const sandbox = new Sandbox(logger);
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		registry.register([
			{
				name: "memory_recall",
				description: "Recall",
				input_schema: { type: "object" },
				plugin: "unknown-plugin",
				handler: async () => ({ content: "ok" }),
			},
		]);

		const result = await registry.execute("memory_recall", {});
		expect(result.is_error).toBe(true);
	});

	test("kernel manifest lists all required permissions", () => {
		// Sanity check: every permission that inferPermission can return
		// for a kernel tool must be in the kernel manifest. This is a
		// guard against silent denial after a new built-in tool is added.
		const kernelManifestPerms = [
			"file:read",
			"file:write",
			"exec",
			"memory:read",
			"memory:write",
			"memory:forget",
			"cron:create",
			"agent:spawn",
			"agent:delegate",
			"skill:activate",
			"canvas:read",
			"canvas:write",
		];
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: kernelManifestPerms,
		});

		// Every permission in the list should be granted.
		for (const perm of kernelManifestPerms) {
			expect(sandbox.checkPermission("kernel", perm)).toBe(true);
		}
	});
});
