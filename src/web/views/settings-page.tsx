import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { Brand } from "../../store/brands.js";
import type { PawConfig } from "../../types/config.js";
import { icon } from "./icons.js";
import { Layout } from "./layout.js";

// ---------------------------------------------------------------------------
// Consolidated Settings — the design's single set-nav page. Replaces the former
// /config, /brand and /preferences pages. The config sections live in ONE form
// that posts to /settings (same handler the old /config form used); Brand,
// Companion and Secrets are self-contained (fetch-based) sections.
// ---------------------------------------------------------------------------

interface AgentEntry {
	name: string;
	description: string;
	systemPrompt: string;
	skills: string[];
	provider?: string;
	maxRoundtrips?: number;
}

export interface SecretStatus {
	id: string;
	label: string;
	set: boolean;
	fromEnv?: boolean;
}

export interface SettingsPageProps {
	config: PawConfig;
	saved?: boolean;
	error?: string;
	icpSampleCities?: string[];
	icpExcludeBrands?: string[];
	agents?: AgentEntry[];
	secrets?: SecretStatus[];
	brands: Brand[];
	defaultAvatar?: string;
}

// Selectable companion avatars. KEYS MUST MATCH src/web/public/companion/shell.js
// (AVATARS); a test guards the sync.
export const AVATAR_OPTIONS: Array<{
	key: string;
	label: string;
	desc: string;
}> = [
	{ key: "gel", label: "Gel Sphere", desc: "The original glossy living orb." },
	{
		key: "robot-halo",
		label: "Robot · Halo",
		desc: "Antenna, block eyes, a friendly mouth.",
	},
	{
		key: "robot-visor",
		label: "Robot · Visor",
		desc: "Sleek single visor band.",
	},
	{
		key: "robot-cylon",
		label: "Robot · Cylon",
		desc: "A sweeping scanner slit.",
	},
	{ key: "robot-lcd", label: "Robot · LCD", desc: "Retro dot-screen face." },
];

const SECTIONS: Array<{
	key: string;
	label: string;
	icon: string;
	form: boolean;
}> = [
	{ key: "general", label: "General", icon: "settings", form: true },
	{ key: "agent", label: "Agent", icon: "sparkles", form: true },
	{ key: "provider", label: "AI Provider", icon: "zap", form: true },
	{ key: "memory", label: "Memory", icon: "memory", form: true },
	{ key: "web", label: "Web & Canvas", icon: "globe", form: true },
	{ key: "security", label: "Security", icon: "shield", form: true },
	{ key: "advanced", label: "Advanced", icon: "cpu", form: true },
	{ key: "agents", label: "Agents", icon: "flow", form: true },
	{ key: "integrations", label: "Integrations", icon: "flow", form: true },
	{ key: "brand", label: "Brand Kit", icon: "brand", form: false },
	{ key: "companion", label: "Companion", icon: "user", form: false },
	{ key: "secrets", label: "Secrets", icon: "key", form: false },
];

// --- small controls -------------------------------------------------------
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

function Row({
	label,
	desc,
	children,
}: {
	label: string;
	desc?: string;
	children: unknown;
}) {
	return (
		<div class="set-row">
			<div class="sl">
				<div class="lab">{label}</div>
				{desc && <div class="desc">{desc}</div>}
			</div>
			<div class="sc">{children as never}</div>
		</div>
	);
}

function Section({
	keyName,
	title,
	icon: ic,
	form,
	children,
}: {
	keyName: string;
	title: string;
	icon: string;
	form: boolean;
	children: unknown;
}) {
	return (
		<section
			class="settings-section panel"
			data-section={keyName}
			data-form={form ? "1" : "0"}
			style={keyName === "general" ? "" : "display:none"}
		>
			<div class="panel-hd">
				<div class="ttl">
					<span class="ico">{raw(icon(ic, 16))}</span>
					{title}
				</div>
			</div>
			<div class="panel-bd">{children as never}</div>
		</section>
	);
}

// --- brand section (ported from the former /brand page) -------------------
const COLOR_KEYS = ["primary", "accent", "bg", "surface", "text", "muted"];

function colorRow(brand: Brand | null, key: string) {
	const val = brand?.data.colors?.[key] ?? "";
	const safe = /^#[0-9a-fA-F]{6}$/.test(val) ? val : "#000000";
	return (
		<label class="brand-color">
			<span class="brand-color-label">{key}</span>
			{raw(
				`<input type="color" class="brand-color-pick" data-color="${key}" value="${safe}">`,
			)}
			{raw(
				`<input type="text" class="brand-color-hex field" data-colorhex="${key}" value="${val}" placeholder="#—">`,
			)}
		</label>
	);
}

