import type { Database } from "bun:sqlite";
import { getEmbedding } from "./embeddings.js";

export interface MemoryMetadata {
	scope: string;
	category: "fact" | "preference" | "decision" | "summary";
	source?: string;
	/**
	 * Admin id (`web-{adminId}`) of the admin who owns this memory. When
	 * set, only that admin sees it in recall/list. When null, the memory
	 * is shared across all admins.
	 */
	ownerUserId?: string | null;
}

export interface MemoryResult {
	id: string;
	text: string;
	score: number;
	metadata: MemoryMetadata;
	created_at: string;
	confidence: number;
	access_count: number;
}

export interface RecallOptions {
	limit?: number;
	scope?: string;
	minScore?: number;
	/**
	 * Pre-computed query embedding. If provided, recall skips the embedding
	 * step — callers can share a single embedding across multiple recalls
	 * for the same query (e.g. user-scope + global-scope within one turn).
	 */
	embedding?: Float32Array;
	/**
	 * When set, recall returns only memories visible to this admin
	 * (their own + global shared with `owner_user_id IS NULL`).
	 * Undefined means no per-admin filter (used by internal callers
	 * like auto-extract, which run with elevated privilege).
	 */
	ownerUserId?: string;
}

export interface MemoryStats {
	totalMemories: number;
	byCategory: Record<string, number>;
}

export interface MemoryLink {
	id: string;
	sourceId: string;
	targetId: string;
	linkType: "related" | "contradicts" | "supersedes" | "refines";
	createdAt: string;
}

export class MemoryStore {
	private db: Database;
	private vectorWeight: number;
	private ftsWeight: number;
	private embeddingModel: string;
	private vecAvailable: boolean;

	constructor(
		db: Database,
		opts?: {
			vectorWeight?: number;
			ftsWeight?: number;
			embeddingModel?: string;
		},
	) {
		this.db = db;
		this.vectorWeight = opts?.vectorWeight ?? 0.7;
		this.ftsWeight = opts?.ftsWeight ?? 0.3;
		this.embeddingModel = opts?.embeddingModel ?? "Xenova/all-MiniLM-L6-v2";

		// Detect if memories_vec table exists (sqlite-vec loaded successfully)
		try {
			this.db.prepare("SELECT COUNT(*) FROM memories_vec").get();
			this.vecAvailable = true;
		} catch {
			this.vecAvailable = false;
		}
	}

	async store(
		text: string,
		metadata: MemoryMetadata,
		opts?: { supersedes?: string },
	): Promise<string> {
		const id = crypto.randomUUID();
		this.db.run(
			"INSERT INTO memories (id, text, scope, category, source, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)",
			[
				id,
				text,
				metadata.scope || "global",
				metadata.category,
				metadata.source ?? null,
				metadata.ownerUserId ?? null,
			],
		);

		if (this.vecAvailable) {
			try {
				const embedding = await getEmbedding(text, this.embeddingModel);
				this.db.run(
					"INSERT INTO memories_vec (memory_id, embedding) VALUES (?, ?)",
					[id, embedding.buffer],
				);
			} catch {
				// Vector embedding failed — memory is still stored, just without vector index
			}
		}

		// If this memory supersedes an older one, create a link and lower confidence
		if (opts?.supersedes) {
			this.linkMemories(id, opts.supersedes, "supersedes");
			this.db.run(
				"UPDATE memories SET superseded_by = ?, confidence = confidence * 0.3 WHERE id = ?",
				[id, opts.supersedes],
			);
		}

		return id;
	}

	/**
	 * Compute the query embedding without running a full recall. Useful for
	 * callers that want to issue multiple scoped recalls for the same query
	 * while only paying the embedding cost once.
	 */
	async embed(query: string): Promise<Float32Array | null> {
		if (!this.vecAvailable) return null;
		try {
			return await getEmbedding(query, this.embeddingModel);
		} catch {
			return null;
		}
	}

