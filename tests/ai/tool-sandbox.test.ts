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

	test("git/gh exec tools are reachable under the github plugin's github:write grant", async () => {
		// REGRESSION (#159 fallout): the literal `git`/`gh` tools miss the `github_*`
		// prefix in inferPermission and fell through to the bare plugin name "github"
		// (not a granted permission) → "Permission denied: github cannot use gh", even
		// though the plugin holds github:write. They now map to github:write, which the
		// plugin already grants (the same grant that makes github_commit_files work).
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "github",
			version: "0.1.0",
			description: "",
			permissions: ["github:read", "github:write", "github:admin"],
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		const mk = (name: string) => ({
			name,
			description: name,
			input_schema: { type: "object" as const },
			plugin: "github",
			handler: async () => ({ content: "ok" }),
		});
		registry.register([mk("git"), mk("gh")]);

		for (const name of ["git", "gh"]) {
			const res = await registry.execute(name, {});
			expect(res.is_error).toBeFalsy();
			expect(res.content).toBe("ok");
		}
	});

	test("git/gh require github:write specifically — a read-only grant is denied", async () => {
		// Pin the tier: with only github:read granted, the write-tier git/gh tools are
		// denied (checkPermission is exact-match — read does not satisfy write).
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "github",
			version: "0.1.0",
			description: "",
			permissions: ["github:read"],
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		registry.register([
			{
				name: "gh",
				description: "gh",
				input_schema: { type: "object" },
				plugin: "github",
				handler: async () => ({ content: "ok" }),
			},
		]);

		const res = await registry.execute("gh", {});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Permission denied");
	});

	test("posthog_* tools are reachable under the posthog plugin's posthog:read grant", async () => {
		// REGRESSION (#168): posthog_* tools had no inferPermission case and fell through
		// to the bare plugin name "posthog" (not a granted permission) → "Permission
		// denied", even though the posthog manifest grants posthog:read. They now map to
		// posthog:read, matching the manifest grant.
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "posthog",
			version: "0.1.0",
			description: "",
			permissions: ["posthog:read"],
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		const mk = (name: string) => ({
			name,
			description: name,
			input_schema: { type: "object" as const },
			plugin: "posthog",
			handler: async () => ({ content: "ok" }),
		});
		const posthogTools = [
			"posthog_top_pages",
			"posthog_pageviews",
			"posthog_top_referrers",
			"posthog_event_counts",
			"posthog_funnel",
			"posthog_query",
		];
		registry.register(posthogTools.map(mk));

		for (const name of posthogTools) {
			const res = await registry.execute(name, {});
			expect(res.is_error).toBeFalsy();
			expect(res.content).toBe("ok");
		}
	});

	test("posthog_* tools are denied when only bare 'posthog' is granted (pre-fix behaviour)", async () => {
		// Confirms that the bare "posthog" string does NOT satisfy posthog:read, which is
		// what the fallthrough returned before the fix — and why they were denied.
		const sandbox = new Sandbox(logger);
		// Deliberately register the bare "posthog" permission (not "posthog:read").
		sandbox.registerManifest({
			name: "posthog",
			version: "0.1.0",
			description: "",
			permissions: ["posthog"],
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		registry.register([
			{
				name: "posthog_top_pages",
				description: "posthog_top_pages",
				input_schema: { type: "object" as const },
				plugin: "posthog",
				handler: async () => ({ content: "ok" }),
			},
		]);

		// Post-fix, inferPermission returns "posthog:read" — but the manifest only
		// grants "posthog", so the check fails (exact match required).
		const res = await registry.execute("posthog_top_pages", {});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Permission denied");
	});

	test("playbook tools split read vs write and are reachable under the kernel grants", async () => {
		// REGRESSION (#88/#164/#168 class): a new kernel tool with no inferPermission
		// case falls through to the bare plugin name "kernel" (not a granted
		// permission) → silently denied. load_playbook is a read; create/update are
		// writes. The kernel manifest grants playbook:read + playbook:write.
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: ["playbook:read", "playbook:write"],
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
			mk("load_playbook"),
			mk("create_playbook"),
			mk("update_playbook"),
		]);

		for (const name of [
			"load_playbook",
			"create_playbook",
			"update_playbook",
		]) {
			const res = await registry.execute(name, {});
			expect(res.is_error).toBeFalsy();
			expect(res.content).toBe("ok");
		}
	});

	test("playbook writes require playbook:write — a read-only grant is denied", async () => {
		// Pin the tier: with only playbook:read granted, the write-tier create/update
		// tools are denied (checkPermission is exact-match), while load_playbook works.
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: ["playbook:read"],
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
		registry.register([mk("load_playbook"), mk("create_playbook")]);

		const read = await registry.execute("load_playbook", {});
		expect(read.is_error).toBeFalsy();
		const write = await registry.execute("create_playbook", {});
		expect(write.is_error).toBe(true);
		expect(write.content).toContain("Permission denied");
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
			"playbook:read",
			"playbook:write",
			"task:read",
			"task:write",
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

	test("task_* tools split read vs write and are reachable under the kernel grants", async () => {
		// REGRESSION (the #88/#164/#168 fallthrough class): task_* tools carry
		// plugin: "kernel". Before inferPermission gained explicit cases they fell
		// through to the bare plugin name "kernel" (not a granted permission) →
		// silently denied. list/get map to task:read, create/update to task:write,
		// both granted by the kernel manifest.
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: ["task:read", "task:write"],
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
		const taskTools = ["task_list", "task_get", "task_create", "task_update"];
		registry.register(taskTools.map(mk));

		for (const name of taskTools) {
			const res = await registry.execute(name, {});
			expect(res.is_error).toBeFalsy();
			expect(res.content).toBe("ok");
		}
	});

	test("task_* tools are denied when only the bare 'kernel' string is granted (pre-fix behaviour)", async () => {
		// Confirms the bare plugin name does NOT satisfy task:read/task:write — the
		// fix is the explicit inferPermission cases, not a manifest fallback.
		const sandbox = new Sandbox(logger);
		sandbox.registerManifest({
			name: "kernel",
			version: "0.1.0",
			description: "",
			permissions: ["kernel"],
		});
		const registry = new ToolRegistry();
		registry.setSandbox(sandbox, true);
		registry.register([
			{
				name: "task_create",
				description: "task_create",
				input_schema: { type: "object" },
				plugin: "kernel",
				handler: async () => ({ content: "ok" }),
			},
		]);
		const res = await registry.execute("task_create", {});
		expect(res.is_error).toBe(true);
		expect(res.content).toContain("Permission denied");
	});
});