function brandCard(brand: Brand | null) {
	const d = brand?.data;
	const id = brand?.id ?? "";
	const logo = d?.logos?.light ? `/api/brand/asset/${id}/${d.logos.light}` : "";
	return (
		<div class="card brand-card" data-id={id}>
			<div class="flex justify-between items-center mb-md">
				<input
					type="text"
					class="field brand-name"
					value={brand?.name ?? ""}
					placeholder="Brand name"
					style="max-width:280px;font-weight:600"
				/>
				<div class="flex gap-sm items-center">
					{brand?.active ? (
						<span class="pill-badge green">Active</span>
					) : id ? (
						<button
							type="button"
							class="btn-secondary btn-sm brand-activate"
							onclick="brandActivate(this)"
						>
							Set active
						</button>
					) : null}
					{id ? (
						<button
							type="button"
							class="btn-danger btn-sm brand-delete"
							onclick="brandDelete(this)"
						>
							Delete
						</button>
					) : null}
				</div>
			</div>

			<div class="brand-grid">
				<div>
					<label>Tagline</label>
					<input
						type="text"
						class="field w-full brand-tagline"
						value={d?.tagline ?? ""}
						placeholder="Short brand tagline / positioning"
					/>

					<label style="margin-top:12px">Chat label</label>
					<input
						type="text"
						class="field w-full brand-chat-label"
						value={d?.chatLabel ?? ""}
						placeholder="Sidebar + chat page label (default: Chat)"
					/>

					<label style="margin-top:12px">Colors</label>
					<div class="brand-colors">
						{COLOR_KEYS.map((k) => colorRow(brand, k))}
					</div>

					<div class="grid-2-fonts" style="margin-top:12px">
						<div>
							<label>Display font</label>
							<input
								type="text"
								class="field w-full brand-font"
								data-font="display"
								value={d?.fonts?.display ?? ""}
								placeholder="e.g. Space Grotesk"
							/>
						</div>
						<div>
							<label>Body font</label>
							<input
								type="text"
								class="field w-full brand-font"
								data-font="body"
								value={d?.fonts?.body ?? ""}
								placeholder="e.g. Inter"
							/>
						</div>
					</div>
					<label style="margin-top:12px">
						Google Fonts URL <span class="text-muted text-xs">(optional)</span>
					</label>
					<input
						type="text"
						class="field w-full brand-font"
						data-font="googleFontsUrl"
						value={d?.fonts?.googleFontsUrl ?? ""}
						placeholder="https://fonts.googleapis.com/css2?family=…"
					/>
				</div>

				<div>
					<label>Logo</label>
					<div class="brand-logo-box">
						{logo ? (
							raw(`<img class="brand-logo-preview" src="${logo}" alt="logo">`)
						) : (
							<div class="brand-logo-empty">No logo</div>
						)}
					</div>
					{id ? (
						raw(
							`<input type="file" class="brand-logo-input" accept="image/*" style="display:none" onchange="brandUploadLogo(this)">`,
						)
					) : (
						<div class="text-muted text-xs">
							Save the brand first to upload a logo.
						</div>
					)}
					{id ? (
						<button
							type="button"
							class="btn-secondary btn-sm w-full mt-sm"
							onclick="this.parentElement.querySelector('.brand-logo-input').click()"
						>
							Upload logo
						</button>
					) : null}
					{raw(
						`<input type="file" class="brand-analyze-input" accept="image/*" style="display:none" onchange="brandAnalyze(this)">`,
					)}
					<button
						type="button"
						class="btn-ghost btn-sm w-full mt-sm"
						onclick="this.parentElement.querySelector('.brand-analyze-input').click()"
						title="Upload a logo or brand-guide image; the agent infers your palette, fonts and voice"
					>
						✨ Analyze with AI
					</button>

					<label style="margin-top:12px">Voice &amp; tone</label>
					<textarea
						class="field w-full brand-voice"
						rows={3}
						placeholder="e.g. Confident, technical, warm. Avoid jargon."
					>
						{d?.voice ?? ""}
					</textarea>
				</div>
			</div>

			<label style="margin-top:12px">Guidelines</label>
			<textarea
				class="field w-full brand-guidelines"
				rows={4}
				placeholder="Do's and don'ts, layout rules, imagery, logo clearspace…"
			>
				{d?.guidelines ?? ""}
			</textarea>

			<div class="flex gap-sm mt-md">
				<button
					type="button"
					class="btn-primary btn-sm brand-save"
					onclick="brandSave(this)"
				>
					{id ? "Save changes" : "Create brand"}
				</button>
				<span
					class="brand-status text-xs text-muted"
					style="align-self:center"
				/>
			</div>
		</div>
	);
}