	async recall(query: string, opts?: RecallOptions): Promise<MemoryResult[]> {
		const limit = opts?.limit ?? 10;
		const minScore = opts?.minScore ?? 0.0;

		// 1. Vector similarity search (if available)
		const vecScores = new Map<string, number>();
		if (this.vecAvailable) {
			try {
				const embedding =
					opts?.embedding ??
					(await getEmbedding(query, this.embeddingModel));
				const vecResults = this.db
					.prepare<
						{ memory_id: string; distance: number },
						[ArrayBuffer, number]
					>(
						`SELECT memory_id, distance
           FROM memories_vec
           WHERE embedding MATCH ?
           ORDER BY distance
           LIMIT ?`,
					)
					.all(embedding.buffer, limit * 2);

				for (const row of vecResults) {
					// sqlite-vec returns cosine distance (0 = identical, 2 = opposite)
					vecScores.set(row.memory_id, 1 - row.distance / 2);
				}
			} catch {
				// Vector search failed — fall through to FTS-only
			}
		}

		// 2. FTS5 keyword search — skipped when vector search already found
		// enough strong matches. Leaves FTS as a fallback path for cases
		// where sqlite-vec isn't available or the query doesn't embed well.
		const strongVecHits = [...vecScores.values()].filter(
			(s) => s >= 0.6,
		).length;
		const skipFts = strongVecHits >= limit;

		const ftsTerms = query
			.replace(/[^\w\s]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => `"${t}"`)
			.join(" ");

		const ftsResults = skipFts || !ftsTerms
			? []
			: this.db
					.prepare<{ rowid: number; rank: number }, [string, number]>(
						`SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?`,
					)
					.all(ftsTerms, limit * 2);

		// Map FTS rowids to memory IDs (batch query instead of N individual lookups)
		const ftsScores = new Map<string, number>();
		if (ftsResults.length > 0) {
			const maxRank = Math.abs(ftsResults[ftsResults.length - 1]?.rank ?? 1);
			const placeholders = ftsResults.map(() => "?").join(",");
			const rowids = ftsResults.map((r) => r.rowid);
			const idRows = this.db
				.prepare<{ rowid: number; id: string }, number[]>(
					`SELECT rowid, id FROM memories WHERE rowid IN (${placeholders})`,
				)
				.all(...rowids);
			const rowidToId = new Map(idRows.map((r) => [r.rowid, r.id]));
			for (const row of ftsResults) {
				const id = rowidToId.get(row.rowid);
				if (id) {
					// Normalize rank to 0-1 (rank is negative, closer to 0 is better match)
					ftsScores.set(id, maxRank > 0 ? 1 - Math.abs(row.rank) / maxRank : 1);
				}
			}
		}

		// 3. Fuse scores (if vec unavailable, use FTS-only with weight 1.0)
		const allIds = new Set([...vecScores.keys(), ...ftsScores.keys()]);
		const scored: Array<{ id: string; score: number }> = [];
		const useVec = vecScores.size > 0;
		for (const id of allIds) {
			const vs = vecScores.get(id) ?? 0;
			const fs = ftsScores.get(id) ?? 0;
			const score = useVec ? this.vectorWeight * vs + this.ftsWeight * fs : fs;
			if (score >= minScore) {
				scored.push({ id, score });
			}
		}

		scored.sort((a, b) => b.score - a.score);
		const topIds = scored.slice(0, limit);

		if (topIds.length === 0) return [];

		// 4. Fetch full memory records with confidence (batch query)
		const results: MemoryResult[] = [];
		if (topIds.length > 0) {
			const placeholders = topIds.map(() => "?").join(",");
			const ids = topIds.map((t) => t.id);
			const scoreMap = new Map(topIds.map((t) => [t.id, t.score]));
			const rows = this.db
				.prepare<
					{
						id: string;
						text: string;
						scope: string;
						category: string;
						source: string | null;
						owner_user_id: string | null;
						created_at: string;
						confidence: number;
						access_count: number;
					},
					string[]
				>(
					`SELECT id, text, scope, category, source, owner_user_id, created_at, confidence, access_count FROM memories WHERE id IN (${placeholders})`,
				)
				.all(...ids);
			for (const row of rows) {
				// Per-admin scope filter (C-NEW-1): when the caller provided an
				// ownerUserId, hide memories owned by a different admin. Global
				// memories (owner_user_id IS NULL) remain visible.
				if (
					opts?.ownerUserId &&
					row.owner_user_id !== null &&
					row.owner_user_id !== opts.ownerUserId
				) {
					continue;
				}
				const rawScore = scoreMap.get(row.id)!;
				results.push({
					id: row.id,
					text: row.text,
					score: rawScore * row.confidence,
					metadata: {
						scope: row.scope,
						category: row.category as MemoryMetadata["category"],
						source: row.source ?? undefined,
					},
					created_at: row.created_at,
					confidence: row.confidence,
					access_count: row.access_count,
				});
			}

			// Re-sort by confidence-weighted score
			results.sort((a, b) => b.score - a.score);

			// 5. Update access tracking for returned results — one UPDATE for
			// all rows instead of N round-trips.
			if (results.length > 0) {
				const now = new Date().toISOString();
				const accessIds = results.map((r) => r.id);
				const placeholdersAccess = accessIds.map(() => "?").join(",");
				this.db.run(
					`UPDATE memories
             SET access_count = access_count + 1,
                 last_accessed_at = ?
           WHERE id IN (${placeholdersAccess})`,
					[now, ...accessIds],
				);
			}
		}

		return results;
	}

