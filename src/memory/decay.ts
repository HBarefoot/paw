import type { Database } from "bun:sqlite";

/**
 * Apply confidence decay to memories that haven't been accessed recently.
 * Memories not accessed within `thresholdDays` have their confidence
 * multiplied by `decayRate` (e.g., 0.995 = 0.5% decay per heartbeat cycle).
 * Memories below a minimum confidence floor are not further decayed.
 */
export function runMemoryDecay(
	db: Database,
	opts?: { decayRate?: number; thresholdDays?: number },
): { decayed: number } {
	const decayRate = opts?.decayRate ?? 0.995;
	const thresholdDays = opts?.thresholdDays ?? 7;
	const minConfidence = 0.1;

	const result = db.run(
		`UPDATE memories
     SET confidence = confidence * ?
     WHERE confidence > ?
       AND (last_accessed_at IS NULL OR last_accessed_at < datetime('now', ?))`,
		[decayRate, minConfidence, `-${thresholdDays} days`],
	);

	return { decayed: result.changes };
}
