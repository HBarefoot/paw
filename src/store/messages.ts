import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export interface StoredMessage {
	id: string;
	session_id: string;
	role: "user" | "assistant" | "tool";
	content: string;
	tool_use_id: string | null;
	created_at: string;
}

export function appendMessage(
	db: Database,
	sessionId: string,
	role: "user" | "assistant" | "tool",
	content: string,
	toolUseId?: string,
): StoredMessage {
	const id = randomUUID();
	db.run(
		"INSERT INTO messages (id, session_id, role, content, tool_use_id) VALUES (?, ?, ?, ?, ?)",
		[id, sessionId, role, content, toolUseId ?? null],
	);
	return db
		.query<StoredMessage, [string]>("SELECT * FROM messages WHERE id = ?")
		.get(id)!;
}

export function getSessionMessages(
	db: Database,
	sessionId: string,
	limit = 50,
): StoredMessage[] {
	return db
		.query<StoredMessage, [string, number]>(
			"SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?",
		)
		.all(sessionId, limit);
}

export function pruneOldMessages(
	db: Database,
	sessionId: string,
	keepLast: number,
): void {
	db.run(
		`DELETE FROM messages WHERE session_id = ? AND id NOT IN (
      SELECT id FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    )`,
		[sessionId, sessionId, keepLast],
	);
}

export interface MessageSearchHit {
	id: string;
	session_id: string;
	role: "user" | "assistant" | "tool";
	content: string;
	snippet: string;
	created_at: string;
	session_title: string | null;
	session_channel: string;
	session_user_id: string;
}

/**
 * Search messages across all sessions with FTS5, falling back to a
 * bounded LIKE query when FTS5 isn't available. Results are scoped to
 * a user_id so a multi-user deployment can't leak cross-user conversations.
 */
export function searchMessages(
	db: Database,
	query: string,
	opts: { userId: string; limit?: number; sessionId?: string },
): MessageSearchHit[] {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const trimmed = query.trim();
	if (!trimmed) return [];

	// Tokenize to alphanumerics and quote each token so FTS treats them as
	// literal terms. Defends against stray operators (AND/OR/NEAR) and
	// quote injection from user input.
	const tokens = trimmed
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => `"${t}"`);
	if (tokens.length === 0) return [];
	const ftsQuery = tokens.join(" ");

	try {
		// Inner FTS query ranks hits and exposes snippet(); outer join fetches
		// the message + session metadata. Using a CTE keeps bm25() bound to
		// the matching FTS query.
		const params: (string | number)[] = [ftsQuery];
		let sessionFilter = "";
		if (opts.sessionId) {
			sessionFilter = " AND m.session_id = ?";
			params.push(opts.sessionId);
		}
		params.push(opts.userId);
		params.push(limit);

		return db
			.prepare<MessageSearchHit, (string | number)[]>(
				`WITH hits AS (
           SELECT rowid,
                  bm25(messages_fts) AS rank,
                  snippet(messages_fts, 0, '@@HL_OPEN@@', '@@HL_CLOSE@@', '…', 10) AS snippet
             FROM messages_fts
            WHERE messages_fts MATCH ?
         )
         SELECT m.id, m.session_id, m.role, m.content,
                h.snippet AS snippet,
                m.created_at,
                s.title AS session_title,
                s.channel AS session_channel,
                s.user_id AS session_user_id
           FROM hits h
           JOIN messages m ON m.rowid = h.rowid
           JOIN sessions s ON s.id = m.session_id
          WHERE 1=1${sessionFilter}
            AND s.user_id = ?
          ORDER BY h.rank ASC, m.created_at DESC
          LIMIT ?`,
			)
			.all(...params);
	} catch {
		const likeTerm = `%${trimmed.replace(/[%_]/g, (c) => `\\${c}`)}%`;
		const fallbackParams: (string | number)[] = [likeTerm];
		let fallbackWhere = "WHERE m.content LIKE ? ESCAPE '\\'";
		if (opts.sessionId) {
			fallbackWhere += " AND m.session_id = ?";
			fallbackParams.push(opts.sessionId);
		}
		fallbackWhere += " AND s.user_id = ?";
		fallbackParams.push(opts.userId);
		fallbackParams.push(limit);
		return db
			.prepare<MessageSearchHit, (string | number)[]>(
				`SELECT m.id, m.session_id, m.role, m.content,
                SUBSTR(m.content, 1, 240) AS snippet,
                m.created_at,
                s.title AS session_title,
                s.channel AS session_channel,
                s.user_id AS session_user_id
           FROM messages m
           JOIN sessions s ON s.id = m.session_id
           ${fallbackWhere}
           ORDER BY m.created_at DESC
           LIMIT ?`,
			)
			.all(...fallbackParams);
	}
}
