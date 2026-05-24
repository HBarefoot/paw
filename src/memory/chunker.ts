/**
 * Split a long document into embedding-friendly chunks. Respects paragraph
 * and sentence boundaries, applies a sliding-window overlap so context
 * isn't severed between chunks, and never produces an empty chunk.
 */

export interface ChunkOptions {
	/** Soft upper bound per chunk (characters, not tokens). */
	maxChars?: number;
	/** Overlap with the previous chunk so retrieval hits don't lose context. */
	overlap?: number;
}

export interface ChunkResult {
	chunks: string[];
	totalChars: number;
}

const PARAGRAPH_SPLIT = /\n\s*\n+/;
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9])/;

export function chunkText(text: string, opts?: ChunkOptions): ChunkResult {
	const maxChars = Math.max(200, Math.min(opts?.maxChars ?? 1500, 8000));
	const overlap = Math.min(
		Math.max(opts?.overlap ?? 150, 0),
		Math.floor(maxChars / 2),
	);

	const normalized = text.replace(/\r\n?/g, "\n").trim();
	if (!normalized) return { chunks: [], totalChars: 0 };

	// Split on blank lines first, then split oversized paragraphs on sentence
	// boundaries. Tiny trailing fragments are glued to the previous piece.
	const paragraphs = normalized.split(PARAGRAPH_SPLIT);
	const atoms: string[] = [];
	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) continue;
		if (trimmed.length <= maxChars) {
			atoms.push(trimmed);
			continue;
		}
		const sentences = trimmed.split(SENTENCE_SPLIT);
		let cur = "";
		for (const s of sentences) {
			if (!s) continue;
			if (cur.length + s.length + 1 > maxChars && cur) {
				atoms.push(cur.trim());
				cur = s;
			} else {
				cur = cur ? `${cur} ${s}` : s;
			}
		}
		if (cur) atoms.push(cur.trim());
	}

	// Greedy pack atoms into chunks, adding overlap from the tail of the
	// previous chunk for context continuity.
	const chunks: string[] = [];
	let current = "";
	for (const atom of atoms) {
		if (!current) {
			current = atom;
			continue;
		}
		if (current.length + atom.length + 2 <= maxChars) {
			current = `${current}\n\n${atom}`;
			continue;
		}
		chunks.push(current);
		const tail =
			overlap > 0 && current.length > overlap
				? current.slice(current.length - overlap)
				: "";
		current = tail ? `${tail}\n\n${atom}` : atom;
	}
	if (current) chunks.push(current);

	return { chunks, totalChars: normalized.length };
}
