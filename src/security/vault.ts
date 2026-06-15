/**
 * Credential vault — web-managed, encrypted-at-rest secrets that replace
 * scattered PAW_* env vars and the plaintext ~/.paw/credentials.json.
 *
 * Design (see plan): AES-256-GCM with a single master key from the
 * `PAW_VAULT_KEY` env var (base64, 32 bytes). Ciphertext lives in the
 * `vault_secrets` SQLite table on the persistent /data volume. Resolution is
 * **server-side only** — secrets are decrypted when wiring integrations and
 * never reach the model, the chat stream, or the canvas iframe. There is
 * deliberately NO read tool.
 *
 * If `PAW_VAULT_KEY` is missing/invalid the vault is DISABLED: reads return
 * undefined and writes throw, so the app keeps booting on the existing
 * env/credentials fallback. Resolution order ends up: vault → env → defaults
 * (the loader already produced env/credentials values; overlayConfig wins over
 * them when a secret is present in the vault).
 */

import type { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Logical grouping for a secret — drives UI sections and the import mapping. */
export type VaultScope =
	| "ai"
	| "slack"
	| "strapi"
	| "hubspot"
	| "mcp"
	| "n8n"
	| "github"
	| "supabase"
	| "wordpress"
	| "vercel"
	| "posthog"
	| "custom";

export interface VaultSecretMeta {
	name: string;
	scope: VaultScope;
	updatedAt: string;
	updatedBy: string | null;
}

/**
 * Canonical names for the "known slot" secrets that overlayConfig() wires into
 * the live config. Custom secrets (referenced via `vault://<name>`) can use any
 * name matching NAME_RE. Per-MCP-server tokens use `mcp.<server>.authToken`.
 */
export const KNOWN_SECRET_SLOTS: {
	name: string;
	scope: VaultScope;
	label: string;
}[] = [
	{ name: "ai.apiKey", scope: "ai", label: "Anthropic (Claude) API key" },
	{
		name: "api.bearerToken",
		scope: "custom",
		label: "OpenAI-compatible API bearer token",
	},
	{ name: "openai.apiKey", scope: "ai", label: "OpenAI API key" },
	{ name: "gemini.apiKey", scope: "ai", label: "Gemini API key" },
	{ name: "ollama.apiKey", scope: "ai", label: "Ollama cloud API key" },
	{ name: "slack.botToken", scope: "slack", label: "Slack bot token" },
	{ name: "slack.appToken", scope: "slack", label: "Slack app token" },
	{
		name: "slack.signingSecret",
		scope: "slack",
		label: "Slack signing secret",
	},
	{
		name: "slack.notifyChannel",
		scope: "slack",
		label: "Slack notify channel (e.g. #ai-operations id)",
	},
	{ name: "strapi.token", scope: "strapi", label: "Strapi API token" },
	{
		name: "hubspot.token",
		scope: "hubspot",
		label: "HubSpot private-app token",
	},
	{ name: "n8n.token", scope: "n8n", label: "n8n API token" },
	{
		name: "github.appPrivateKey",
		scope: "github",
		label: "GitHub App private key (PEM)",
	},
	{
		name: "github.webhookSecret",
		scope: "github",
		label: "GitHub webhook signing secret",
	},
	{
		name: "supabase.serviceKey",
		scope: "supabase",
		label: "Supabase service-role key",
	},
	{
		name: "supabase.builderDsn",
		scope: "supabase",
		label: "Supabase paw_builder DSN (scoped DDL role)",
	},
	{
		name: "wordpress.appPassword",
		scope: "wordpress",
		label: "WordPress Application Password",
	},
	{
		name: "vercel.token",
		scope: "vercel",
		label: "Vercel API token",
	},
	{
		name: "posthog.personalApiKey",
		scope: "posthog",
		label: "PostHog Personal API key (read API)",
	},
];

/** Secret names: letters, digits, dot, dash, underscore. Used in vault:// refs. */
const NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** `vault://<name>` reference tokens embedded in string config values. */
const REF_RE = /vault:\/\/([A-Za-z0-9._-]{1,128})/g;

interface SecretRow {
	name: string;
	ciphertext: string;
	iv: string;
	tag: string;
	scope: string;
	updated_at: string;
	updated_by: string | null;
}

export class VaultManager {
	private db: Database;
	private key: Buffer | null;
	readonly enabled: boolean;

	constructor(db: Database, opts?: { key?: string }) {
		this.db = db;
		this.key = VaultManager.parseKey(opts?.key ?? process.env.PAW_VAULT_KEY);
		this.enabled = this.key !== null;
	}

	/** Decode and validate a base64 32-byte master key; null if absent/invalid. */
	private static parseKey(raw: string | undefined): Buffer | null {
		if (!raw) return null;
		try {
			const buf = Buffer.from(raw.trim(), "base64");
			return buf.length === 32 ? buf : null;
		} catch {
			return null;
		}
	}

	/** Generate a fresh base64 master key (for `openssl rand -base64 32` parity). */
	static generateKey(): string {
		return randomBytes(32).toString("base64");
	}

	/** True if the supplied env value is a usable key (without constructing). */
	static keyIsValid(raw: string | undefined): boolean {
		return VaultManager.parseKey(raw) !== null;
	}

	/** Store/rotate a secret. Throws if the vault is disabled or name invalid. */
	set(
		name: string,
		value: string,
		scope: VaultScope = "custom",
		updatedBy: string | null = null,
	): void {
		const key = this.key;
		if (!key)
			throw new Error(
				"Vault is disabled: set PAW_VAULT_KEY (base64, 32 bytes) to enable encrypted secrets.",
			);
		if (!NAME_RE.test(name)) throw new Error(`Invalid secret name: ${name}`);
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		this.db
			.query(
				`INSERT INTO vault_secrets (name, ciphertext, iv, tag, scope, updated_at, updated_by)
				 VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
				 ON CONFLICT(name) DO UPDATE SET
				   ciphertext=excluded.ciphertext, iv=excluded.iv, tag=excluded.tag,
				   scope=excluded.scope, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
			)
			.run(
				name,
				ct.toString("base64"),
				iv.toString("base64"),
				tag.toString("base64"),
				scope,
				updatedBy,
			);
	}

	/** Decrypt a secret. Returns undefined if disabled, missing, or tampered. */
	get(name: string): string | undefined {
		if (!this.key) return undefined;
		const row = this.db
			.query("SELECT * FROM vault_secrets WHERE name = ?")
			.get(name) as SecretRow | null;
		if (!row) return undefined;
		try {
			const iv = Buffer.from(row.iv, "base64");
			const tag = Buffer.from(row.tag, "base64");
			const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
			decipher.setAuthTag(tag);
			return Buffer.concat([
				decipher.update(Buffer.from(row.ciphertext, "base64")),
				decipher.final(),
			]).toString("utf8");
		} catch {
			// Wrong key (rotated PAW_VAULT_KEY) or tampered row — fail closed.
			return undefined;
		}
	}

	has(name: string): boolean {
		const row = this.db
			.query("SELECT 1 FROM vault_secrets WHERE name = ?")
			.get(name);
		return row !== null && row !== undefined;
	}

	delete(name: string): void {
		this.db.query("DELETE FROM vault_secrets WHERE name = ?").run(name);
	}

	/** Metadata for every secret — names + scope + timestamps, never values. */
	list(): VaultSecretMeta[] {
		const rows = this.db
			.query(
				"SELECT name, scope, updated_at, updated_by FROM vault_secrets ORDER BY scope, name",
			)
			.all() as Pick<
			SecretRow,
			"name" | "scope" | "updated_at" | "updated_by"
		>[];
		return rows.map((r) => ({
			name: r.name,
			scope: r.scope as VaultScope,
			updatedAt: r.updated_at,
			updatedBy: r.updated_by,
		}));
	}

	/** Number of stored secrets (for the boot banner). */
	count(): number {
		if (!this.enabled) return 0;
		const r = this.db
			.query("SELECT COUNT(*) AS n FROM vault_secrets")
			.get() as { n: number };
		return r.n;
	}

	/**
	 * Replace every `vault://<name>` token inside a string with its secret.
	 * Unknown/unresolvable refs are left untouched so the problem is visible
	 * rather than silently turning into an empty credential.
	 */
	resolveString(input: string): string {
		if (!this.key || !input.includes("vault://")) return input;
		return input.replace(REF_RE, (whole, name: string) => {
			const v = this.get(name);
			return v ?? whole;
		});
	}

	/**
	 * Overlay vault secrets onto the live config IN PLACE, winning over the
	 * env/credentials values the loader already produced. Runs once at kernel
	 * construction, before any subsystem (providers, plugins, MCP, Strapi,
	 * HubSpot) reads its credentials. Also deep-resolves `vault://` refs in any
	 * string value (so custom secrets can be referenced from MCP urls/headers,
	 * n8n endpoints, etc.).
	 */
	overlayConfig(config: Record<string, any>): void {
		if (!this.key) return;
		const apply = (name: string, set: (v: string) => void): void => {
			const v = this.get(name);
			if (v) set(v);
		};

		apply("ai.apiKey", (v) => {
			if (config.ai) config.ai.apiKey = v;
		});
		apply("api.bearerToken", (v) => {
			if (config.api) config.api.bearerToken = v;
		});
		apply("openai.apiKey", (v) => {
			if (config.openai) config.openai.apiKey = v;
		});
		apply("gemini.apiKey", (v) => {
			if (config.gemini) config.gemini.apiKey = v;
		});
		apply("ollama.apiKey", (v) => {
			if (config.ollama) config.ollama.apiKey = v;
		});
		apply("slack.botToken", (v) => {
			if (config.slack) config.slack.botToken = v;
		});
		apply("slack.appToken", (v) => {
			if (config.slack) config.slack.appToken = v;
		});
		apply("slack.signingSecret", (v) => {
			if (config.slack) config.slack.signingSecret = v;
		});
		apply("slack.notifyChannel", (v) => {
			if (config.slack) config.slack.notifyChannel = v;
		});
		apply("strapi.token", (v) => {
			if (config.strapi) config.strapi.token = v;
		});
		apply("hubspot.token", (v) => {
			if (config.hubspot) config.hubspot.token = v;
		});
		apply("n8n.token", (v) => {
			if (config.n8n) config.n8n.token = v;
		});
		apply("github.appPrivateKey", (v) => {
			if (config.github) config.github.privateKey = v;
		});
		apply("github.webhookSecret", (v) => {
			if (config.github) config.github.webhookSecret = v;
		});
		apply("supabase.serviceKey", (v) => {
			if (config.supabase) config.supabase.serviceKey = v;
		});
		apply("supabase.builderDsn", (v) => {
			if (config.supabase) config.supabase.builderDsn = v;
		});
		apply("wordpress.appPassword", (v) => {
			if (config.wordpress) config.wordpress.appPassword = v;
		});
		apply("posthog.personalApiKey", (v) => {
			if (config.posthog) config.posthog.personalApiKey = v;
		});
		apply("vercel.token", (v) => {
			if (config.vercel) config.vercel.token = v;
		});

		// Per-MCP-server bearer tokens: vault name `mcp.<server>.authToken`.
		const servers = config.mcpServers as
			| Record<string, { authToken?: string }>
			| undefined;
		if (servers) {
			for (const [serverName, sc] of Object.entries(servers)) {
				apply(`mcp.${serverName}.authToken`, (v) => {
					sc.authToken = v;
				});
			}
		}

		// Arbitrary `vault://name` references anywhere in the config tree.
		this.resolveDeep(config);
	}

	/** Recursively rewrite `vault://` refs in every string leaf (mutates). */
	private resolveDeep(node: unknown): void {
		if (!node || typeof node !== "object") return;
		const obj = node as Record<string, unknown>;
		for (const k of Object.keys(obj)) {
			const v = obj[k];
			if (typeof v === "string") {
				if (v.includes("vault://")) obj[k] = this.resolveString(v);
			} else if (v && typeof v === "object") {
				this.resolveDeep(v);
			}
		}
	}
}
