import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import * as sqliteVec from "sqlite-vec";

let db: Database | null = null;
let customSqliteLoaded = false;

function loadCustomSqlite(customPath?: string): void {
	if (customSqliteLoaded) return;
	const sqlitePath =
		customPath ??
		(process.platform === "darwin"
			? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib"
			: undefined);
	if (sqlitePath && existsSync(sqlitePath)) {
		try {
			Database.setCustomSQLite(sqlitePath);
		} catch {
			// SQLite may already be loaded (e.g. if another Database was created before us)
		}
	}
	customSqliteLoaded = true;
}

export function getDb(dbPath: string, customSqlitePath?: string): Database {
	if (db) return db;

	loadCustomSqlite(customSqlitePath);
	mkdirSync(dirname(dbPath), { recursive: true });
	db = new Database(dbPath, { create: true });
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	try {
		sqliteVec.load(db);
	} catch {
		// sqlite-vec requires custom SQLite with extension support.
		// Falls back gracefully — vector search will be unavailable.
	}
	runMigrations(db);
	return db;
}

function runMigrations(db: Database): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      tool_use_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS plugin_kv (
      plugin TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (plugin, key)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      category TEXT NOT NULL CHECK(category IN ('fact','preference','decision','summary')),
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expression TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      action_type TEXT NOT NULL CHECK(action_type IN ('prompt','tool','event')),
      action_payload TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      next_run TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cron_due
      ON cron_jobs(enabled, next_run);

    CREATE TABLE IF NOT EXISTS approved_users (
      user_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      user_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS web_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES web_admins(id),
      expires_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      user_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

    CREATE TABLE IF NOT EXISTS canvas_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_canvas_versions_path ON canvas_versions(path, created_at DESC);
  `);

	// Add title column to sessions (migration-safe)
	try {
		db.exec("ALTER TABLE sessions ADD COLUMN title TEXT");
	} catch {
		// Column already exists
	}

	// Branching: a forked session points back to its parent + anchor message.
	try {
		db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT");
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE sessions ADD COLUMN fork_source_message_id TEXT");
	} catch {
		// Column already exists
	}

	// Memory enhancements: confidence, access tracking, supersession
	try {
		db.exec(
			"ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0",
		);
	} catch {
		// Column already exists
	}
	try {
		db.exec(
			"ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0",
		);
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE memories ADD COLUMN last_accessed_at TEXT");
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE memories ADD COLUMN superseded_by TEXT");
	} catch {
		// Column already exists
	}

	// Memory relationship links
	db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL CHECK(link_type IN ('related','contradicts','supersedes','refines')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id);
  `);

	// FTS5 for memory full-text search
	db.exec(
		`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='rowid');`,
	);

	// Triggers to keep FTS in sync
	db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);

	// sqlite-vec virtual table for vector similarity search
	try {
		db.exec(
			`CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[384]);`,
		);
	} catch {
		// vec0 not available — vector search will be disabled
	}

	// Proactive trigger columns on cron_jobs
	try {
		db.exec(
			"ALTER TABLE cron_jobs ADD COLUMN is_proactive INTEGER NOT NULL DEFAULT 0",
		);
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE cron_jobs ADD COLUMN action_condition TEXT");
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE cron_jobs ADD COLUMN data_source TEXT");
	} catch {
		// Column already exists
	}
	try {
		db.exec("ALTER TABLE cron_jobs ADD COLUMN last_data_hash TEXT");
	} catch {
		// Column already exists
	}

	// Usage/cost tracking
	db.exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      estimated_cost_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_log_session ON usage_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_log_created ON usage_log(created_at);
  `);

	// Feedback table for learning loop
	db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL CHECK(feedback_type IN ('rating','regeneration','correction')),
      value TEXT NOT NULL,
      original_content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback(session_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

    -- Tool execution log: observability over every tool call so the admin
    -- UI can surface failures, slow runs, and misuse.
    CREATE TABLE IF NOT EXISTS tool_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      plugin TEXT,
      input_preview TEXT,
      output_preview TEXT,
      is_error INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tool_log_created ON tool_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_log_tool ON tool_log(tool_name);
    CREATE INDEX IF NOT EXISTS idx_tool_log_session ON tool_log(session_id);

    -- Reusable prompt library: user-curated snippets insertable from chat.
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_title ON prompts(title);
    CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at DESC);
  `);

	// --- Full-text search over conversation messages ---
	// External-content FTS5 table so we don't duplicate message content,
	// plus triggers that keep it in sync on insert/update/delete.
	try {
		db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid',
        tokenize='porter unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

		// Backfill any existing messages that predate the trigger.
		const ftsCount = db
			.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM messages_fts")
			.get();
		const msgCount = db
			.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM messages")
			.get();
		if ((ftsCount?.n ?? 0) < (msgCount?.n ?? 0)) {
			db.exec(
				"INSERT INTO messages_fts(messages_fts) VALUES('rebuild');",
			);
		}
	} catch {
		// FTS5 not available — search endpoint will degrade to LIKE fallback.
	}

	// Webhooks table
	db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      secret TEXT,
      description TEXT DEFAULT '',
      event_type TEXT NOT NULL DEFAULT 'webhook:inbound',
      active INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      trigger_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'ok',
      headers_json TEXT,
      body_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id, created_at DESC);
  `);
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}
