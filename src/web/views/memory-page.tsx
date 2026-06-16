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
	confidence?: number;
	access_count?: number;
	last_accessed_at?: string | null;
}

interface MemoryConfig {
	enabled: boolean;
	autoExtract: boolean;
	vectorWeight: number;
	ftsWeight: number;
}

interface MemoryPageProps {
	memories: MemoryItem[];
	stats: { totalMemories: number; byCategory: Record<string, number> } | null;
	memoryConfig: MemoryConfig;
	query?: string;
	category?: string;
	error?: string;
	success?: string;
}

/** Hidden-input + toggle button (mirrors the settings-page `Bool` control) so a
 *  plain form POST always submits "true"/"false" — no unchecked-checkbox gap.
 *  Driven by `pawToggle` in memoryScript(). */
function Bool({ name, value }: { name: string; value: boolean }) {
	return (
		<span style="display:inline-flex">
			{raw(
				`<input type="hidden" name="${name}" value="${value ? "true" : "false"}">`,
			)}
			<button
				type="button"
				class={`toggle${value ? " on" : ""}`}
				onclick="pawToggle(this)"
			/>
		</span>
	);
}

function memoryScript(): string {
	return `
    function pawToggle(btn) {
      var on = btn.classList.toggle("on");
      var inp = btn.previousElementSibling;
      if (inp) inp.value = on ? "true" : "false";
    }

    async function deleteMemory(id) {
      var ok = await pawModal.confirm("Delete Memory", "Are you sure you want to delete this memory?", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch('/api/memory/' + id, { method: 'DELETE' });
      if (res.ok) window.location.reload();
      else pawModal.alert("Error", "Failed to delete memory.");
    }

    async function importDocument(fileInput) {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var statusEl = document.getElementById("import-status");
      statusEl.textContent = "Reading " + file.name + "...";
      try {
        var text = await file.text();
        statusEl.textContent = "Importing " + file.name + "...";
        var res = await fetch("/api/memory/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text,
            source: file.name,
            scope: document.getElementById("import-scope").value || "global",
            category: document.getElementById("import-category").value || "fact"
          })
        });
        var data = await res.json();
        if (!res.ok) {
          statusEl.textContent = "Failed: " + (data.error || res.status);
          return;
        }
        statusEl.textContent = "Imported " + data.stored + " / " + data.total + " chunks from " + file.name + ".";
        setTimeout(function() { window.location.reload(); }, 600);
      } catch (e) {
        statusEl.textContent = "Failed: " + e.message;
      } finally {
        fileInput.value = "";
      }
    }
  `;
}

