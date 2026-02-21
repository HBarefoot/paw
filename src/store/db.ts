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
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}
