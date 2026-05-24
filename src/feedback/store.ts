import type { Database } from "bun:sqlite";
import type { MemoryStore } from "../memory/store.js";

/** Maximum length of an individual feedback line injected into the prompt. */
const MAX_FEEDBACK_LENGTH = 500;

// Strip C0/C1 control characters (NUL..US, DEL, and C1 range) so a
// malicious feedback entry cannot smuggle terminal escapes or prompt-
// injection markers into the system prompt.
const CONTROL_CHAR_RE = new RegExp(
	"[\\u0000-\\u001F\\u007F-\\u009F]+",
	"g",
);

/**
 * Sanitize feedback text for safe inclusion in the system prompt.
 * Collapses control chars + whitespace to single spaces and truncates.
 */
function sanitizeFeedbackText(text: string): string {
	return text
		.replace(CONTROL_CHAR_RE, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_FEEDBACK_LENGTH);
}

export interface FeedbackRecord {
	id: string;
	messageId: string;
	sessionId: string;
	feedbackType: "rating" | "regeneration" | "correction";
	value: string;
	originalContent: string | null;
	createdAt: string;
}

export class FeedbackStore {
	private db: Database;
	private memoryStore: MemoryStore | null;

	constructor(db: Database, memoryStore?: MemoryStore | null) {
		this.db = db;
		this.memoryStore = memoryStore ?? null;
	}

	recordRating(
		messageId: string,
		sessionId: string,
		rating: "up" | "down",
		reason?: string,
	): string {
		const id = crypto.randomUUID();
		const value = reason ? `${rating}:${reason}` : rating;
		this.db.run(
			"INSERT INTO feedback (id, message_id, session_id, feedback_type, value) VALUES (?, ?, ?, 'rating', ?)",
			[id, messageId, sessionId, value],
		);

		// Store negative feedback with reason as a memory for learning
		if (rating === "down" && reason && this.memoryStore) {
			this.memoryStore
				.store(
					`User disliked a response: ${reason}`,
					{ scope: "global", category: "decision", source: "feedback" },
				)
				.catch(() => {});
		}

		return id;
	}

	recordRegeneration(
		messageId: string,
		sessionId: string,
		originalContent: string,
	): string {
		const id = crypto.randomUUID();
		this.db.run(
			"INSERT INTO feedback (id, message_id, session_id, feedback_type, value, original_content) VALUES (?, ?, ?, 'regeneration', 'rejected', ?)",
			[id, messageId, sessionId, originalContent],
		);
		return id;
	}

	recordCorrection(
		sessionId: string,
		originalMessageId: string,
		correctionText: string,
	): string {
		const id = crypto.randomUUID();
		this.db.run(
			"INSERT INTO feedback (id, message_id, session_id, feedback_type, value) VALUES (?, ?, ?, 'correction', ?)",
			[id, originalMessageId, sessionId, correctionText],
		);

		// Store corrections as memories so the AI learns
		if (this.memoryStore) {
			this.memoryStore
				.store(
					`User correction: ${correctionText}`,
					{ scope: "global", category: "decision", source: "feedback" },
				)
				.catch(() => {});
		}

		return id;
	}

	/**
	 * Get recent negative feedback to inject into the system prompt.
	 * Scoped to a user to prevent cross-user leakage, and sanitized to
	 * prevent prompt injection via feedback text.
	 *
	 * @param userId — filter feedback to sessions owned by this user.
	 *                 Required; without it we'd leak feedback across users.
	 * @param limit  — maximum number of entries to return.
	 */
	getRecentNegativeFeedback(userId: string, limit = 5): string | null {
		if (!userId) return null;

		const rows = this.db
			.prepare<
				{ value: string; feedback_type: string; created_at: string },
				[string, number]
			>(
				`SELECT f.value, f.feedback_type, f.created_at
         FROM feedback f
         JOIN sessions s ON s.id = f.session_id
         WHERE s.user_id = ?
           AND ((f.feedback_type = 'rating' AND f.value LIKE 'down%')
                OR f.feedback_type = 'correction')
         ORDER BY f.created_at DESC
         LIMIT ?`,
			)
			.all(userId, limit);

		if (rows.length === 0) return null;

		const lines = rows.map((r) => {
			if (r.feedback_type === "correction") {
				return `- Correction: ${sanitizeFeedbackText(r.value)}`;
			}
			const reason = sanitizeFeedbackText(
				r.value.replace(/^down:?/, "").trim(),
			);
			return reason
				? `- Disliked response: ${reason}`
				: "- User disliked a response (no reason given)";
		});

		return lines.join("\n");
	}

	getFeedbackStats(): {
		totalRatings: number;
		thumbsUp: number;
		thumbsDown: number;
		corrections: number;
		regenerations: number;
	} {
		const counts = this.db
			.prepare<{ feedback_type: string; count: number }, []>(
				"SELECT feedback_type, COUNT(*) as count FROM feedback GROUP BY feedback_type",
			)
			.all();

		const byType: Record<string, number> = {};
		for (const row of counts) {
			byType[row.feedback_type] = row.count;
		}

		const upCount = this.db
			.prepare<{ count: number }, []>(
				"SELECT COUNT(*) as count FROM feedback WHERE feedback_type = 'rating' AND value LIKE 'up%'",
			)
			.get();

		const downCount = this.db
			.prepare<{ count: number }, []>(
				"SELECT COUNT(*) as count FROM feedback WHERE feedback_type = 'rating' AND value LIKE 'down%'",
			)
			.get();

		return {
			totalRatings: byType.rating ?? 0,
			thumbsUp: upCount?.count ?? 0,
			thumbsDown: downCount?.count ?? 0,
			corrections: byType.correction ?? 0,
			regenerations: byType.regeneration ?? 0,
		};
	}
}
