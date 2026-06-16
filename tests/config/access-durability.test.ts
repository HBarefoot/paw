import { Database } from "bun:sqlite";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config/loader.js";
import { replaceConfigOverride } from "../../src/config/writer.js";
import { createLogger } from "../../src/observability/logger.js";
import { AccessController } from "../../src/security/access-control.js";
import { scrubPawEnv } from "../helpers/env.js";

let restore: () => void;
let dir: string;

beforeAll(() => {
	restore = scrubPawEnv();
	dir = mkdtempSync(resolve(tmpdir(), "paw-access-durability-"));
	process.env.PAW_CONFIG_DIR = dir;
});
afterAll(() => {
	restore();
	rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
	// start each test from an empty overrides file
	writeFileSync(join(dir, "config.json"), "{}", "utf-8");
	delete process.env.PAW_DB_PATH;
});

// The /access "Persist" action's durable effect: write the id to
// security.allowedUsers, which isUserApproved honors BEFORE the DB — so the user
// is recognized even with no approved_users row (i.e. after an ephemeral-DB reset).
describe("persist-to-config makes an approval survive a DB reset", () => {
	test("replaceConfigOverride(security.allowedUsers) round-trips and is honored with no DB row", () => {
		replaceConfigOverride("security.allowedUsers", ["U03H65TPZ1N"]);
		const cfg = loadConfig();
		expect(cfg.security.allowedUsers).toContain("U03H65TPZ1N");

		// Fresh kernel/AccessController built from the persisted config, EMPTY DB.
		const db = new Database(":memory:");
		db.run(
			`CREATE TABLE approved_users (user_id TEXT PRIMARY KEY, channel TEXT NOT NULL,
       approved_at TEXT NOT NULL DEFAULT (datetime('now')), approved_by TEXT)`,
		);
		const ac = new AccessController(db, createLogger("test"), {
			allowedUsers: cfg.security.allowedUsers,
		});
		expect(ac.isUserApproved("U03H65TPZ1N", "slack")).toBe(true);
		// ...with no approved_users row at all.
		expect(
			db
				.prepare("SELECT user_id FROM approved_users WHERE user_id = ?")
				.get("U03H65TPZ1N"),
		).toBeNull();
		db.close();
	});

	// The Persist write must not clobber other security.* keys it shares the
	// subtree with — requireApproval / ownerUserIds / allowUnapprovedExternal must
	// survive a later allowedUsers write (setAtPath sets only the leaf).
	test("persisting allowedUsers preserves sibling security.* keys", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({
				security: {
					requireApproval: true,
					ownerUserIds: ["U_OWNER"],
					allowUnapprovedExternal: false,
				},
			}),
			"utf-8",
		);
		replaceConfigOverride("security.allowedUsers", ["U_NEW"]);
		const cfg = loadConfig();
		expect(cfg.security.allowedUsers).toContain("U_NEW");
		expect(cfg.security.ownerUserIds).toContain("U_OWNER");
		expect(cfg.security.requireApproval).toBe(true);
		expect(cfg.security.allowUnapprovedExternal).toBe(false);
	});
});

// Infra-path guard: PAW_DB_PATH must WIN over a config.json store.dbPath so the
// SQLite DB lands on the persistent volume and isn't wiped each redeploy.
describe("store.dbPath resolution (PAW_DB_PATH wins)", () => {
	test("PAW_DB_PATH overrides a config.json store.dbPath", () => {
		// A stale config.json points the DB at an off-volume relative path...
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ store: { dbPath: "./data/paw.db" } }),
			"utf-8",
		);
		// ...but the deploy sets the persistent path via env.
		process.env.PAW_DB_PATH = "/data/paw.db";
		expect(loadConfig().store.dbPath).toBe("/data/paw.db");
	});

	test("without PAW_DB_PATH the config.json value stands (no infra override)", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ store: { dbPath: "/custom/paw.db" } }),
			"utf-8",
		);
		expect(loadConfig().store.dbPath).toBe("/custom/paw.db");
	});
});

// Infra-path guard: PAW_PLAYBOOKS_ROOT must WIN over a config.json
// workspace.playbooksRoot so runtime-authored playbooks land on the persistent
// volume and aren't wiped each redeploy (mirrors the PAW_DB_PATH guard).
describe("workspace.playbooksRoot resolution (PAW_PLAYBOOKS_ROOT wins)", () => {
	beforeEach(() => {
		delete process.env.PAW_PLAYBOOKS_ROOT;
	});

	test("PAW_PLAYBOOKS_ROOT overrides a config.json workspace.playbooksRoot", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ workspace: { playbooksRoot: "./playbooks" } }),
			"utf-8",
		);
		process.env.PAW_PLAYBOOKS_ROOT = "/data/playbooks";
		expect(loadConfig().workspace.playbooksRoot).toBe("/data/playbooks");
		delete process.env.PAW_PLAYBOOKS_ROOT;
	});

	test("without PAW_PLAYBOOKS_ROOT the config.json value stands", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ workspace: { playbooksRoot: "/custom/playbooks" } }),
			"utf-8",
		);
		expect(loadConfig().workspace.playbooksRoot).toBe("/custom/playbooks");
	});
});
