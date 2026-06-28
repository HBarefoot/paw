import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
	CRON_ALLOWED_EVENTS,
	CronScheduler,
	isAllowedCronEvent,
	resolveCronAction,
	stripWrappingQuotes,
	suggestToolNames,
} from "../../src/cron/scheduler.js";
import { EventBus } from "../../src/kernel/bus.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import { createLogger } from "../../src/observability/logger.js";
import type { ToolDefinition } from "../../src/types/message.js";

// A registry where `check_system_health` and `send_email` exist.
function registryWith(
	calls?: Array<{ name: string; input: Record<string, unknown> }>,
): ToolRegistry {
	const reg = new ToolRegistry();
	const def = (name: string, plugin: string): ToolDefinition => ({
		name,
		description: name,
		input_schema: {},
		plugin,
		handler: async (input) => {
			calls?.push({ name, input });
			return { content: "ok" };
		},
	});
	reg.register([
		def("check_system_health", "kernel"),
		def("send_email", "mail"),
	]);
	return reg;
}

function depsFrom(reg: ToolRegistry) {
	return {
		getTool: (n: string) => reg.get(n),
		toolNames: () => [...reg.allTools()].map((t) => t.name),
	};
}

describe("stripWrappingQuotes", () => {
	test("removes one surrounding pair of single/double quotes", () => {
		expect(stripWrappingQuotes('"Health"')).toBe("Health");
		expect(stripWrappingQuotes("'Health'")).toBe("Health");
		expect(stripWrappingQuotes("Health")).toBe("Health");
		// only one pair: the bug rendered "Health" inside the error template
		expect(stripWrappingQuotes('"memory:stored"')).toBe("memory:stored");
		// mismatched quotes are left alone
		expect(stripWrappingQuotes("\"oops'")).toBe("\"oops'");
	});
});

describe("suggestToolNames", () => {
	test("prefix matches rank ahead of substring, capped", () => {
		const names = ["check_system_health", "system_info", "send_email"];
		expect(suggestToolNames(names, "check_system_health_x")).toContain(
			"check_system_health",
		);
		expect(suggestToolNames(names, "system")).toEqual([
			"system_info",
			"check_system_health",
		]);
		expect(suggestToolNames(names, "system", 1).length).toBe(1);
		expect(suggestToolNames(names, "")).toEqual([]);
	});
});

describe("resolveCronAction — API boundary (H-NEW-1 / H-NEW-2)", () => {
	test("registered tool → action carries the tool's plugin (H-NEW-2)", () => {
		const reg = registryWith();
		const r = resolveCronAction(
			"tool",
			"check_system_health",
			undefined,
			depsFrom(reg),
		);
		expect(r).toEqual({
			action: { type: "tool", tool: "check_system_health", plugin: "kernel" },
		});
	});

	test("unknown tool → error WITH suggestions (regression: pre-fix had none)", () => {
		const reg = registryWith();
		// A near-miss the substring/prefix matcher can catch (the prod report
		// was a user typing a name that wasn't registered in their deploy).
		const r = resolveCronAction("tool", "check_system", undefined, depsFrom(reg));
		expect("error" in r).toBe(true);
		if ("error" in r) {
			expect(r.error).toContain("Unknown tool");
			expect(r.error).toContain("Did you mean");
			expect(r.error).toContain("check_system_health");
		}
	});

	test("quoted, non-allowlisted event → error LISTS the allowlist", () => {
		const r = resolveCronAction("event", '"Health"', undefined, depsFrom(registryWith()));
		expect("error" in r).toBe(true);
		if ("error" in r) {
			expect(r.error).toContain("not in the cron event allowlist");
			for (const e of CRON_ALLOWED_EVENTS) expect(r.error).toContain(e);
		}
	});

	test("quoted, valid event → quotes stripped, action built (regression)", () => {
		const r = resolveCronAction(
			"event",
			'"memory:stored"',
			undefined,
			depsFrom(registryWith()),
		);
		expect(r).toEqual({ action: { type: "event", event: "memory:stored" } });
	});

	test("tool args: valid JSON object → action.input; bad JSON / non-object → error", () => {
		const deps = depsFrom(registryWith());
		const ok = resolveCronAction("tool", "send_email", '{"to":"x"}', deps);
		expect(ok).toEqual({
			action: {
				type: "tool",
				tool: "send_email",
				plugin: "mail",
				input: { to: "x" },
			},
		});
		expect("error" in resolveCronAction("tool", "send_email", "{not json", deps)).toBe(
			true,
		);
		expect("error" in resolveCronAction("tool", "send_email", "[1,2]", deps)).toBe(
			true,
		);
	});

	test("prompt payload is kept verbatim (quotes NOT stripped)", () => {
		const r = resolveCronAction("prompt", '"hello"', undefined, depsFrom(registryWith()));
		expect(r).toEqual({ action: { type: "prompt", prompt: '"hello"' } });
	});

	test("unknown action type → error", () => {
		expect(
			"error" in resolveCronAction("nope", "x", undefined, depsFrom(registryWith())),
		).toBe(true);
	});
});

describe("allowlist export ↔ isAllowedCronEvent agree (no drift)", () => {
	test("every member passes; an outsider fails", () => {
		for (const e of CRON_ALLOWED_EVENTS) expect(isAllowedCronEvent(e)).toBe(true);
		expect(isAllowedCronEvent("kernel:shutdown")).toBe(false);
	});
});

