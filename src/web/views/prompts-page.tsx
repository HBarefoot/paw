import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { icon } from "./icons.js";
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

function parseTags(tags: string | null): string[] {
	return (tags ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

function promptsScript(): string {
	return `
    var activeTag = "all";

    function filterPrompts() {
      var q = (document.getElementById("prompt-search").value || "").toLowerCase();
      var cards = document.querySelectorAll("#prompt-cards .pcard");
      var shown = 0;
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var hay = card.getAttribute("data-search") || "";
        var tags = card.getAttribute("data-tags") || "";
        var tagOk = activeTag === "all" || tags.split("|").indexOf(activeTag) !== -1;
        var textOk = !q || hay.indexOf(q) !== -1;
        var on = tagOk && textOk;
        card.style.display = on ? "" : "none";
        if (on) shown++;
      }
      var empty = document.getElementById("prompt-empty");
      if (empty) empty.style.display = shown === 0 ? "" : "none";
    }

    function selectTag(btn, tag) {
      activeTag = tag;
      var btns = btn.parentElement.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove("on");
      btn.classList.add("on");
      filterPrompts();
    }

    function field(labelText, value, multiline) {
      var f = document.createElement("div");
      f.className = "field";
      var lab = document.createElement("label");
      lab.textContent = labelText;
      f.appendChild(lab);
      var input = document.createElement(multiline ? "textarea" : "input");
      input.value = value || "";
      if (multiline) { input.rows = 7; input.style.minHeight = "150px"; input.style.fontFamily = "var(--font-mono)"; }
      f.appendChild(input);
      f.__input = input;
      return f;
    }

    function openPromptEditor(id) {
      var card = id ? document.querySelector('.pcard[data-id="' + id + '"]') : null;
      var title = card ? card.getAttribute("data-title") : "";
      var body = card ? card.getAttribute("data-body") : "";
      var tags = card ? card.getAttribute("data-tags-raw") : "";
      var wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "14px";
      var fTitle = field("Title", title, false);
      var fBody = field("Prompt body — use {{variables}} for fill-ins", body, true);
      var fTags = field("Tags (comma separated)", tags, false);
      wrap.appendChild(fTitle);
      wrap.appendChild(fBody);
      wrap.appendChild(fTags);
      pawModal._show(id ? "Edit Prompt" : "New Prompt", wrap, [
        { label: "Cancel", cls: "btn-cancel", onclick: function() { pawModal._close(); } },
        { label: "Save", cls: "btn-confirm", onclick: function() { savePromptFrom(id, fTitle.__input.value, fBody.__input.value, fTags.__input.value); } }
      ]);
      fTitle.__input.focus();
    }

    async function savePromptFrom(id, title, body, tags) {
      title = (title || "").trim();
      if (!title || !body.trim()) {
        await pawModal.alert("Missing fields", "Title and body are required.");
        return;
      }
      var url = id ? "/api/prompts/" + encodeURIComponent(id) : "/api/prompts";
      var method = id ? "PUT" : "POST";
      var res = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, body: body, tags: tags.trim() || null })
      });
      if (res.ok) { window.location.reload(); return; }
      var err = await res.json().catch(function() { return {}; });
      await pawModal.alert("Save failed", err.error || ("HTTP " + res.status));
    }

    async function copyPrompt(id) {
      var card = document.querySelector('.pcard[data-id="' + id + '"]');
      if (!card) return;
      try { await navigator.clipboard.writeText(card.getAttribute("data-body")); } catch (e) {}
      if (window.pawToast) pawToast("Copied prompt", "copy");
    }

    async function duplicatePrompt(id) {
      var card = document.querySelector('.pcard[data-id="' + id + '"]');
      if (!card) return;
      var res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: card.getAttribute("data-title") + " (copy)", body: card.getAttribute("data-body"), tags: card.getAttribute("data-tags-raw") || null })
      });
      if (res.ok) window.location.reload();
      else await pawModal.alert("Duplicate failed", "HTTP " + res.status);
    }

    async function deletePromptRow(id) {
      var card = document.querySelector('.pcard[data-id="' + id + '"]');
      var name = card ? card.getAttribute("data-title") : "";
      var ok = await pawModal.confirm("Delete prompt", "Delete " + name + "? This cannot be undone.", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch("/api/prompts/" + encodeURIComponent(id), { method: "DELETE" });
      if (res.ok) window.location.reload();
      else await pawModal.alert("Delete failed", "HTTP " + res.status);
    }
  `;
}

// Exposed for the cook+run template-trap test.
export function getPromptsScript(): string {
	return promptsScript();
}

export const PromptsPage: FC<PromptsPageProps> = ({ prompts }) => {
	const allTags = Array.from(
		new Set(prompts.flatMap((p) => parseTags(p.tags))),
	);
	return (
		<Layout title="Prompts" currentPath="/prompts">
			<div class="page-grid">
				<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
					<div class="search-box" style="width:280px">
						{raw(icon("search", 15))}
						<input
							id="prompt-search"
							type="search"
							placeholder="Search prompts…"
							oninput="filterPrompts()"
						/>
					</div>
					<div class="seg">
						<button type="button" class="on" onclick="selectTag(this,'all')">
							all
						</button>
						{allTags.map((t) => (
							<button
								key={t}
								type="button"
								data-tag={t}
								onclick="selectTag(this,this.dataset.tag)"
							>
								{t}
							</button>
						))}
					</div>
					<div style="flex:1" />
					<button
						type="button"
						class="btn-primary"
						onclick="openPromptEditor('')"
					>
						{raw(icon("plus", 14))} New Prompt
					</button>
				</div>

				<div class="cards" id="prompt-cards">
					{prompts.map((p) => {
						const tags = parseTags(p.tags);
						const search =
							`${p.title} ${p.body} ${tags.join(" ")}`.toLowerCase();
						return (
							<div
								key={p.id}
								class="pcard"
								data-id={p.id}
								data-title={p.title}
								data-body={p.body}
								data-tags={tags.join("|")}
								data-tags-raw={p.tags ?? ""}
								data-search={search}
							>
								<div class="ph">
									<div class="pt">{p.title}</div>
								</div>
								<div class="ppreview">{p.body}</div>
								{tags.length > 0 && (
									<div class="ptags">
										{tags.map((t) => (
											<span key={t} class="tag">
												{t}
											</span>
										))}
									</div>
								)}
								<div class="pfoot">
									<span class="usage">
										used {p.use_count}× · {p.updated_at}
									</span>
									<div style="display:flex;gap:2px">
										<button
											type="button"
											class="icobtn"
											title="Copy"
											data-id={p.id}
											onclick="copyPrompt(this.dataset.id)"
										>
											{raw(icon("copy", 15))}
										</button>
										<button
											type="button"
											class="icobtn"
											title="Edit"
											data-id={p.id}
											onclick="openPromptEditor(this.dataset.id)"
										>
											{raw(icon("edit", 15))}
										</button>
										<button
											type="button"
											class="icobtn"
											title="Duplicate"
											data-id={p.id}
											onclick="duplicatePrompt(this.dataset.id)"
										>
											{raw(icon("dots", 15))}
										</button>
										<button
											type="button"
											class="icobtn danger"
											title="Delete"
											data-id={p.id}
											onclick="deletePromptRow(this.dataset.id)"
										>
											{raw(icon("trash", 15))}
										</button>
									</div>
								</div>
							</div>
						);
					})}
				</div>

				<div
					class="empty-state"
					id="prompt-empty"
					style={prompts.length === 0 ? "" : "display:none"}
				>
					{raw(icon("prompts", 30))}
					<div class="t">
						{prompts.length === 0 ? "No prompts yet" : "No prompts match"}
					</div>
					<div class="s">Create one with “New Prompt”.</div>
				</div>
			</div>

			{raw(`<script>${promptsScript()}</script>`)}
		</Layout>
	);
};