function brandStyles(): string {
	return `
    .brand-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; }
    @media (max-width: 820px){ .brand-grid { grid-template-columns: 1fr; } }
    .grid-2-fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .brand-colors { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .brand-color { display: flex; align-items: center; gap: 8px; }
    .brand-color-label { font-family: var(--font-mono); font-size: 11px; width: 56px; color: var(--text-tertiary); text-transform: uppercase; }
    .brand-color-pick { width: 30px; height: 30px; padding: 0; border: 1px solid var(--border-primary); border-radius: var(--radius-sm); background: none; cursor: pointer; box-shadow: none; flex: none; }
    .brand-color-hex { width: 92px; font-family: var(--font-mono); font-size: 12px; }
    .brand-logo-box { border: 1px solid var(--border-primary); border-radius: var(--radius-md); min-height: 96px; display: grid; place-items: center; background: var(--bg-secondary); overflow: hidden; padding: 8px; }
    .brand-logo-preview { max-width: 100%; max-height: 120px; object-fit: contain; }
    .brand-logo-empty { color: var(--text-tertiary); font-size: 13px; }
    .avatar-pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px,1fr)); gap: 10px; }
    .avatar-pick { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--panel-2); color: var(--ink); text-align: left; box-shadow: none; }
    .avatar-pick:hover { border-color: var(--line-2); background: var(--panel-3); }
    .avatar-pick.active { border-color: var(--accent-line); background: var(--accent-subtle); color: var(--ink-bright); }
    .settings-save { margin-top: 16px; }
  `;
}

