import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import { Layout } from "./layout.js";

export interface PromptRow {
	id: string;
	title: string;
	body: string;
	tags: string | null;
	use_count: number;
	created_at: string;
	updated_at: string;
}

export interface PromptsPageProps {
	prompts: PromptRow[];
}

function promptsScript(): string {
	return `
    async function savePrompt(id) {
      var title = document.getElementById(id ? "edit-title-" + id : "new-title").value.trim();
      var body = document.getElementById(id ? "edit-body-" + id : "new-body").value;
      var tags = document.getElementById(id ? "edit-tags-" + id : "new-tags").value.trim();
      if (!title || !body.trim()) {
        await pawModal.alert("Missing fields", "Title and body are required.");
        return;
      }
      var url = id ? "/api/prompts/" + encodeURIComponent(id) : "/api/prompts";
      var method = id ? "PUT" : "POST";
      var res = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, body: body, tags: tags || null })
      });
      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        await pawModal.alert("Save failed", err.error || ("HTTP " + res.status));
        return;
      }
      window.location.reload();
    }

    async function duplicatePrompt(id) {
      var title = document.getElementById("edit-title-" + id).value.trim();
      var body = document.getElementById("edit-body-" + id).value;
      var tags = document.getElementById("edit-tags-" + id).value.trim();
      if (!title || !body.trim()) {
        await pawModal.alert("Cannot duplicate", "Title and body are required.");
        return;
      }
      var res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title + " (copy)", body: body, tags: tags || null })
      });
      if (res.ok) {
        window.location.reload();
      } else {
        var err = await res.json().catch(function() { return {}; });
        await pawModal.alert("Duplicate failed", err.error || ("HTTP " + res.status));
      }
    }

    async function deletePromptRow(id, title) {
      var ok = await pawModal.confirm("Delete prompt", "Delete \\"" + title + "\\"? This cannot be undone.", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch("/api/prompts/" + encodeURIComponent(id), { method: "DELETE" });
      if (res.ok) window.location.reload();
      else await pawModal.alert("Delete failed", "HTTP " + res.status);
    }

    async function copyPromptBody(id) {
      var ta = document.getElementById("edit-body-" + id);
      if (!ta) return;
      try { await navigator.clipboard.writeText(ta.value); } catch (e) {}
      var btn = document.getElementById("copy-" + id);
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(function() { btn.textContent = orig; }, 1200);
      }
    }
  `;
}

// Exposed for tests (cook+run the cooked client script, mirroring getChatScript).
export function getPromptsScript(): string {
	return promptsScript();
}

export const PromptsPage: FC<PromptsPageProps> = ({ prompts }) => {
	return (
		<Layout title="Prompt Library" currentPath="/prompts">
			<div class="card mb-md">
				<h3>New prompt</h3>
				<div class="flex-col gap-sm max-w-form">
					<input
						type="text"
						id="new-title"
						placeholder="Title (e.g. 'Summarize meeting transcript')"
						class="w-full"
					/>
					<textarea
						id="new-body"
						rows={4}
						placeholder="Prompt body — use {placeholder} markers for parts you'll fill in when inserting."
						class="w-full"
						style="resize: vertical; font-family: var(--font-mono); font-size: 13px"
					/>
					<input
						type="text"
						id="new-tags"
						placeholder="tags, comma, separated"
						class="w-full"
					/>
					<button class="btn-primary self-start" onclick="savePrompt()">
						Save prompt
					</button>
				</div>
			</div>

			<div class="card">
				<h3>Prompts ({prompts.length})</h3>
				{prompts.length > 0 ? (
					<div class="flex-col gap-sm">
						{prompts.map((p) => (
							<details class="prompt-row">
								<summary class="flex justify-between items-center">
									<div class="flex gap-sm items-center">
										<strong>{p.title}</strong>
										{p.tags && (
											<span class="text-xs text-muted">
												{p.tags
													.split(",")
													.map((t) => t.trim())
													.filter(Boolean)
													.join(" · ")}
											</span>
										)}
									</div>
									<span class="text-xs text-muted">
										used {p.use_count}× · {p.updated_at}
									</span>
								</summary>
								<div class="flex-col gap-sm max-w-form" style="padding-top: 8px">
									<input
										type="text"
										id={`edit-title-${p.id}`}
										value={p.title}
										class="w-full"
									/>
									<textarea
										id={`edit-body-${p.id}`}
										rows={4}
										class="w-full"
										style="resize: vertical; font-family: var(--font-mono); font-size: 13px"
									>
										{p.body}
									</textarea>
									<input
										type="text"
										id={`edit-tags-${p.id}`}
										value={p.tags ?? ""}
										placeholder="tags"
										class="w-full"
									/>
									<div class="flex gap-sm">
										<button
											class="btn-primary btn-sm"
											data-prompt-id={p.id}
											onclick="savePrompt(this.dataset.promptId)"
										>
											Save
										</button>
										<button
											class="btn-secondary btn-sm"
											id={`copy-${p.id}`}
											data-prompt-id={p.id}
											onclick="copyPromptBody(this.dataset.promptId)"
										>
											Copy body
										</button>
										<button
											type="button"
											class="btn-secondary btn-sm"
											data-prompt-id={p.id}
											onclick="duplicatePrompt(this.dataset.promptId)"
										>
											Duplicate
										</button>
										<button
											class="btn-danger btn-sm"
											data-prompt-id={p.id}
											data-prompt-title={p.title}
											onclick="deletePromptRow(this.dataset.promptId, this.dataset.promptTitle)"
										>
											Delete
										</button>
									</div>
								</div>
							</details>
						))}
					</div>
				) : (
					<div class="empty-state">
						<p>No prompts yet — add one above.</p>
					</div>
				)}
			</div>

			{raw(`<script>${promptsScript()}</script>`)}
		</Layout>
	);
};
