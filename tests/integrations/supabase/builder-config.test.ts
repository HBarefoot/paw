import { Database } from "bun:sqlite";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	KNOWN_SECRET_SLOTS,
	VaultManager,
} from "../../../src/security/vault.js";
import { scrubPawEnv } from "../../helpers/env.js";

// The builder DSN is a NEW vault slot, separate from the service key (blast-
// radius separation). Prove the plumbing round-trips: the slot is registered,
// and overlayConfig() lands it on config.supabase.builderDsn — server-side only,
// exactly like supabase.serviceKey.

let restorePawEnv: () => void;
beforeAll(() => {
	restorePawEnv = scrubPawEnv();
});
afterAll(() => restorePawEnv());

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

const KEY = VaultManager.generateKey();
const DSN = "postgres://paw_builder:s3cr3t@db.proj.supabase.co:5432/postgres";

describe("supabase.builderDsn — config + vault plumbing", () => {
	let db: Database;
	beforeEach(() => {
		db = freshDb();
	});

	test("is a registered known vault slot under the supabase scope", () => {
		const slot = KNOWN_SECRET_SLOTS.find(
			(s) => s.name === "supabase.builderDsn",
		);
		expect(slot).toBeDefined();
		expect(slot?.scope).toBe("supabase");
		// And it is a DISTINCT slot from the service key.
		expect(
			KNOWN_SECRET_SLOTS.some((s) => s.name === "supabase.serviceKey"),
		).toBe(true);
	});

	test("overlayConfig lands the DSN on config.supabase.builderDsn", () => {
		const v = new VaultManager(db, { key: KEY });
		v.set("supabase.builderDsn", DSN, "supabase", "tester");
		const config: Record<string, unknown> = {
			supabase: {
				enabled: true,
				url: "https://proj.supabase.co",
				builderDsn: "",
			},
		};
		v.overlayConfig(config);
		expect((config.supabase as { builderDsn: string }).builderDsn).toBe(DSN);
	});

	test("builderDsn and serviceKey overlay independently", () => {
		const v = new VaultManager(db, { key: KEY });
		v.set("supabase.serviceKey", "service-role-key", "supabase");
		v.set("supabase.builderDsn", DSN, "supabase");
		const config: Record<string, unknown> = {
			supabase: { enabled: true, serviceKey: "", builderDsn: "" },
		};
		v.overlayConfig(config);
		const sb = config.supabase as { serviceKey: string; builderDsn: string };
		expect(sb.serviceKey).toBe("service-role-key");
		expect(sb.builderDsn).toBe(DSN);
	});

	test("a vault:// reference to the slot resolves", () => {
		const v = new VaultManager(db, { key: KEY });
		v.set("supabase.builderDsn", DSN, "supabase");
		expect(v.resolveString("vault://supabase.builderDsn")).toBe(DSN);
	});
});
