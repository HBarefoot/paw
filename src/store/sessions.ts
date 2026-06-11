import type { Database } from "bun:sqlite";

export interface Session {
	id: string;
	channel: string;
	user_id: string;
	title: string | null;
	created_at: string;
	updated_at: string;
}

export function getOrCreateSession(
	db: Database,
	id: string,
	channel: string,
	userId: string,
): Session {
	const existing = db
		.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?")
		.get(id);
	if (existing) {
		db.run("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?", [
			id,
		]);
		return { ...existing, updated_at: new Date().toISOString() };
	}

	db.run("INSERT INTO sessions (id, channel, user_id) VALUES (?, ?, ?)", [
		id,
		channel,
		userId,
	]);
	return db
		.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?")
		.get(id)!;
}

export function getSession(db: Database, id: string): Session | null {
	return db
		.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?")
		.get(id);
}

export interface SessionSummary {
	id: string;
	channel: string;
	user_id: string;
	title: string | null;
	message_count: number;
	created_at: string;
	updated_at: string;
}

export function listRecentSessions(db: Database, limit = 50): SessionSummary[] {
	return db
		.query<SessionSummary, [number]>(
			`SELECT s.id, s.channel, s.user_id, s.title, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
     FROM sessions s
     ORDER BY s.updated_at DESC
     LIMIT ?`,
		)
		.all(limit);
}

export interface SessionActivity {
	id: string;
	channel: string;
	message_count: number;
	updated_at: string;
	snippet: string | null;
}

/** Recent sessions with a one-line snippet of the latest user/assistant message —
 * powers the Dashboard "recent conversations" panel. */
export function recentSessionActivity(
	db: Database,
	limit = 6,
): SessionActivity[] {
	return db
		.query<SessionActivity, [number]>(
			`SELECT s.id, s.channel, s.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count,
              (SELECT m2.content FROM messages m2
                 WHERE m2.session_id = s.id AND m2.role IN ('user','assistant')
                 ORDER BY m2.created_at DESC LIMIT 1) as snippet
       FROM sessions s
       ORDER BY s.updated_at DESC
       LIMIT ?`,
		)
		.all(Math.min(Math.max(limit, 1), 50));
}

export function listRecentSessionsForUser(
	db: Database,
	userId: string,
	limit = 50,
): SessionSummary[] {
	return db
		.query<SessionSummary, [string, number]>(
			`SELECT s.id, s.channel, s.user_id, s.title, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
     FROM sessions s
     WHERE s.user_id = ?
     ORDER BY s.updated_at DESC
     LIMIT ?`,
		)
		.all(userId, limit);
}

/** Total session rows regardless of owner — used to diagnose whether an empty
 * "for this user" list is a wiped DB (total=0) vs an owner mismatch (total>0). */
export function countAllSessions(db: Database): number {
	return (
		db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sessions").get()
			?.n ?? 0
	);
}

export function getSessionOwnedBy(
	db: Database,
	sessionId: string,
	userId: string,
): Session | null {
	return (
		db
			.query<Session, [string, string]>(
				"SELECT * FROM sessions WHERE id = ? AND user_id = ?",
			)
			.get(sessionId, userId) ?? null
	);
}

export interface SessionWithMessages {
	session: Session;
	messages: Array<{
		id: string;
		role: string;
		content: string;
		created_at: string;
	}>;
}

