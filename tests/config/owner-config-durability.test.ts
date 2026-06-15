import { Database } from "bun:sqlite";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mergeLiveConfig } from "../../src/config/live-config.js";
import { loadConfig, securityEnvIds } from "../../src/config/loader.js";
import {
	replaceConfigOverride,
	saveConfigOverrides,
} from "../../src/config/writer.js";
import { createLogger } from "../../src/observability/logger.js";
import { AccessController } from "../../src/security/access-control.js";
import { recognizedIds } from "../../src/web/views/access-page.js";
import { scrubPawEnv } from "../helpers/env.js";

let restore: () => void;
let dir: string;

beforeAll(() => {
	restore = scrubPawEnv();
	dir = mkdtempSync(resolve(tmpdir(), "paw-owner-durability-"));
	process.env.PAW_CONFIG_DIR = dir;
});
afterAll(() => {
	restore();
	rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
	writeFileSync(join(dir, "config.json"), "{}", "utf-8");
});
afterEach(() => {
	// Drop the per-test PAW_SECURITY_* so they never leak across tests.
	for (const k of [
		"PAW_SECURITY_OWNER_USER_IDS",
		"PAW_SECURITY_ALLOWED_USERS",
		"PAW_SECURITY_BLOCKED_USERS",
	])
		delete process.env[k];
});

const newDb = (): Database => {
	const db = new Database(":memory:");
	db.run(
		`CREATE TABLE approved_users (user_id TEXT PRIMARY KEY, channel TEXT NOT NULL,
       approved_at TEXT NOT NULL DEFAULT (datetime('now')), approved_by TEXT)`,
	);
	return db;
};

// ── Part 1: PAW_SECURITY_* env overrides UNION after the file merge ──
describe("PAW_SECURITY_* env id lists union into the loaded config", () => {
	test("owner ids union with config.json (env never overridden), comma+whitespace parsed", () => {
		// config.json sets a DIFFERENT owner — env must add, not replace.
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ security: { ownerUserIds: ["U_CONFIG"] } }),
			"utf-8",
		);
		process.env.PAW_SECURITY_OWNER_USER_IDS = "U03H65TPZ1N, U999";
		const owners = loadConfig().security.ownerUserIds;
		expect(owners).toContain("U03H65TPZ1N");
		expect(owners).toContain("U999");
		// unioned, not replaced
		expect(owners).toContain("U_CONFIG");
	});

	test("env owners survive an EMPTY config.json ownerUserIds (the prod state)", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ security: { ownerUserIds: [] } }),
			"utf-8",
		);
		process.env.PAW_SECURITY_OWNER_USER_IDS = "U03H65TPZ1N";
		expect(loadConfig().security.ownerUserIds).toContain("U03H65TPZ1N");
	});

	test("allowed + blocked env lists also load; dedupe across env+config", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ security: { allowedUsers: ["U_A"] } }),
			"utf-8",
		);
		process.env.PAW_SECURITY_ALLOWED_USERS = "U_A U_B"; // whitespace-separated, U_A dup
		process.env.PAW_SECURITY_BLOCKED_USERS = "U_BAD";
		const sec = loadConfig().security;
		expect(sec.allowedUsers.sort()).toEqual(["U_A", "U_B"]); // deduped
		expect(sec.blockedUsers).toContain("U_BAD");
	});

	test("unset env → arrays unchanged (no spurious entries)", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ security: { ownerUserIds: ["U_ONLY"] } }),
			"utf-8",
		);
		expect(loadConfig().security.ownerUserIds).toEqual(["U_ONLY"]);
		expect(securityEnvIds()).toEqual({
			ownerUserIds: [],
			allowedUsers: [],
			blockedUsers: [],
		});
	});

	test("an env-only owner is recognized by AccessController with NO DB row", () => {
		process.env.PAW_SECURITY_OWNER_USER_IDS = "U03H65TPZ1N";
		const cfg = loadConfig();
		const db = newDb();
		const ac = new AccessController(db, createLogger("test"), {
			ownerUserIds: cfg.security.ownerUserIds,
		});
		expect(ac.isUserApproved("U03H65TPZ1N", "slack")).toBe(true);
		expect(
			db
				.prepare("SELECT user_id FROM approved_users WHERE user_id = ?")
				.get("U03H65TPZ1N"),
		).toBeNull();
		db.close();
	});
});