// --- combined client script ----------------------------------------------
function settingsScript(defaultAvatar: string): string {
	return `
    // set-nav section switching (and the save bar visibility for form sections)
    function settingsSelect(key) {
      var secs = document.querySelectorAll(".settings-section");
      var active = null;
      for (var i = 0; i < secs.length; i++) {
        var on = secs[i].getAttribute("data-section") === key;
        secs[i].style.display = on ? "" : "none";
        if (on) active = secs[i];
      }
      var btns = document.querySelectorAll("#set-nav button");
      for (var j = 0; j < btns.length; j++) btns[j].classList.toggle("on", btns[j].getAttribute("data-section") === key);
      var save = document.getElementById("settings-save");
      if (save) save.style.display = active && active.getAttribute("data-form") === "1" ? "" : "none";
      try { localStorage.setItem("paw-settings-section", key); } catch (e) {}
    }
    (function () {
      var key = "general";
      try { key = localStorage.getItem("paw-settings-section") || "general"; } catch (e) {}
      if (!document.querySelector('.settings-section[data-section="' + key + '"]')) key = "general";
      settingsSelect(key);
    })();

    function pawToggle(btn) {
      var on = btn.classList.toggle("on");
      var inp = btn.previousElementSibling;
      if (inp) inp.value = on ? "true" : "false";
    }

    // --- Agents add/remove ---
    (function () {
      var list = document.getElementById("agents-list");
      var addBtn = document.getElementById("add-agent-btn");
      if (!list || !addBtn) return;
      function nextIdx() {
        var entries = list.querySelectorAll(".agent-entry");
        var max = -1;
        entries.forEach(function (e) { var i = parseInt(e.dataset.idx, 10); if (i > max) max = i; });
        return max + 1;
      }
      addBtn.addEventListener("click", function () {
        var idx = nextIdx();
        var div = document.createElement("div");
        div.className = "agent-entry";
        div.dataset.idx = idx;
        div.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:12px;position:relative;";
        div.innerHTML = '<button type="button" class="btn-remove-agent" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--ink-dim);cursor:pointer;font-size:18px;padding:4px 8px;" title="Remove agent">&times;</button>'
          + '<table style="width:100%"><tbody>'
          + '<tr><td style="width:120px">Name</td><td><input type="text" name="agents[' + idx + '].name" class="input-md" placeholder="my-agent" required></td></tr>'
          + '<tr><td>Description</td><td><input type="text" name="agents[' + idx + '].description" class="w-full" placeholder="What this agent does" required></td></tr>'
          + '<tr><td style="vertical-align:top;padding-top:12px">System Prompt</td><td><textarea name="agents[' + idx + '].systemPrompt" rows="4" class="w-full" style="resize:vertical;font-family:var(--font-mono);font-size:13px" placeholder="You are a specialized agent..." required></textarea></td></tr>'
          + '<tr><td>Skills</td><td><input type="text" name="agents[' + idx + '].skills" class="w-full" placeholder="icp-discovery, memory, files"><span class="text-muted text-xs">Comma-separated skill names.</span></td></tr>'
          + '<tr><td>Provider</td><td><select name="agents[' + idx + '].provider"><option value="">Default (inherit)</option><option value="claude">Claude</option><option value="ollama">Ollama</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></td></tr>'
          + '<tr><td>Max Roundtrips</td><td><input type="number" name="agents[' + idx + '].maxRoundtrips" min="1" max="50" class="input-sm" placeholder="Default"></td></tr>'
          + '</tbody></table>';
        list.appendChild(div);
      });
      list.addEventListener("click", function (e) {
        if (e.target.classList.contains("btn-remove-agent")) e.target.closest(".agent-entry").remove();
      });
    })();

    // --- n8n endpoints + reconnect ---
    (function () {
      var list = document.getElementById("n8n-endpoints");
      var addBtn = document.getElementById("add-n8n-ep");
      if (!list || !addBtn) return;
      function addRow(name, url) {
        var div = document.createElement("div");
        div.className = "n8n-ep flex gap-sm items-center";
        div.style.marginBottom = "8px";
        div.innerHTML = '<input type="text" class="n8n-ep-name input-md" placeholder="name (e.g. enrichment-hunter)">'
          + '<input type="text" class="n8n-ep-url w-full" placeholder="https://n8n.example.com/mcp/…">'
          + '<button type="button" class="btn-remove-ep btn-ghost btn-sm" title="Remove">&times;</button>';
        div.querySelector(".n8n-ep-name").value = name || "";
        div.querySelector(".n8n-ep-url").value = url || "";
        list.appendChild(div);
      }
      addBtn.addEventListener("click", function () { addRow("", ""); });
      list.addEventListener("click", function (e) {
        if (e.target.classList.contains("btn-remove-ep")) e.target.closest(".n8n-ep").remove();
      });
      var form = document.getElementById("settings-form");
      if (form) form.addEventListener("submit", function () {
        var eps = [];
        list.querySelectorAll(".n8n-ep").forEach(function (row) {
          var n = row.querySelector(".n8n-ep-name").value.trim();
          var u = row.querySelector(".n8n-ep-url").value.trim();
          if (n && u) eps.push({ name: n, url: u });
        });
        document.getElementById("n8n-endpoints-json").value = JSON.stringify(eps);
      });
      window.reconnectN8n = function (btn) {
        btn.disabled = true; var orig = btn.textContent; btn.textContent = "Reconnecting…";
        fetch("/api/n8n/reconnect", { method: "POST" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.error) pawModal.alert("Error", d.error);
            else pawModal.alert("n8n", "Connected " + (d.connected ? d.connected.length : 0) + " of " + (d.total || 0) + " endpoint(s). Save the form first if you changed values.");
            btn.disabled = false; btn.textContent = orig;
          })
          .catch(function (e) { pawModal.alert("Error", String(e)); btn.disabled = false; btn.textContent = orig; });
      };
    })();

    // --- Brand CRUD ---
    function collectBrand(card) {
      var colors = {};
      card.querySelectorAll("[data-colorhex]").forEach(function (i) { if (i.value.trim()) colors[i.dataset.colorhex] = i.value.trim(); });
      var fonts = {};
      card.querySelectorAll("[data-font]").forEach(function (i) { if (i.value.trim()) fonts[i.dataset.font] = i.value.trim(); });
      return {
        name: card.querySelector(".brand-name").value.trim(),
        data: {
          tagline: card.querySelector(".brand-tagline").value.trim(),
          chatLabel: card.querySelector(".brand-chat-label").value.trim(),
          colors: colors,
          fonts: fonts,
          voice: card.querySelector(".brand-voice").value.trim(),
          guidelines: card.querySelector(".brand-guidelines").value.trim(),
        }
      };
    }
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.color) { var hex = t.closest(".brand-color").querySelector("[data-colorhex]"); if (hex) hex.value = t.value; }
      if (t.dataset && t.dataset.colorhex && /^#[0-9a-fA-F]{6}$/.test(t.value)) { var pick = t.closest(".brand-color").querySelector("[data-color]"); if (pick) pick.value = t.value; }
    });
    window.brandSave = async function (btn) {
      var card = btn.closest(".brand-card");
      var payload = collectBrand(card);
      if (!payload.name) { pawModal.alert("Name required", "Give the brand a name."); return; }
      var id = card.dataset.id;
      var status = card.querySelector(".brand-status"); status.textContent = "Saving…";
      try {
        var res = await fetch(id ? "/api/brands/" + id : "/api/brands", {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) { status.textContent = ""; pawModal.alert("Error", data.error || "Save failed"); return; }
        status.textContent = "Saved.";
        if (!id && data.brand) { card.dataset.id = data.brand.id; window.location.reload(); }
      } catch (e) { status.textContent = ""; pawModal.alert("Error", String(e)); }
    };
    window.brandActivate = async function (btn) {
      var id = btn.closest(".brand-card").dataset.id;
      var res = await fetch("/api/brands/" + id + "/activate", { method: "POST" });
      if (res.ok) window.location.reload(); else pawModal.alert("Error", "Could not activate.");
    };
    window.brandDelete = async function (btn) {
      var card = btn.closest(".brand-card");
      var id = card.dataset.id;
      var ok = await pawModal.confirm("Delete brand", "Delete this brand and its assets?", { confirmLabel: "Delete", danger: true });
      if (!ok) return;
      var res = await fetch("/api/brands/" + id, { method: "DELETE" });
      if (res.ok) card.remove(); else pawModal.alert("Error", "Delete failed.");
    };
    function readFileB64(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
        r.onerror = reject; r.readAsDataURL(file);
      });
    }
    window.brandUploadLogo = async function (input) {
      var card = input.closest(".brand-card"); var id = card.dataset.id;
      if (!id) { pawModal.alert("Save first", "Create the brand before uploading a logo."); return; }
      var file = input.files && input.files[0]; if (!file) return;
      var b64 = await readFileB64(file);
      var res = await fetch("/api/brands/" + id + "/logo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "light", data: b64, mimeType: file.type })
      });
      var data = await res.json();
      if (!res.ok) { pawModal.alert("Error", data.error || "Upload failed"); return; }
      var box = card.querySelector(".brand-logo-box");
      box.innerHTML = '<img class="brand-logo-preview" src="' + data.url + "?t=" + Date.now() + '" alt="logo">';
    };
    window.brandAnalyze = async function (input) {
      var card = input.closest(".brand-card");
      var file = input.files && input.files[0]; if (!file) return;
      var status = card.querySelector(".brand-status"); status.textContent = "Analyzing…";
      try {
        var b64 = await readFileB64(file);
        var res = await fetch("/api/brands/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: b64, mimeType: file.type })
        });
        var data = await res.json();
        if (!res.ok) { status.textContent = ""; pawModal.alert("Analysis failed", data.error || "Could not analyze."); return; }
        var s = data.suggestion || {};
        if (s.name && !card.querySelector(".brand-name").value) card.querySelector(".brand-name").value = s.name;
        if (s.tagline) card.querySelector(".brand-tagline").value = s.tagline;
        if (s.colors) Object.keys(s.colors).forEach(function (k) { var hex = card.querySelector('[data-colorhex="' + k + '"]'); if (hex) { hex.value = s.colors[k]; var pick = card.querySelector('[data-color="' + k + '"]'); if (pick && /^#[0-9a-fA-F]{6}$/.test(s.colors[k])) pick.value = s.colors[k]; } });
        if (s.fonts) Object.keys(s.fonts).forEach(function (k) { var f = card.querySelector('[data-font="' + k + '"]'); if (f) f.value = s.fonts[k]; });
        if (s.voice) card.querySelector(".brand-voice").value = s.voice;
        if (s.guidelines) card.querySelector(".brand-guidelines").value = s.guidelines;
        status.textContent = "Prefilled from analysis — review and Save.";
      } catch (e) { status.textContent = ""; pawModal.alert("Error", String(e)); }
    };
    window.brandAdd = function () {
      var empty = document.getElementById("brand-empty"); if (empty) empty.remove();
      var tpl = document.getElementById("brand-card-template");
      var node = tpl.content ? tpl.content.cloneNode(true) : null;
      if (node) document.getElementById("brands-list").prepend(node);
    };

    // --- Companion avatar ---
    function pawSetAvatar(key) {
      try { localStorage.setItem("paw-avatar", key); } catch (e) {}
      document.querySelectorAll(".avatar-pick").forEach(function (b) { b.classList.toggle("active", b.dataset.avatar === key); });
    }
    window.pawSetAvatar = pawSetAvatar;
    (function () {
      var cur = null;
      try { cur = localStorage.getItem("paw-avatar"); } catch (e) {}
      cur = cur || ${JSON.stringify(defaultAvatar)};
      document.querySelectorAll(".avatar-pick").forEach(function (b) { b.classList.toggle("active", b.dataset.avatar === cur); });
    })();

    // --- Secrets rotation ---
    window.rotateSecret = async function (id, label) {
      var value = await pawModal.prompt("Rotate " + label, "Paste the new secret value. It will be written to the vault / credentials file and never displayed again.", "");
      if (!value) return;
      try {
        var res = await fetch("/api/credentials/" + encodeURIComponent(id), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: value })
        });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); pawModal.alert("Rotate failed", err.error || ("HTTP " + res.status)); return; }
        pawModal.alert("Rotated", label + " was updated. Restart the process for the running provider to pick up the new value.");
        setTimeout(function () { window.location.reload(); }, 400);
      } catch (e) { pawModal.alert("Rotate failed", String(e)); }
    };
  `;
}

