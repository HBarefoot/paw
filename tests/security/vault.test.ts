import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { VaultManager } from "../../src/security/vault.js";

function freshDb(): Database {
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

const KEY = VaultManager.generateKey(); // valid base64 32-byte key

describe("VaultManager", () => {
	let db: Database;
	beforeEach(() => {
		db = freshDb();
	});

	test("encrypt/decrypt round-trip", () => {
		const v = new VaultManager(db, { key: KEY });
		expect(v.enabled).toBe(true);
		v.set("stripe-key", "sk_live_abc123", "custom", "tester");
		expect(v.get("stripe-key")).toBe("sk_live_abc123");
	});

	test("ciphertext is not stored in plaintext", () => {
		const v = new VaultManager(db, { key: KEY });
		v.set("secret", "super-secret-value");
		const row = db
			.query("SELECT ciphertext FROM vault_secrets WHERE name = ?")
			.get("secret") as { ciphertext: string };
		expect(row.ciphertext).not.toContain("super-secret-value");
	});

	test("set is an upsert (rotation)", () => {
		const v = new VaultManager(db, { key: KEY });
		v.set("k", "v1");
		v.set("k", "v2");
		expect(v.get("k")).toBe("v2");
		expect(v.list()).toHaveLength(1);
	});

	test("has / delete / list metadata (never values)", () => {
		const v = new VaultManager(db, { key: KEY });
		v.set("a.token", "x", "strapi", "tester");
		expect(v.has("a.token")).toBe(true);
		const meta = v.list();
		expect(meta).toHaveLength(1);
		expect(meta[0]).toMatchObject({
			name: "a.token",
			scope: "strapi",
			updatedBy: "tester",
		});
		// metadata must not leak the value
		expect(JSON.stringify(meta)).not.toContain('"x"');
		v.delete("a.token");
		expect(v.has("a.token")).toBe(false);
	});

	test("invalid secret name is rejected", () => {
		const v = new VaultManager(db, { key: KEY });
		expect(() => v.set("bad name!", "x")).toThrow(/Invalid secret name/);
	});

	test("a wrong key cannot decrypt (fails closed)", () => {
		const v1 = new VaultManager(db, { key: KEY });
		v1.set("k", "v");
		const v2 = new VaultManager(db, { key: VaultManager.generateKey() });
		expect(v2.get("k")).toBeUndefined();
	});

	describe("disabled mode (no key)", () => {
		test("enabled=false and reads return undefined", () => {
			const v = new VaultManager(db, { key: undefined });
			expect(v.enabled).toBe(false);
			expect(v.get("anything")).toBeUndefined();
			expect(v.count()).toBe(0);
		});

		test("writes throw a clear error", () => {
			const v = new VaultManager(db, { key: "" });
			expect(() => v.set("k", "v")).toThrow(/disabled/);
		});

		test("an invalid (non-32-byte) key disables the vault", () => {
			const v = new VaultManager(db, {
				key: Buffer.from("short").toString("base64"),
			});
			expect(v.enabled).toBe(false);
		});

		test("overlayConfig is a no-op and leaves config untouched", () => {
			const v = new VaultManager(db, { key: undefined });
			const cfg: Record<string, unknown> = { ai: { apiKey: "from-env" } };
			v.overlayConfig(cfg);
			expect((cfg.ai as { apiKey: string }).apiKey).toBe("from-env");
		});
	});

	describe("resolveString", () => {
		test("replaces vault:// tokens with secrets", () => {
			const v = new VaultManager(db, { key: KEY });
			v.set("dbpass", "hunter2");
			expect(v.resolveString("postgres://u:vault://dbpass@host")).toBe(
				"postgres://u:hunter2@host",
			);
		});

		test("leaves unknown refs untouched", () => {
			const v = new VaultManager(db, { key: KEY });
			expect(v.resolveString("x vault://missing y")).toBe(
				"x vault://missing y",
			);
		});
	});

	describe("overlayConfig", () => {
		test("vault values win over env for known slots", () => {
			const v = new VaultManager(db, { key: KEY });
			v.set("ai.apiKey", "vault-anthropic", "ai");
			v.set("slack.botToken", "vault-slack", "slack");
			const cfg: Record<string, unknown> = {
				ai: { apiKey: "env-anthropic" },
				slack: {
					botToken: "env-slack",
					appToken: "keep",
					signingSecret: "keep",
				},
			};
			v.overlayConfig(cfg);
			expect((cfg.ai as { apiKey: string }).apiKey).toBe("vault-anthropic");
			expect((cfg.slack as { botToken: string }).botToken).toBe("vault-slack");
			// untouched slots keep their env value
			expect((cfg.slack as { appToken: string }).appToken).toBe("keep");
		});

		test("missing vault slot keeps the existing env value", () => {
			const v = new VaultManager(db, { key: KEY });
			const cfg: Record<string, unknown> = { ai: { apiKey: "env-only" } };
			v.overlayConfig(cfg);
			expect((cfg.ai as { apiKey: string }).apiKey).toBe("env-only");
		});

		test("per-MCP-server authToken overlay", () => {
			const v = new VaultManager(db, { key: KEY });
			v.set("mcp.myserver.authToken", "vault-bearer", "mcp");
			const cfg: Record<string, unknown> = {
				mcpServers: { myserver: { url: "https://x", authToken: "env-bearer" } },
			};
			v.overlayConfig(cfg);
			expect(
				(cfg.mcpServers as { myserver: { authToken: string } }).myserver
					.authToken,
			).toBe("vault-bearer");
		});

		test("deep-resolves vault:// refs anywhere in the config tree", () => {
			const v = new VaultManager(db, { key: KEY });
			v.set("webhookSecret", "wh_123");
			const cfg: Record<string, unknown> = {
				n8n: {
					endpoints: [{ url: "https://n8n/x?token=vault://webhookSecret" }],
				},
			};
			v.overlayConfig(cfg);
			const url = (cfg.n8n as { endpoints: { url: string }[] }).endpoints[0]
				.url;
			expect(url).toBe("https://n8n/x?token=wh_123");
		});
	});

	test("generateKey produces a 32-byte base64 key", () => {
		const k = VaultManager.generateKey();
		expect(Buffer.from(k, "base64")).toHaveLength(32);
		expect(VaultManager.keyIsValid(k)).toBe(true);
		expect(VaultManager.keyIsValid("nope")).toBe(false);
	});
});
