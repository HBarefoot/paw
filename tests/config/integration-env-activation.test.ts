import { Database } from "bun:sqlite";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../../src/config/loader.js";
import { VaultManager } from "../../src/security/vault.js";
import { scrubPawEnv } from "../helpers/env.js";

// loadConfig reads PAW_* env + ~/.paw/config.json + credentials. Scrub the env
// and point PAW_CONFIG_DIR at an empty temp dir so activation is driven purely
// by the env vars each test sets — hermetic regardless of the dev's machine.
let restorePawEnv: () => void;
let tmpConfigDir: string;

const INTEGRATION_VARS = [
	"PAW_HUBSPOT_TOKEN",
	"PAW_SUPABASE_URL",
	"PAW_SUPABASE_SERVICE_KEY",
	"PAW_WORDPRESS_URL",
	"PAW_WORDPRESS_USERNAME",
	"PAW_WORDPRESS_APP_PASSWORD",
	"PAW_VISION_PROVIDER",
	"PAW_VISION_MODEL",
];

beforeAll(() => {
	restorePawEnv = scrubPawEnv();
	tmpConfigDir = mkdtempSync(resolve(tmpdir(), "paw-envact-"));
	process.env.PAW_CONFIG_DIR = tmpConfigDir;
});
afterAll(() => {
	restorePawEnv();
	rmSync(tmpConfigDir, { recursive: true, force: true });
});
afterEach(() => {
	for (const v of INTEGRATION_VARS) delete process.env[v];
});

function freshVaultDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE vault_secrets (
			name TEXT PRIMARY KEY,
			ciphertext TEXT NOT NULL,
			iv TEXT NOT NULL,
			tag TEXT NOT NULL,
			scope TEXT NOT NULL DEFAULT 'custom',
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_by TEXT
		);
	`);
	return db;
}

describe("integration activation from env", () => {
	test("PAW_HUBSPOT_TOKEN enables hubspot with the token", () => {
		process.env.PAW_HUBSPOT_TOKEN = "pat-xyz";
		const c = loadConfig();
		expect(c.hubspot.enabled).toBe(true);
		expect(c.hubspot.token).toBe("pat-xyz");
	});

	test("supabase: both vars enable it with the values", () => {
		process.env.PAW_SUPABASE_URL = "https://ref.supabase.co";
		process.env.PAW_SUPABASE_SERVICE_KEY = "svc-key";
		const c = loadConfig();
		expect(c.supabase.enabled).toBe(true);
		expect(c.supabase.url).toBe("https://ref.supabase.co");
		expect(c.supabase.serviceKey).toBe("svc-key");
	});

	test("supabase: url alone leaves it disabled at defaults", () => {
		process.env.PAW_SUPABASE_URL = "https://ref.supabase.co";
		const c = loadConfig();
		expect(c.supabase.enabled).toBe(false);
		expect(c.supabase.url).toBe(""); // untouched default
	});

	test("wordpress: all three vars enable it with the values", () => {
		process.env.PAW_WORDPRESS_URL = "https://example.com";
		process.env.PAW_WORDPRESS_USERNAME = "admin";
		process.env.PAW_WORDPRESS_APP_PASSWORD = "app pass word";
		const c = loadConfig();
		expect(c.wordpress.enabled).toBe(true);
		expect(c.wordpress.url).toBe("https://example.com");
		expect(c.wordpress.username).toBe("admin");
		expect(c.wordpress.appPassword).toBe("app pass word");
	});

	test("wordpress: two of three leaves it disabled at defaults", () => {
		process.env.PAW_WORDPRESS_URL = "https://example.com";
		process.env.PAW_WORDPRESS_USERNAME = "admin";
		const c = loadConfig();
		expect(c.wordpress.enabled).toBe(false);
		expect(c.wordpress.username).toBe(""); // untouched default
	});

	test("vision: both vars set ai.vision", () => {
		process.env.PAW_VISION_PROVIDER = "claude";
		process.env.PAW_VISION_MODEL = "claude-sonnet-4-5-20250929";
		const c = loadConfig();
		expect(c.ai.vision).toBeDefined();
		expect(c.ai.vision?.provider).toBe("claude");
		expect(c.ai.vision?.model).toBe("claude-sonnet-4-5-20250929");
		expect(c.ai.vision?.enabled).toBe(true);
	});

	test("vision: provider alone leaves ai.vision unset", () => {
		process.env.PAW_VISION_PROVIDER = "claude";
		const c = loadConfig();
		expect(c.ai.vision).toBeUndefined();
	});

	test("no integration env vars → integrations at their defaults", () => {
		const c = loadConfig();
		expect(c.hubspot.enabled).toBe(false);
		expect(c.supabase.enabled).toBe(false);
		expect(c.wordpress.enabled).toBe(false);
		expect(c.ai.vision).toBeUndefined();
	});

	test("vault overlay beats the env-provided secret", () => {
		// Env activates hubspot and supplies a token...
		process.env.PAW_HUBSPOT_TOKEN = "env-token";
		const c = loadConfig();
		expect(c.hubspot.token).toBe("env-token");

		// ...but a vault secret for the same slot wins (overlayConfig runs after
		// the loader, in the kernel). Verified, not assumed.
		const vault = new VaultManager(freshVaultDb(), {
			key: VaultManager.generateKey(),
		});
		vault.set("hubspot.token", "vault-token", "hubspot");
		vault.overlayConfig(c as unknown as Record<string, unknown>);
		expect(c.hubspot.enabled).toBe(true); // still enabled
		expect(c.hubspot.token).toBe("vault-token");
	});
});