// Exposed for the cook+run template-trap test + avatar-sync test.
export function getSettingsScript(): string {
	return settingsScript("gel");
}
export function getPreferencesScript(): string {
	return settingsScript("gel");
}

export const SettingsPage: FC<SettingsPageProps> = ({
	config,
	saved,
	error,
	icpSampleCities,
	icpExcludeBrands,
	agents,
	secrets,
	brands,
	defaultAvatar,
}) => {
	const model =
		config.provider === "claude" ? config.ai.model : config.ollama.model;
	return (
		<Layout title="Settings" currentPath="/settings">
			{saved && (
				<div class="alert alert-success">
					Settings saved. Some changes may require a restart.
				</div>
			)}
			{error && <div class="alert alert-error">{error}</div>}

			<div class="settings-wrap">
				<nav class="set-nav" id="set-nav">
					{SECTIONS.map((s) => (
						<button
							key={s.key}
							type="button"
							data-section={s.key}
							class={s.key === "general" ? "on" : ""}
							onclick="settingsSelect(this.dataset.section)"
						>
							{raw(icon(s.icon, 16))}
							{s.label}
						</button>
					))}
				</nav>

				<div>
					<form method="post" action="/settings" id="settings-form">
						<Section keyName="general" title="General" icon="settings" form>
							<div class="set-group">
								<Row
									label="Agent name"
									desc="Shown across the console and in chat."
								>
									<input
										type="text"
										name="agent.name"
										value={config.agent.name}
										class="input-md"
										placeholder="Paw"
									/>
								</Row>
							</div>
						</Section>

						<Section keyName="agent" title="Agent" icon="sparkles" form>
							<div class="field">
								<label>System prompt</label>
								<textarea
									name="agent.systemPrompt"
									rows={8}
									class="w-full"
									style="resize:vertical;font-family:var(--font-mono);font-size:13px"
									placeholder="You are Paw, a personal AI assistant…"
								>
									{config.agent.systemPrompt}
								</textarea>
								<span class="hint">
									Operational guidelines (tools, memory) are always appended
									automatically.
								</span>
							</div>
							<div class="set-group" style="margin-top:8px">
								<Row label="Max tokens" desc="Per-response generation cap.">
									<input
										type="number"
										name="ai.maxTokens"
										value={String(config.ai.maxTokens)}
										min="1"
										class="input-sm"
									/>
								</Row>
							</div>
						</Section>

						<Section keyName="provider" title="AI Provider" icon="zap" form>
							<div class="set-group">
								<Row label="Provider" desc="Set via the CLI.">
									<span class="bright">{config.provider}</span>
								</Row>
								<Row label="Model">
									<input
										type="text"
										name="ai.model"
										value={model}
										class="input-lg"
									/>
								</Row>
							</div>
						</Section>

						<Section keyName="memory" title="Memory" icon="memory" form>
							<div class="set-group">
								<Row
									label="Memory enabled"
									desc="Persist facts across sessions."
								>
									<Bool name="memory.enabled" value={config.memory.enabled} />
								</Row>
								<Row
									label="Auto-extract facts"
									desc="Pull durable facts from conversations."
								>
									<Bool
										name="memory.autoExtract"
										value={config.memory.autoExtract}
									/>
								</Row>
								<Row label="Vector weight" desc="Hybrid recall weighting.">
									<input
										type="number"
										name="memory.vectorWeight"
										value={String(config.memory.vectorWeight)}
										step="0.1"
										min="0"
										max="1"
										class="input-sm"
									/>
								</Row>
								<Row label="FTS weight">
									<input
										type="number"
										name="memory.ftsWeight"
										value={String(config.memory.ftsWeight)}
										step="0.1"
										min="0"
										max="1"
										class="input-sm"
									/>
								</Row>
							</div>
						</Section>

						<Section keyName="web" title="Web & Canvas" icon="globe" form>
							<div class="set-group">
								<Row label="Host" desc="Restart required.">
									<input
										type="text"
										value={config.web.host}
										disabled
										class="input-md"
									/>
								</Row>
								<Row label="Port" desc="Restart required.">
									<input
										type="number"
										value={String(config.web.port)}
										disabled
										class="input-sm"
									/>
								</Row>
							</div>
						</Section>

						<Section keyName="security" title="Security" icon="shield" form>
							<div class="set-group">
								<Row
									label="Enforce permissions"
									desc="Sandbox tool execution against manifests."
								>
									<Bool
										name="security.enforcePermissions"
										value={config.security.enforcePermissions}
									/>
								</Row>
								<Row label="Require approval" desc="Gate irreversible actions.">
									<Bool
										name="security.requireApproval"
										value={config.security.requireApproval}
									/>
								</Row>
								<Row label="Rate limiting">
									<Bool
										name="security.rateLimiting.enabled"
										value={config.security.rateLimiting.enabled}
									/>
								</Row>
								<Row label="Max requests / min">
									<input
										type="number"
										name="security.rateLimiting.maxRequestsPerMinute"
										value={String(
											config.security.rateLimiting.maxRequestsPerMinute,
										)}
										min="1"
										class="input-sm"
									/>
								</Row>
							</div>
						</Section>

						<Section keyName="advanced" title="Advanced" icon="cpu" form>
							<div class="set-group">
								<Row label="Heartbeat enabled">
									<Bool
										name="heartbeat.enabled"
										value={config.heartbeat.enabled}
									/>
								</Row>
								<Row label="Heartbeat interval (min)">
									<input
										type="number"
										name="heartbeat.intervalMinutes"
										value={String(config.heartbeat.intervalMinutes)}
										min="1"
										class="input-sm"
									/>
								</Row>
								<Row label="AI investigation on failure">
									<Bool
										name="heartbeat.triggerAiOnFailure"
										value={config.heartbeat.triggerAiOnFailure}
									/>
								</Row>
								<Row label="Cron enabled">
									<Bool name="cron.enabled" value={config.cron.enabled} />
								</Row>
								<Row label="Cron tick interval (ms)">
									<input
										type="number"
										name="cron.tickIntervalMs"
										value={String(config.cron.tickIntervalMs)}
										min="1000"
										class="input-md"
									/>
								</Row>
								<Row label="Log level">
									<select name="log.level">
										{["debug", "info", "warn", "error"].map((lvl) => (
											<option
												key={lvl}
												value={lvl}
												selected={config.log.level === lvl}
											>
												{lvl}
											</option>
										))}
									</select>
								</Row>
							</div>
						</Section>

						<Section keyName="agents" title="Agents" icon="flow" form>
							<p class="text-muted text-sm" style="margin-bottom:12px">
								Agent presets suggested when the main AI uses spawn_agent.
								Changes require a restart.
							</p>
							<div id="agents-list">
								{(agents ?? []).map((agent, idx) => (
									<div
										key={agent.name || String(idx)}
										class="agent-entry"
										data-idx={String(idx)}
										style="border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:12px;position:relative;"
									>
										<button
											type="button"
											class="btn-remove-agent"
											style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--ink-dim);cursor:pointer;font-size:18px;padding:4px 8px;"
											title="Remove agent"
										>
											&times;
										</button>
										<table style="width:100%">
											<tbody>
												<tr>
													<td style="width:120px">Name</td>
													<td>
														<input
															type="text"
															name={`agents[${idx}].name`}
															value={agent.name}
															class="input-md"
															placeholder="my-agent"
															required
														/>
													</td>
												</tr>
												<tr>
													<td>Description</td>
													<td>
														<input
															type="text"
															name={`agents[${idx}].description`}
															value={agent.description}
															class="w-full"
															placeholder="What this agent does"
															required
														/>
													</td>
												</tr>
												<tr>
													<td style="vertical-align:top;padding-top:12px">
														System Prompt
													</td>
													<td>
														<textarea
															name={`agents[${idx}].systemPrompt`}
															rows={4}
															class="w-full"
															style="resize:vertical;font-family:var(--font-mono);font-size:13px"
															required
														>
															{agent.systemPrompt}
														</textarea>
													</td>
												</tr>
												<tr>
													<td>Skills</td>
													<td>
														<input
															type="text"
															name={`agents[${idx}].skills`}
															value={agent.skills.join(", ")}
															class="w-full"
															placeholder="icp-discovery, memory, files"
														/>
													</td>
												</tr>
												<tr>
													<td>Provider</td>
													<td>
														<select name={`agents[${idx}].provider`}>
															<option value="" selected={!agent.provider}>
																Default (inherit)
															</option>
															{["claude", "ollama", "openai", "gemini"].map(
																(p) => (
																	<option
																		key={p}
																		value={p}
																		selected={agent.provider === p}
																	>
																		{p}
																	</option>
																),
															)}
														</select>
													</td>
												</tr>
												<tr>
													<td>Max Roundtrips</td>
													<td>
														<input
															type="number"
															name={`agents[${idx}].maxRoundtrips`}
															value={
																agent.maxRoundtrips
																	? String(agent.maxRoundtrips)
																	: ""
															}
															min="1"
															max="50"
															class="input-sm"
															placeholder="Default"
														/>
													</td>
												</tr>
											</tbody>
										</table>
									</div>
								))}
							</div>
							<button
								type="button"
								id="add-agent-btn"
								class="btn-secondary btn-sm"
							>
								+ Add Agent
							</button>
						</Section>

						<Section
							keyName="integrations"
							title="Integrations"
							icon="flow"
							form
						>
							<h4 class="bright" style="margin:0 0 8px">
								n8n (workflow MCPs)
							</h4>
							<table style="width:100%">
								<tbody>
									<tr>
										<td style="width:120px">Enabled</td>
										<td>
											<Bool name="n8n.enabled" value={!!config.n8n?.enabled} />
										</td>
									</tr>
									<tr>
										<td>Transport</td>
										<td>
											<select name="n8n.transport" class="input-md">
												<option
													value="sse"
													selected={(config.n8n?.transport ?? "sse") === "sse"}
												>
													SSE
												</option>
												<option
													value="http"
													selected={config.n8n?.transport === "http"}
												>
													HTTP (streamable)
												</option>
											</select>
										</td>
									</tr>
									<tr>
										<td>Bearer token</td>
										<td>
											<input
												type="password"
												name="n8n.token"
												value={config.n8n?.token ?? ""}
												class="w-full"
												placeholder="n8n MCP bearer token"
												autocomplete="off"
											/>
										</td>
									</tr>
								</tbody>
							</table>
							<div style="margin-top:12px">
								<label style="margin-bottom:8px">Endpoints</label>
								<div id="n8n-endpoints">
									{(config.n8n?.endpoints ?? []).map((ep, idx) => (
										<div
											key={ep.name || String(idx)}
											class="n8n-ep flex gap-sm items-center"
											style="margin-bottom:8px"
										>
											<input
												type="text"
												class="n8n-ep-name input-md"
												value={ep.name}
												placeholder="name"
											/>
											<input
												type="text"
												class="n8n-ep-url w-full"
												value={ep.url}
												placeholder="https://n8n.example.com/mcp/…"
											/>
											<button
												type="button"
												class="btn-remove-ep btn-ghost btn-sm"
												title="Remove"
											>
												&times;
											</button>
										</div>
									))}
								</div>
								<div class="flex gap-sm mt-sm">
									<button
										type="button"
										id="add-n8n-ep"
										class="btn-secondary btn-sm"
									>
										+ Add endpoint
									</button>
									<button
										type="button"
										id="reconnect-n8n"
										class="btn-ghost btn-sm"
										onclick="reconnectN8n(this)"
									>
										Reconnect n8n
									</button>
								</div>
								{raw(
									`<input type="hidden" name="n8nEndpoints" id="n8n-endpoints-json">`,
								)}
							</div>

							<h4 class="bright" style="margin:18px 0 8px">
								ICP Discovery
							</h4>
							<div class="field">
								<label>Sample cities</label>
								<input
									type="text"
									name="icp-discovery.sampleCities"
									value={(
										icpSampleCities ?? [
											"New York",
											"Los Angeles",
											"Chicago",
											"Dallas",
											"Houston",
										]
									).join(", ")}
									class="w-full"
								/>
							</div>
							<div class="field" style="margin-top:10px">
								<label>Exclude brands</label>
								<input
									type="text"
									name="icp-discovery.excludeBrands"
									value={(icpExcludeBrands ?? []).join(", ")}
									class="w-full"
									placeholder="McDonald's, Subway, Starbucks"
								/>
							</div>
						</Section>

						<div class="settings-save" id="settings-save">
							<button type="submit" class="btn-primary">
								{raw(icon("check", 14))} Save changes
							</button>
						</div>
					</form>

					<Section keyName="brand" title="Brand Kit" icon="brand" form={false}>
						<p class="text-secondary mb-md" style="max-width:640px">
							The <strong>active</strong> brand is injected into the agent's
							instructions and applied to canvas pages — colors, fonts, logo,
							voice and guidelines.
						</p>
						<div class="flex justify-end mb-md">
							<button
								type="button"
								class="btn-secondary btn-sm"
								onclick="brandAdd()"
							>
								+ New brand
							</button>
						</div>
						<div id="brands-list">
							{brands.length > 0 ? (
								brands.map((b) => brandCard(b))
							) : (
								<div id="brand-empty" class="empty-state">
									{raw(icon("brand", 30))}
									<div class="t">No brands yet</div>
									<div class="s">Click “New brand” to create one.</div>
								</div>
							)}
						</div>
						{raw(
							`<template id="brand-card-template">${String(brandCard(null))}</template>`,
						)}
					</Section>

					<Section
						keyName="companion"
						title="Companion"
						icon="user"
						form={false}
					>
						<p class="text-sm text-muted mb-md">
							Pick the face your companion wears. Saved on this device; applies
							live.
						</p>
						<div class="avatar-pick-grid">
							{AVATAR_OPTIONS.map((a) => (
								<button
									type="button"
									key={a.key}
									class="avatar-pick"
									data-avatar={a.key}
									onclick={`pawSetAvatar('${a.key}')`}
								>
									<strong>{a.label}</strong>
									<span class="text-xs text-muted">{a.desc}</span>
								</button>
							))}
						</div>
					</Section>

					<Section keyName="secrets" title="Secrets" icon="key" form={false}>
						<p class="text-sm text-muted mb-md">
							API keys are never displayed. Use <strong>Rotate</strong> to
							replace the stored value.
						</p>
						{secrets && secrets.length > 0 ? (
							<table class="tbl">
								<thead>
									<tr>
										<th>Service</th>
										<th>Status</th>
										<th>Source</th>
										<th style="text-align:right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{secrets.map((s) => (
										<tr key={s.id}>
											<td>
												<span class="nm">{s.label}</span>
											</td>
											<td>
												<span class={`pill-badge ${s.set ? "green" : "dim"}`}>
													{s.set ? "Set" : "Missing"}
												</span>
											</td>
											<td class="dim">
												{s.fromEnv ? "env var" : "credentials file"}
											</td>
											<td style="text-align:right">
												<button
													type="button"
													class="btn-secondary btn-sm"
													data-secret-id={s.id}
													data-secret-label={s.label}
													onclick="rotateSecret(this.dataset.secretId, this.dataset.secretLabel)"
												>
													Rotate
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<div class="empty-state">
								{raw(icon("key", 30))}
								<div class="t">No secrets configured</div>
							</div>
						)}
					</Section>
				</div>
			</div>

			{raw(`<style>${brandStyles()}</style>`)}
			{raw(`<script>${settingsScript(defaultAvatar ?? "gel")}</script>`)}
		</Layout>
	);
};
