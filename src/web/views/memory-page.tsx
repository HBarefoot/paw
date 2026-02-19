import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

interface MemoryItem {
  id: string;
  text: string;
  scope: string;
  category: string;
  source: string | null;
  created_at: string;
}

interface MemoryPageProps {
  memories: MemoryItem[];
  stats: { totalMemories: number; byCategory: Record<string, number> } | null;
  query?: string;
  category?: string;
  error?: string;
  success?: string;
}

function memoryScript(): string {
  return `
    async function deleteMemory(id) {
      if (!confirm('Delete this memory?')) return;
      const res = await fetch('/api/memory/' + id, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else alert('Failed to delete memory');
    }
  `;
}

export const MemoryPage: FC<MemoryPageProps> = ({ memories, stats, query, category, error, success }) => {
  return (
    <Layout title="Memory Browser" currentPath="/memory">
      {error && <div class="alert alert-error">{error}</div>}
      {success && <div class="alert alert-success">{success}</div>}

      {stats && (
        <div class="grid mb-md">
          <div class="card">
            <h3>Total Memories</h3>
            <div class="stat-value">{stats.totalMemories}</div>
          </div>
          {Object.entries(stats.byCategory).map(([cat, count]) => (
            <div class="card">
              <h3>{cat}</h3>
              <div class="stat-value">{count}</div>
            </div>
          ))}
        </div>
      )}

      <div class="card mb-md">
        <h3>Search</h3>
        <form method="GET" action="/memory" class="flex gap-sm items-end flex-wrap">
          <div class="flex-1" style="min-width: 200px">
            <input type="text" name="q" value={query ?? ""} placeholder="Search memories..." class="w-full" />
          </div>
          <div>
            <select name="category" style="min-width: 120px">
              <option value="">All categories</option>
              <option value="fact" selected={category === "fact"}>fact</option>
              <option value="preference" selected={category === "preference"}>preference</option>
              <option value="decision" selected={category === "decision"}>decision</option>
              <option value="summary" selected={category === "summary"}>summary</option>
            </select>
          </div>
          <button type="submit" class="btn-primary">Search</button>
        </form>
      </div>

      <div class="card mb-md">
        <h3>Store Memory</h3>
        <form method="POST" action="/api/memory" class="flex-col gap-sm max-w-form">
          <textarea name="text" rows={2} required placeholder="Memory text..." class="w-full" style="resize: vertical" />
          <div class="flex gap-sm">
            <select name="category" class="flex-1">
              <option value="fact">fact</option>
              <option value="preference">preference</option>
              <option value="decision">decision</option>
              <option value="summary">summary</option>
            </select>
            <input type="text" name="scope" value="global" placeholder="Scope" class="flex-1" />
          </div>
          <button type="submit" class="btn-primary self-start">Store</button>
        </form>
      </div>

      <div class="card">
        <h3>Results ({memories.length})</h3>
        {memories.length > 0 ? (
          <div class="flex-col gap-sm">
            {memories.map((mem) => (
              <div class="memory-card">
                <div class="flex justify-between items-center mb-md" style="margin-bottom: 8px">
                  <div class="flex gap-sm items-center">
                    <span class="badge success">{mem.category}</span>
                    <span class="text-sm text-muted">{mem.scope}</span>
                  </div>
                  <div class="flex gap-sm items-center">
                    <span class="text-xs text-muted">{mem.created_at}</span>
                    <button
                      class="btn-danger btn-sm"
                      data-memory-id={mem.id}
                      onclick="deleteMemory(this.dataset.memoryId)"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p style="font-size: 14px; line-height: 1.5">{mem.text}</p>
                {mem.source && <p class="text-xs text-muted mt-sm">Source: {mem.source}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div class="empty-state"><p>{query ? "No memories match your search." : "No memories stored yet."}</p></div>
        )}
      </div>

      {raw(`<script>${memoryScript()}</script>`)}
    </Layout>
  );
};
