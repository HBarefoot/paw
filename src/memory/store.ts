import type { Database } from "bun:sqlite";
import { getEmbedding } from "./embeddings.js";

export interface MemoryMetadata {
  scope: string;
  category: "fact" | "preference" | "decision" | "summary";
  source?: string;
}

export interface MemoryResult {
  id: string;
  text: string;
  score: number;
  metadata: MemoryMetadata;
  created_at: string;
}

export interface RecallOptions {
  limit?: number;
  scope?: string;
  minScore?: number;
}

export interface MemoryStats {
  totalMemories: number;
  byCategory: Record<string, number>;
}

export class MemoryStore {
  private db: Database;
  private vectorWeight: number;
  private ftsWeight: number;
  private embeddingModel: string;
  private vecAvailable: boolean;

  constructor(db: Database, opts?: { vectorWeight?: number; ftsWeight?: number; embeddingModel?: string }) {
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

  async store(text: string, metadata: MemoryMetadata): Promise<string> {
    const id = crypto.randomUUID();
    this.db.run(
      "INSERT INTO memories (id, text, scope, category, source) VALUES (?, ?, ?, ?, ?)",
      [id, text, metadata.scope || "global", metadata.category, metadata.source ?? null],
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

    return id;
  }

  async recall(query: string, opts?: RecallOptions): Promise<MemoryResult[]> {
    const limit = opts?.limit ?? 10;
    const minScore = opts?.minScore ?? 0.0;

    // 1. Vector similarity search (if available)
    const vecScores = new Map<string, number>();
    if (this.vecAvailable) {
      try {
        const embedding = await getEmbedding(query, this.embeddingModel);
        const vecResults = this.db.prepare<{ memory_id: string; distance: number }, [ArrayBuffer, number]>(
          `SELECT memory_id, distance
           FROM memories_vec
           WHERE embedding MATCH ?
           ORDER BY distance
           LIMIT ?`,
        ).all(embedding.buffer, limit * 2);

        for (const row of vecResults) {
          // sqlite-vec returns cosine distance (0 = identical, 2 = opposite)
          vecScores.set(row.memory_id, 1 - row.distance / 2);
        }
      } catch {
        // Vector search failed — fall through to FTS-only
      }
    }

    // 2. FTS5 keyword search
    const ftsResults = this.db.prepare<{ rowid: number; rank: number }, [string, number]>(
      `SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?`,
    ).all(
      query.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
        .split(/\s+/).filter(Boolean).map(t => `"${t}"`).join(" "),
      limit * 2,
    );

    // Map FTS rowids to memory IDs (batch query instead of N individual lookups)
    const ftsScores = new Map<string, number>();
    if (ftsResults.length > 0) {
      const maxRank = Math.abs(ftsResults[ftsResults.length - 1]?.rank ?? 1);
      const placeholders = ftsResults.map(() => "?").join(",");
      const rowids = ftsResults.map(r => r.rowid);
      const idRows = this.db.prepare<{ rowid: number; id: string }, number[]>(
        `SELECT rowid, id FROM memories WHERE rowid IN (${placeholders})`
      ).all(...rowids);
      const rowidToId = new Map(idRows.map(r => [r.rowid, r.id]));
      for (const row of ftsResults) {
        const id = rowidToId.get(row.rowid);
        if (id) {
          // Normalize rank to 0-1 (rank is negative, closer to 0 is better match)
          ftsScores.set(id, maxRank > 0 ? (1 - Math.abs(row.rank) / maxRank) : 1);
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
      const score = useVec
        ? this.vectorWeight * vs + this.ftsWeight * fs
        : fs;
      if (score >= minScore) {
        scored.push({ id, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, limit);

    if (topIds.length === 0) return [];

    // 4. Fetch full memory records (batch query instead of N individual lookups)
    const results: MemoryResult[] = [];
    if (topIds.length > 0) {
      const placeholders = topIds.map(() => "?").join(",");
      const ids = topIds.map(t => t.id);
      const scoreMap = new Map(topIds.map(t => [t.id, t.score]));
      const rows = this.db.prepare<
        { id: string; text: string; scope: string; category: string; source: string | null; created_at: string },
        string[]
      >(`SELECT id, text, scope, category, source, created_at FROM memories WHERE id IN (${placeholders})`).all(...ids);
      for (const row of rows) {
        results.push({
          id: row.id,
          text: row.text,
          score: scoreMap.get(row.id)!,
          metadata: {
            scope: row.scope,
            category: row.category as MemoryMetadata["category"],
            source: row.source ?? undefined,
          },
          created_at: row.created_at,
        });
      }
    }

    return results;
  }

  forget(memoryId: string): boolean {
    const result = this.db.run("DELETE FROM memories WHERE id = ?", [memoryId]);
    if (result.changes > 0) {
      if (this.vecAvailable) {
        try {
          this.db.run("DELETE FROM memories_vec WHERE memory_id = ?", [memoryId]);
        } catch (err) {
          console.warn(`[memory] Failed to delete vector for ${memoryId}:`, err);
        }
      }
      return true;
    }
    return false;
  }

  list(opts?: { limit?: number; category?: string }): Array<{
    id: string;
    text: string;
    scope: string;
    category: string;
    source: string | null;
    created_at: string;
  }> {
    const limit = opts?.limit ?? 50;
    if (opts?.category) {
      return this.db.prepare<
        { id: string; text: string; scope: string; category: string; source: string | null; created_at: string },
        [string, number]
      >("SELECT id, text, scope, category, source, created_at FROM memories WHERE category = ? ORDER BY created_at DESC LIMIT ?")
        .all(opts.category, limit);
    }
    return this.db.prepare<
      { id: string; text: string; scope: string; category: string; source: string | null; created_at: string },
      [number]
    >("SELECT id, text, scope, category, source, created_at FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(limit);
  }

  getStats(): MemoryStats {
    const total = this.db.prepare<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM memories",
    ).get();

    const categories = this.db.prepare<{ category: string; count: number }, []>(
      "SELECT category, COUNT(*) as count FROM memories GROUP BY category",
    ).all();

    const byCategory: Record<string, number> = {};
    for (const row of categories) {
      byCategory[row.category] = row.count;
    }

    return {
      totalMemories: total?.count ?? 0,
      byCategory,
    };
  }
}