	forget(memoryId: string): boolean {
		// Clean up any links involving this memory
		this.db.run(
			"DELETE FROM memory_links WHERE source_id = ? OR target_id = ?",
			[memoryId, memoryId],
		);

		const result = this.db.run("DELETE FROM memories WHERE id = ?", [
			memoryId,
		]);
		if (result.changes > 0) {
			if (this.vecAvailable) {
				try {
					this.db.run("DELETE FROM memories_vec WHERE memory_id = ?", [
						memoryId,
					]);
				} catch (err) {
					console.warn(
						`[memory] Failed to delete vector for ${memoryId}:`,
						err,
					);
				}
			}
			return true;
		}
		return false;
	}

	getById(id: string): {
		id: string;
		text: string;
		scope: string;
		category: string;
		source: string | null;
		owner_user_id: string | null;
		created_at: string;
		confidence: number;
	} | null {
		return (
			this.db
				.prepare<
					{
						id: string;
						text: string;
						scope: string;
						category: string;
						source: string | null;
						owner_user_id: string | null;
						created_at: string;
						confidence: number;
					},
					[string]
				>(
					`SELECT id, text, scope, category, source, owner_user_id, created_at, confidence
             FROM memories WHERE id = ?`,
				)
				.get(id) ?? null
		);
	}

	/**
	 * Fetch a memory only if it's visible to the given admin
	 * (owner matches OR memory is shared/global).
	 */
	getByIdForOwner(
		id: string,
		ownerUserId: string,
	): ReturnType<MemoryStore["getById"]> {
		const row = this.db
			.prepare<
				{
					id: string;
					text: string;
					scope: string;
					category: string;
					source: string | null;
					owner_user_id: string | null;
					created_at: string;
					confidence: number;
				},
				[string, string]
			>(
				`SELECT id, text, scope, category, source, owner_user_id, created_at, confidence
         FROM memories
        WHERE id = ?
          AND (owner_user_id IS NULL OR owner_user_id = ?)`,
			)
			.get(id, ownerUserId);
		return row ?? null;
	}

