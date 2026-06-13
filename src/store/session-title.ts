/**
 * Human-readable session titles. A canvas message's content is the agent-facing
 * `[CANVAS MODE] …` system prompt with the real ask buried at "User request: …";
 * the auto-titler must never surface that internal prose. These helpers pull the
 * actual request and produce a clean, capped title.
 */

import type { Database } from "bun:sqlite";

const TITLE_MAX = 80;

/**
 * Extract the user's request from a `[CANVAS MODE]` message, or null if the
 * content isn't a canvas message. Returns "" when the message carried no text
 * (e.g. attachments only) so callers can fall back to a generic label.
 */
export function extractCanvasRequest(content: string): string | null {
	if (!content || !content.startsWith("[CANVAS MODE]")) return null;
	// The request runs from "User request:" to the next "\n\n--- … ---" block
	// (Attached Data / canvas files summary) or end of message.
	const m = content.match(/User request:\s*([\s\S]*?)(?:\n\n---|\s*$)/);
	const t = (m ? m[1] : "").trim();
	if (!t || t === "(see attached files)") return "";
	return t;
}

/**
 * A clean, human session title from a first message — never the internal system
 * prompt. Canvas messages → the user's request (or "Canvas session" when empty);
 * everything else → a whitespace-collapsed, length-capped first line.
 */
export function sessionTitleFromContent(content: string): string {
	const raw = (content ?? "").trim();
	const canvas = extractCanvasRequest(raw);
	const text = canvas != null ? canvas || "Canvas session" : raw;
	const oneLine = text.replace(/\s+/g, " ").trim();
	if (!oneLine) return "New session";
	return oneLine.length > TITLE_MAX
		? `${oneLine.slice(0, TITLE_MAX - 1)}…`
		: oneLine;
}

/**
 * One-time cleanup for sessions whose stored title leaked the `[CANVAS MODE]`
 * system prompt (titled before the fix above). Re-derives each from the session's
 * first user message via sessionTitleFromContent. Idempotent: a retitled row no
 * longer matches `[CANVAS MODE]%`, so re-runs are no-ops. Best-effort — never
 * throws (called from the boot migration path).
 */
export function cleanLeakedSessionTitles(db: Database): void {
	try {
		const leaked = db
			.query<{ id: string }, []>(
				"SELECT id FROM sessions WHERE title LIKE '[CANVAS MODE]%'",
			)
			.all();
		for (const { id } of leaked) {
			const first = db
				.query<{ content: string }, [string]>(
					"SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1",
				)
				.get(id);
			if (first) {
				db.run("UPDATE sessions SET title = ? WHERE id = ?", [
					sessionTitleFromContent(first.content),
					id,
				]);
			}
		}
	} catch {
		// best-effort cleanup; never block boot.
	}
}
