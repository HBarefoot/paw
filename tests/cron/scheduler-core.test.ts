import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { CronScheduler } from "../../src/cron/scheduler.js";
import { isValidCron } from "../../src/cron/parser.js";
import { EventBus } from "../../src/kernel/bus.js";
import { ToolRegistry } from "../../src/ai/tools.js";
import { createLogger } from "../../src/observability/logger.js";

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

function makeScheduler(db: Database) {
	const bus = new EventBus();
	const scheduler = new CronScheduler(
		db,
		bus,
		new ToolRegistry(),
		createLogger("test-cron"),
	);
	return { bus, scheduler };
}

// tick() is private; drive it directly so firing is deterministic (no real
// timers / sleeps). This is a test-only access — no production change.
function tick(scheduler: CronScheduler): Promise<void> {
	return (scheduler as unknown as { tick(): Promise<void> }).tick();
}

describe("isValidCron", () => {
	test("accepts standard expressions", () => {
		for (const e of ["* * * * *", "0 0 * * *", "*/15 9-17 * * 1-5", "0 12 1 * *"]) {
			expect(isValidCron(e)).toBe(true);
		}
	});
	test("rejects malformed expressions", () => {
		for (const e of ["", "* * *", "60 * * * *", "not a cron", "* * * * * * *"]) {
			expect(isValidCron(e)).toBe(false);
		}
	});
});

describe("CronScheduler job CRUD + validation", () => {
	let db: Database;
	let scheduler: CronScheduler;
	beforeEach(() => {
		db = freshDb();
		scheduler = makeScheduler(db).scheduler;
	});
	afterEach(() => db.close());

	test("addJob persists; listJobs / getJob read it back", () => {
		const id = scheduler.addJob({
			name: "Daily",
			expression: "0 0 * * *",
			action: { type: "prompt", prompt: "hi" },
		});
		const jobs = scheduler.listJobs();
		expect(jobs.length).toBe(1);
		expect(jobs[0].id).toBe(id);
		expect(scheduler.getJob(id)?.name).toBe("Daily");
		expect(scheduler.getJob("missing")).toBeNull();
	});

	test("enable/disable/remove", () => {
		const id = scheduler.addJob({
			name: "J",
			expression: "0 0 * * *",
			action: { type: "prompt", prompt: "x" },
		});
		expect(scheduler.disableJob(id)).toBe(true);
		expect(scheduler.getJob(id)?.enabled).toBe(false);
		expect(scheduler.enableJob(id)).toBe(true);
		expect(scheduler.getJob(id)?.enabled).toBe(true);
		expect(scheduler.removeJob(id)).toBe(true);
		expect(scheduler.getJob(id)).toBeNull();
		expect(scheduler.removeJob(id)).toBe(false);
	});

	test("rejects a non-allowlisted event action", () => {
		expect(() =>
			scheduler.addJob({
				name: "evil",
				expression: "0 0 * * *",
				action: { type: "event", event: "kernel:shutdown" },
			}),
		).toThrow(/not in the allowlist/);
	});

	test("rejects an empty tool name", () => {
		expect(() =>
			scheduler.addJob({
				name: "t",
				expression: "0 0 * * *",
				action: { type: "tool", tool: "" },
			}),
		).toThrow(/empty tool name/);
	});

	test("jobs persist across a simulated restart (re-init from SQLite)", () => {
		scheduler.addJob({
			name: "survives",
			expression: "0 0 * * *",
			action: { type: "prompt", prompt: "x" },
		});
		// A fresh scheduler over the same DB sees the persisted job.
		const restarted = makeScheduler(db).scheduler;
		expect(restarted.listJobs().map((j) => j.name)).toEqual(["survives"]);
	});
});

describe("CronScheduler firing", () => {
	let db: Database;

	function dueJob(scheduler: CronScheduler, name: string, payload: unknown) {
		const id = scheduler.addJob({
			name,
			expression: "0 0 * * *",
			action: payload as never,
		});
		// Force it due in the past.
		db.run("UPDATE cron_jobs SET next_run = ? WHERE id = ?", [
			"2000-01-01T00:00:00.000Z",
			id,
		]);
		return id;
	}

	beforeEach(() => {
		db = freshDb();
	});
	afterEach(() => db.close());

	test("a due job fires its action and emits cron:executed", async () => {
		const { bus, scheduler } = makeScheduler(db);
		const fired: string[] = [];
		bus.on("cron:executed", (e) => {
			fired.push(e.jobName);
		});
		const prompts: string[] = [];
		scheduler.setPromptHandler(async (_id, p) => {
			prompts.push(p);
		});

		dueJob(scheduler, "ping", { type: "prompt", prompt: "do it" });
		await tick(scheduler);

		expect(prompts).toEqual(["do it"]);
		expect(fired).toEqual(["ping"]);
		// next_run advanced past the forced 2000 date.
		const next = db
			.query<{ next_run: string }, []>("SELECT next_run FROM cron_jobs")
			.get();
		expect(next && next.next_run > "2001").toBe(true);
	});

	test("one failing job doesn't kill the loop (misfire isolation)", async () => {
		const { bus, scheduler } = makeScheduler(db);
		const executed: string[] = [];
		const errored: string[] = [];
		bus.on("cron:executed", (e) => {
			executed.push(e.jobName);
		});
		bus.on("cron:error", (e) => {
			errored.push(e.jobId);
		});
		scheduler.setPromptHandler(async () => {});

		const badId = dueJob(scheduler, "bad", { type: "prompt", prompt: "x" });
		// Corrupt its payload so JSON.parse throws inside tick.
		db.run("UPDATE cron_jobs SET action_payload = ? WHERE id = ?", [
			"{not json",
			badId,
		]);
		dueJob(scheduler, "good", { type: "prompt", prompt: "ok" });

		await tick(scheduler);

		expect(executed).toEqual(["good"]); // good job still ran
		expect(errored).toEqual([badId]); // bad job reported, didn't throw out
	});

	test("disabled jobs do not fire", async () => {
		const { bus, scheduler } = makeScheduler(db);
		const fired: string[] = [];
		bus.on("cron:executed", (e) => {
			fired.push(e.jobName);
		});
		scheduler.setPromptHandler(async () => {});
		const id = dueJob(scheduler, "off", { type: "prompt", prompt: "x" });
		scheduler.disableJob(id);
		await tick(scheduler);
		expect(fired).toEqual([]);
	});
});