	list(
		opts?: { limit?: number; category?: string; ownerUserId?: string },
	): Array<{
		id: string;
		text: string;
		scope: string;
		category: string;
		source: string | null;
		owner_user_id: string | null;
		created_at: string;
		confidence: number;
		access_count: number;
		last_accessed_at: string | null;
	}> {
		const limit = opts?.limit ?? 50;
		type Row = {
			id: string;
			text: string;
			scope: string;
			category: string;
			source: string | null;
			owner_user_id: string | null;
			created_at: string;
			confidence: number;
			access_count: number;
			last_accessed_at: string | null;
		};
		const ownerFilter = opts?.ownerUserId
			? " AND (owner_user_id IS NULL OR owner_user_id = ?)"
			: "";
		if (opts?.category) {
			const bindings: (string | number)[] = opts.ownerUserId
				? [opts.category, opts.ownerUserId, limit]
				: [opts.category, limit];
			return this.db
				.prepare<Row, (string | number)[]>(
					`SELECT id, text, scope, category, source, owner_user_id, created_at,
                  confidence, access_count, last_accessed_at
             FROM memories
            WHERE category = ?${ownerFilter}
            ORDER BY created_at DESC
            LIMIT ?`,
				)
				.all(...bindings);
		}
		const bindings: (string | number)[] = opts?.ownerUserId
			? [opts.ownerUserId, limit]
			: [limit];
		return this.db
			.prepare<Row, (string | number)[]>(
				`SELECT id, text, scope, category, source, owner_user_id, created_at,
                confidence, access_count, last_accessed_at
           FROM memories
          WHERE 1=1${ownerFilter}
          ORDER BY created_at DESC
          LIMIT ?`,
			)
			.all(...bindings);
	}

	getStats(): MemoryStats {
		const total = this.db
			.prepare<{ count: number }, []>(
				"SELECT COUNT(*) as count FROM memories",
			)
			.get();

		const categories = this.db
			.prepare<{ category: string; count: number }, []>(
				"SELECT category, COUNT(*) as count FROM memories GROUP BY category",
			)
			.all();

		const byCategory: Record<string, number> = {};
		for (const row of categories) {
			byCategory[row.category] = row.count;
		}

		return {
			totalMemories: total?.count ?? 0,
			byCategory,
		};
	}

	// --- Memory Links ---

	linkMemories(
		sourceId: string,
		targetId: string,
		linkType: MemoryLink["linkType"],
	): string {
		const id = crypto.randomUUID();
		this.db.run(
			"INSERT INTO memory_links (id, source_id, target_id, link_type) VALUES (?, ?, ?, ?)",
			[id, sourceId, targetId, linkType],
		);
		return id;
	}

	getLinkedMemories(
		memoryId: string,
	): Array<MemoryLink & { linkedText: string }> {
		return this.db
			.prepare<
				{
					id: string;
					source_id: string;
					target_id: string;
					link_type: string;
					created_at: string;
					linked_text: string;
				},
				[string, string, string]
			>(
				`SELECT ml.id, ml.source_id, ml.target_id, ml.link_type, ml.created_at,
              m.text as linked_text
       FROM memory_links ml
       JOIN memories m ON m.id = CASE WHEN ml.source_id = ? THEN ml.target_id ELSE ml.source_id END
       WHERE ml.source_id = ? OR ml.target_id = ?`,
			)
			.all(memoryId, memoryId, memoryId)
			.map((row) => ({
				id: row.id,
				sourceId: row.source_id,
				targetId: row.target_id,
				linkType: row.link_type as MemoryLink["linkType"],
				createdAt: row.created_at,
				linkedText: row.linked_text,
			}));
	}

	/**
	 * Find existing memories that may contradict the given text.
	 * Returns top candidates with high similarity but different content.
	 * The caller (auto-extract or AI) decides if they truly contradict.
	 */
	async findContradictionCandidates(
		text: string,
		opts?: { limit?: number; scope?: string },
	): Promise<MemoryResult[]> {
		const candidates = await this.recall(text, {
			limit: opts?.limit ?? 5,
			scope: opts?.scope,
			minScore: 0.4,
		});
		// Filter to same-topic memories (high score) that aren't identical
		return candidates.filter(
			(m) => m.text.toLowerCase() !== text.toLowerCase(),
		);
	}
}