// --- Defense in depth: the scheduler re-enforces both checks ---

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE cron_jobs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, expression TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      action_type TEXT NOT NULL CHECK(action_type IN ('prompt','tool','event')),
      action_payload TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT, next_run TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_proactive INTEGER NOT NULL DEFAULT 0, action_condition TEXT,
      data_source TEXT, last_data_hash TEXT
    );
  `);
	return db;
}

function tick(scheduler: CronScheduler): Promise<void> {
	return (scheduler as unknown as { tick(): Promise<void> }).tick();
}

describe("scheduler defense in depth", () => {
	let db: Database;
	afterEach(() => db.close());
	beforeEach(() => {
		db = freshDb();
	});

	test("addJob still refuses a non-allowlisted event", () => {
		const reg = registryWith();
		const sched = new CronScheduler(db, new EventBus(), reg, createLogger("t"));
		expect(() =>
			sched.addJob({
				name: "evil",
				expression: "0 0 * * *",
				action: { type: "event", event: "kernel:shutdown" },
			}),
		).toThrow(/not in the allowlist/);
	});

	test("a resolved tool action persists with its plugin recorded", () => {
		const reg = registryWith();
		const sched = new CronScheduler(db, new EventBus(), reg, createLogger("t"));
		const resolved = resolveCronAction(
			"tool",
			"check_system_health",
			undefined,
			depsFrom(reg),
		);
		if ("error" in resolved) throw new Error(resolved.error);
		const id = sched.addJob({
			name: "health",
			expression: "0 0 * * *",
			action: resolved.action,
		});
		expect(sched.getJob(id)?.action.plugin).toBe("kernel");
	});

	test("execute skips an unregistered tool — handler never runs", async () => {
		const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
		const reg = registryWith(calls);
		const sched = new CronScheduler(db, new EventBus(), reg, createLogger("t"));
		const id = sched.addJob({
			name: "ghost",
			expression: "0 0 * * *",
			// plugin set but the tool does not exist in the registry
			action: { type: "tool", tool: "not_registered", plugin: "kernel" },
		});
		db.run("UPDATE cron_jobs SET next_run = ? WHERE id = ?", [
			"2000-01-01T00:00:00.000Z",
			id,
		]);
		await tick(sched);
		expect(calls).toEqual([]);
	});

	test("execute refuses a forbidden event even if it bypassed addJob", async () => {
		const bus = new EventBus();
		const emitted: string[] = [];
		bus.on("kernel:shutdown" as never, () => {
			emitted.push("kernel:shutdown");
		});
		const sched = new CronScheduler(db, bus, registryWith(), createLogger("t"));
		// Insert a forbidden event job directly, bypassing addJob's guard.
		db.run(
			`INSERT INTO cron_jobs (id, name, expression, timezone, action_type, action_payload, enabled, next_run)
       VALUES ('x', 'sneaky', '0 0 * * *', 'UTC', 'event', ?, 1, '2000-01-01T00:00:00.000Z')`,
			[JSON.stringify({ type: "event", event: "kernel:shutdown" })],
		);
		await tick(sched);
		expect(emitted).toEqual([]);
	});

	// --- H-NEW-2 completion: the tool plugin gate is mandatory + enforced at
	// execution time (was opt-in at addJob with no run-time check). ---

	test("addJob refuses a tool action with NO plugin (was opt-in)", () => {
		const sched = new CronScheduler(
			db,
			new EventBus(),
			registryWith(),
			createLogger("t"),
		);
		expect(() =>
			sched.addJob({
				name: "no-plugin",
				expression: "0 0 * * *",
				// plugin omitted — pre-fix this persisted and ran at exec time.
				action: { type: "tool", tool: "check_system_health" },
			}),
		).toThrow(/must declare its owning plugin/);
	});

	// Insert a tool job directly, bypassing addJob (simulates a programmatic
	// caller, a future job-scheduling tool, or a row that reached the DB another
	// way), forced due so tick() runs it.
	function insertDueToolJob(action: Record<string, unknown>): void {
		db.run(
			`INSERT INTO cron_jobs (id, name, expression, timezone, action_type, action_payload, enabled, next_run)
       VALUES (?, 'evil', '0 0 * * *', 'UTC', 'tool', ?, 1, '2000-01-01T00:00:00.000Z')`,
			[crypto.randomUUID(), JSON.stringify(action)],
		);
	}

	test("execute refuses a plugin-LESS tool job even if it bypassed addJob", async () => {
		const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
		const sched = new CronScheduler(
			db,
			new EventBus(),
			registryWith(calls),
			createLogger("t"),
		);
		// No `plugin` — pre-fix executeAction ran check_system_health regardless.
		insertDueToolJob({ type: "tool", tool: "check_system_health" });
		await tick(sched);
		expect(calls).toEqual([]);
	});

	test("execute refuses a tool job whose plugin does NOT own the tool", async () => {
		const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
		const sched = new CronScheduler(
			db,
			new EventBus(),
			registryWith(calls),
			createLogger("t"),
		);
		// check_system_health is owned by "kernel", not "mail".
		insertDueToolJob({
			type: "tool",
			tool: "check_system_health",
			plugin: "mail",
		});
		await tick(sched);
		expect(calls).toEqual([]);
	});

	test("execute runs a correctly plugin-tagged tool job (no regression)", async () => {
		const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
		const sched = new CronScheduler(
			db,
			new EventBus(),
			registryWith(calls),
			createLogger("t"),
		);
		insertDueToolJob({
			type: "tool",
			tool: "check_system_health",
			plugin: "kernel",
		});
		await tick(sched);
		expect(calls).toEqual([{ name: "check_system_health", input: {} }]);
	});
});