export const MemoryPage: FC<MemoryPageProps> = ({
	memories,
	stats,
	memoryConfig,
	query,
	category,
	error,
	success,
}) => {
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
				<h3>Memory settings</h3>
				<p class="text-sm text-muted mb-md">
					How memory is persisted and recalled. Changes save immediately; some
					take effect on the next conversation.
				</p>
				<form
					method="post"
					action="/api/memory/config"
					class="flex-col gap-sm max-w-form"
				>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>Memory enabled</div>
							<div class="text-sm text-muted">Persist facts across sessions.</div>
						</div>
						<Bool name="memory.enabled" value={memoryConfig.enabled} />
					</div>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>Auto-extract facts</div>
							<div class="text-sm text-muted">
								Pull durable facts from conversations.
							</div>
						</div>
						<Bool name="memory.autoExtract" value={memoryConfig.autoExtract} />
					</div>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>Vector weight</div>
							<div class="text-sm text-muted">Hybrid recall weighting.</div>
						</div>
						<input
							type="number"
							name="memory.vectorWeight"
							value={String(memoryConfig.vectorWeight)}
							step="0.1"
							min="0"
							max="1"
							style="width:90px"
						/>
					</div>
					<div class="flex items-center justify-between gap-sm">
						<div>
							<div>FTS weight</div>
							<div class="text-sm text-muted">Full-text search weighting.</div>
						</div>
						<input
							type="number"
							name="memory.ftsWeight"
							value={String(memoryConfig.ftsWeight)}
							step="0.1"
							min="0"
							max="1"
							style="width:90px"
						/>
					</div>
					<button type="submit" class="btn-primary self-start">
						Save settings
					</button>
				</form>
			</div>

			<div class="card mb-md">
				<h3>Search</h3>
				<form
					method="get"
					action="/memory"
					class="flex gap-sm items-end flex-wrap"
				>
					<div class="flex-1" style="min-width: 200px">
						<input
							type="text"
							name="q"
							value={query ?? ""}
							placeholder="Search memories..."
							class="w-full"
						/>
					</div>
					<div>
						<select name="category" style="min-width: 120px">
							<option value="">All categories</option>
							<option value="fact" selected={category === "fact"}>
								fact
							</option>
							<option value="preference" selected={category === "preference"}>
								preference
							</option>
							<option value="decision" selected={category === "decision"}>
								decision
							</option>
							<option value="summary" selected={category === "summary"}>
								summary
							</option>
						</select>
					</div>
					<button type="submit" class="btn-primary">
						Search
					</button>
				</form>
			</div>

			<div class="card mb-md">
				<h3>Import Document</h3>
				<p class="text-sm text-muted mb-md">
					Drop a <code>.md</code> or <code>.txt</code> file here to chunk and
					store each section as a separate memory, tagged with the file name.
				</p>
				<div class="flex gap-sm items-center flex-wrap">
					<input
						type="file"
						accept=".md,.markdown,.txt"
						onchange="importDocument(this)"
					/>
					<input
						type="text"
						id="import-scope"
						value="global"
						placeholder="Scope"
						style="width: 140px"
					/>
					<select id="import-category">
						<option value="fact">fact</option>
						<option value="summary">summary</option>
					</select>
					<span id="import-status" class="text-sm text-muted" />
				</div>
			</div>

			<div class="card mb-md">
				<h3>Store Memory</h3>
				<form
					method="post"
					action="/api/memory"
					class="flex-col gap-sm max-w-form"
				>
					<textarea
						name="text"
						rows={2}
						required
						placeholder="Memory text..."
						class="w-full"
						style="resize: vertical"
					/>
					<div class="flex gap-sm">
						<select name="category" class="flex-1">
							<option value="fact">fact</option>
							<option value="preference">preference</option>
							<option value="decision">decision</option>
							<option value="summary">summary</option>
						</select>
						<input
							type="text"
							name="scope"
							value="global"
							placeholder="Scope"
							class="flex-1"
						/>
					</div>
					<button type="submit" class="btn-primary self-start">
						Store
					</button>
				</form>
			</div>

			<div class="card">
				<h3>Results ({memories.length})</h3>
				{memories.length > 0 ? (
					<div class="flex-col gap-sm">
						{memories.map((mem) => {
							const conf =
								typeof mem.confidence === "number" ? mem.confidence : 1;
							const confPct = Math.round(conf * 100);
							const confTone =
								conf >= 0.75
									? "success"
									: conf >= 0.4
										? "warning"
										: "danger";
							return (
								<div class="memory-card">
									<div
										class="flex justify-between items-center mb-md"
										style="margin-bottom: 8px"
									>
										<div class="flex gap-sm items-center">
											<span class="badge success">{mem.category}</span>
											<span class="text-sm text-muted">{mem.scope}</span>
											<span
												class={`badge ${confTone}`}
												title={`Confidence: ${confPct}%`}
											>
												{confPct}% confident
											</span>
											{typeof mem.access_count === "number" && (
												<span
													class="badge info"
													title="Times this memory was recalled"
												>
													↻ {mem.access_count}
												</span>
											)}
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
									{mem.source && (
										<p class="text-xs text-muted mt-sm">
											Source: {mem.source}
										</p>
									)}
								</div>
							);
						})}
					</div>
				) : (
					<div class="empty-state">
						<p>
							{query
								? "No memories match your search."
								: "No memories stored yet."}
						</p>
					</div>
				)}
			</div>

			{raw(`<script>${memoryScript()}</script>`)}
		</Layout>
	);
};