export function getSessionWithMessages(
	db: Database,
	sessionId: string,
): SessionWithMessages | null {
	const session = db
		.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?")
		.get(sessionId);
	if (!session) return null;

	const messages = db
		.query<
			{ id: string; role: string; content: string; created_at: string },
			[string]
		>(
			"SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(sessionId);

	return { session, messages };
}

/**
 * Run a write that may touch the messages_fts virtual table. If that index is
 * corrupt (SQLITE_CORRUPT_VTAB), rebuild it once and retry so a damaged search
 * index can't wedge message/session deletes. The index is derived data.
 */
function withFtsHeal<T>(db: Database, fn: () => T): T {
	try {
		return fn();
	} catch (err) {
		const corrupt =
			err != null &&
			typeof err === "object" &&
			((err as { code?: string }).code === "SQLITE_CORRUPT_VTAB" ||
				/malformed|corrupt/i.test((err as { message?: string }).message ?? ""));
		if (!corrupt) throw err;
		try {
			db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild');");
		} catch {
			// best-effort; the retry below may still surface the original error
		}
		return fn();
	}
}

export function deleteSession(db: Database, id: string): boolean {
	return withFtsHeal(db, () => {
		db.run("DELETE FROM messages WHERE session_id = ?", [id]);
		const result = db.run("DELETE FROM sessions WHERE id = ?", [id]);
		return result.changes > 0;
	});
}

export function deleteSessionOwnedBy(
	db: Database,
	id: string,
	userId: string,
): boolean {
	return withFtsHeal(db, () => {
		const result = db.run(
			"DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE id = ? AND user_id = ?)",
			[id, userId],
		);
		const sessionResult = db.run(
			"DELETE FROM sessions WHERE id = ? AND user_id = ?",
			[id, userId],
		);
		return result.changes > 0 || sessionResult.changes > 0;
	});
}

export function updateSessionTitle(
	db: Database,
	id: string,
	title: string,
): boolean {
	const result = db.run(
		"UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
		[title, id],
	);
	return result.changes > 0;
}

export function updateSessionTitleOwnedBy(
	db: Database,
	id: string,
	title: string,
	userId: string,
): boolean {
	const result = db.run(
		"UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
		[title, id, userId],
	);
	return result.changes > 0;
}

/**
 * Fork a session at a specific message. Copies all messages up to (and
 * including) the anchor into a new session. The new session retains the
 * parent pointer so the UI can show a branch indicator.
 *
 * Returns the new session id, or null when the source session / anchor
 * message doesn't exist.
 */
export function forkSessionAtMessage(
	db: Database,
	sourceSessionId: string,
	anchorMessageId: string,
	opts: { newSessionId: string; titleSuffix?: string },
): {
	newSessionId: string;
	copiedMessages: number;
} | null {
	const source = db
		.query<Session, [string]>("SELECT * FROM sessions WHERE id = ?")
		.get(sourceSessionId);
	if (!source) return null;

	// Use rowid as the branch cursor: strictly monotonic, not subject to
	// the second-resolution collision that datetime('now') has.
	const anchor = db
		.query<{ rowid: number }, [string, string]>(
			"SELECT rowid FROM messages WHERE id = ? AND session_id = ?",
		)
		.get(anchorMessageId, sourceSessionId);
	if (!anchor) return null;

	const forkedTitle =
		(source.title ?? `Session ${sourceSessionId.slice(0, 8)}`) +
		(opts.titleSuffix ?? " — fork");

	db.run(
		`INSERT INTO sessions (id, channel, user_id, title, parent_session_id, fork_source_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[
			opts.newSessionId,
			source.channel,
			source.user_id,
			forkedTitle,
			sourceSessionId,
			anchorMessageId,
		],
	);

	// Copy messages up to and including the anchor, ordered by rowid to
	// preserve insertion order without timestamp ambiguity.
	const copies = db
		.query<
			{
				id: string;
				role: string;
				content: string;
				tool_use_id: string | null;
				created_at: string;
			},
			[string, number]
		>(
			`SELECT id, role, content, tool_use_id, created_at
         FROM messages
        WHERE session_id = ?
          AND rowid <= ?
        ORDER BY rowid ASC`,
		)
		.all(sourceSessionId, anchor.rowid);

	for (const m of copies) {
		db.run(
			"INSERT INTO messages (id, session_id, role, content, tool_use_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			[
				crypto.randomUUID(),
				opts.newSessionId,
				m.role,
				m.content,
				m.tool_use_id,
				m.created_at,
			],
		);
	}

	return {
		newSessionId: opts.newSessionId,
		copiedMessages: copies.length,
	};
}

/**
 * Owner-checked fork. Returns null when the source session is not owned by
 * the given user. The new session inherits the same owner.
 */
export function forkSessionOwnedBy(
	db: Database,
	sourceSessionId: string,
	anchorMessageId: string,
	userId: string,
	opts: { newSessionId: string; titleSuffix?: string },
): { newSessionId: string; copiedMessages: number } | null {
	const source = getSessionOwnedBy(db, sourceSessionId, userId);
	if (!source) return null;
	return forkSessionAtMessage(db, sourceSessionId, anchorMessageId, opts);
}