// ── Part 2: the runtime drop — liveConfig's merge must preserve sibling keys ──
describe("mergeLiveConfig preserves sibling security.* on a partial override", () => {
	// The CORE regression. Boot config carries owner/blocked/allowUnapproved from
	// defaults/env (NOT config.json). A Persist write persists ONLY
	// security.allowedUsers, so the live override object is partial. The prior
	// shallow `{...config, ...overrides}` replaced security wholesale → owner et al.
	// went undefined → /access showed no Owners and the owner got pairing-gated.
	const boot = () =>
		loadConfig({
			security: {
				ownerUserIds: ["U_OWNER"],
				blockedUsers: ["U_BLOCK"],
				allowUnapprovedExternal: true,
			},
		} as never);

	test("a Persist write (allowedUsers only) keeps ownerUserIds/blockedUsers/allowUnapprovedExternal", () => {
		const live = mergeLiveConfig(boot(), {
			security: { allowedUsers: ["U_NEW"] },
		});
		expect(live.security.allowedUsers).toContain("U_NEW");
		expect(live.security.ownerUserIds).toContain("U_OWNER");
		expect(live.security.blockedUsers).toContain("U_BLOCK");
		expect(live.security.allowUnapprovedExternal).toBe(true);
	});

	test("a Settings-style save of an unrelated key doesn't wipe security siblings", () => {
		const live = mergeLiveConfig(boot(), {
			ai: { model: "some-model" },
			security: { allowedUsers: ["U_NEW"] },
		});
		expect(live.security.ownerUserIds).toContain("U_OWNER");
		expect(live.ai.model).toBe("some-model");
	});

	test("env owners appear in liveConfig even when config.json omits them", () => {
		process.env.PAW_SECURITY_OWNER_USER_IDS = "U_ENV";
		// config.json wrote only allowedUsers (no ownerUserIds at all)
		const live = mergeLiveConfig(loadConfig(), {
			security: { allowedUsers: ["U_NEW"] },
		});
		expect(live.security.ownerUserIds).toContain("U_ENV");
		// …and recognizedIds (drives /access) surfaces the env owner
		expect(recognizedIds(live.security)).toContain("U_ENV");
	});

	test("other top-level keys keep wholesale-replace semantics (no accidental deep-merge)", () => {
		// mcpServers/agents express removals by replacing the whole map; mergeLiveConfig
		// must NOT deep-merge them or a removed entry would resurrect.
		const base = loadConfig({
			mcpServers: { a: { url: "x" }, b: { url: "y" } },
		} as never);
		const live = mergeLiveConfig(base, { mcpServers: { a: { url: "x" } } });
		expect(Object.keys(live.mcpServers ?? {})).toEqual(["a"]); // b removed, not merged back
	});
});

// ── Writer sanity: replace/save don't drop file-resident siblings (belt) ──
describe("config writer preserves file-resident sibling security.* keys", () => {
	test("replaceConfigOverride(allowedUsers) keeps a file ownerUserIds", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ security: { ownerUserIds: ["U_OWNER"] } }),
			"utf-8",
		);
		replaceConfigOverride("security.allowedUsers", ["U_NEW"]);
		const cfg = loadConfig();
		expect(cfg.security.ownerUserIds).toContain("U_OWNER");
		expect(cfg.security.allowedUsers).toContain("U_NEW");
	});

	test("saveConfigOverrides(unrelated key) keeps file security.*", () => {
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify({ security: { ownerUserIds: ["U_OWNER"] } }),
			"utf-8",
		);
		saveConfigOverrides({ ai: { model: "m2" } });
		expect(loadConfig().security.ownerUserIds).toContain("U_OWNER");
	});
});
