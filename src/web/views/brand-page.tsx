import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import type { Brand } from "../../store/brands.js";
import { Layout } from "./layout.js";

interface BrandPageProps {
	brands: Brand[];
}

const COLOR_KEYS = ["primary", "accent", "bg", "surface", "text", "muted"];

function colorRow(brand: Brand | null, key: string) {
	const val = (brand?.data.colors ?? {})[key] ?? "";
	const safe = /^#[0-9a-fA-F]{6}$/.test(val) ? val : "#000000";
	return (
		<label class="brand-color">
			<span class="brand-color-label">{key}</span>
			{raw(
				`<input type="color" class="brand-color-pick" data-color="${key}" value="${safe}">`,
			)}
			{raw(
				`<input type="text" class="brand-color-hex field" data-colorhex="${key}" value="${val}" placeholder="#${key === "primary" ? "6a4bf0" : "—"}">`,
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
						<span class="badge badge-success">
							<span class="dot" />
							Active
						</span>
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
							onclick="this.previousElementSibling.previousElementSibling.click ? this.parentElement.querySelector('.brand-logo-input').click() : null"
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
				></span>
			</div>
		</div>
	);
}

export const BrandPage: FC<BrandPageProps> = ({ brands }) => {
	return (
		<Layout title="Brand" currentPath="/brand">
			<p class="text-secondary mb-md" style="max-width:640px">
				Define the brands the agent works for. The <strong>active</strong> brand
				is injected into the agent's instructions and applied to canvas pages by
				default — colors, fonts, logo, voice and guidelines — so output stays
				on-brand unless you ask otherwise. Upload a logo and let the agent infer
				the palette and voice for you.
			</p>

			<div class="flex justify-end mb-md">
				<button
					type="button"
					id="add-brand"
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
						<p>No brands yet. Click "New brand" to create one.</p>
					</div>
				)}
			</div>

			{raw(
				`<template id="brand-card-template">${brandCardTemplate()}</template>`,
			)}
			{raw(`<style>${brandStyles()}</style>`)}
			{raw(`<script>${brandScript()}</script>`)}
		</Layout>
	);
};

function brandCardTemplate(): string {
	// A blank card rendered by the server (FC → string) for client-side "add".
	return String(brandCard(null));
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
  `;
}

function brandScript(): string {
	return `
    function collectBrand(card) {
      var colors = {};
      card.querySelectorAll('[data-colorhex]').forEach(function(i){ if (i.value.trim()) colors[i.dataset.colorhex] = i.value.trim(); });
      var fonts = {};
      card.querySelectorAll('[data-font]').forEach(function(i){ if (i.value.trim()) fonts[i.dataset.font] = i.value.trim(); });
      return {
        name: card.querySelector('.brand-name').value.trim(),
        data: {
          tagline: card.querySelector('.brand-tagline').value.trim(),
          chatLabel: card.querySelector('.brand-chat-label').value.trim(),
          colors: colors,
          fonts: fonts,
          voice: card.querySelector('.brand-voice').value.trim(),
          guidelines: card.querySelector('.brand-guidelines').value.trim(),
        }
      };
    }
    // keep color picker + hex in sync
    document.addEventListener('input', function(e){
      var t = e.target;
      if (t.dataset && t.dataset.color) { var hex = t.closest('.brand-color').querySelector('[data-colorhex]'); if (hex) hex.value = t.value; }
      if (t.dataset && t.dataset.colorhex && /^#[0-9a-fA-F]{6}$/.test(t.value)) { var pick = t.closest('.brand-color').querySelector('[data-color]'); if (pick) pick.value = t.value; }
    });

    window.brandSave = async function(btn) {
      var card = btn.closest('.brand-card');
      var payload = collectBrand(card);
      if (!payload.name) { pawModal.alert('Name required', 'Give the brand a name.'); return; }
      var id = card.dataset.id;
      var status = card.querySelector('.brand-status'); status.textContent = 'Saving…';
      try {
        var res = await fetch(id ? '/api/brands/' + id : '/api/brands', {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) { status.textContent = ''; pawModal.alert('Error', data.error || 'Save failed'); return; }
        status.textContent = 'Saved.';
        if (!id && data.brand) { card.dataset.id = data.brand.id; window.location.reload(); }
      } catch (e) { status.textContent = ''; pawModal.alert('Error', String(e)); }
    };

    window.brandActivate = async function(btn) {
      var id = btn.closest('.brand-card').dataset.id;
      var res = await fetch('/api/brands/' + id + '/activate', { method: 'POST' });
      if (res.ok) window.location.reload(); else pawModal.alert('Error', 'Could not activate.');
    };

    window.brandDelete = async function(btn) {
      var card = btn.closest('.brand-card');
      var id = card.dataset.id;
      var ok = await pawModal.confirm('Delete brand', 'Delete this brand and its assets?', { confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      var res = await fetch('/api/brands/' + id, { method: 'DELETE' });
      if (res.ok) card.remove(); else pawModal.alert('Error', 'Delete failed.');
    };

    function readFileB64(file) {
      return new Promise(function(resolve, reject){
        var r = new FileReader();
        r.onload = function(){ var s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
        r.onerror = reject; r.readAsDataURL(file);
      });
    }

    window.brandUploadLogo = async function(input) {
      var card = input.closest('.brand-card'); var id = card.dataset.id;
      if (!id) { pawModal.alert('Save first', 'Create the brand before uploading a logo.'); return; }
      var file = input.files && input.files[0]; if (!file) return;
      var b64 = await readFileB64(file);
      var res = await fetch('/api/brands/' + id + '/logo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: 'light', data: b64, mimeType: file.type })
      });
      var data = await res.json();
      if (!res.ok) { pawModal.alert('Error', data.error || 'Upload failed'); return; }
      var box = card.querySelector('.brand-logo-box');
      box.innerHTML = '<img class="brand-logo-preview" src="' + data.url + '?t=' + Date.now() + '" alt="logo">';
    };

    window.brandAnalyze = async function(input) {
      var card = input.closest('.brand-card');
      var file = input.files && input.files[0]; if (!file) return;
      var status = card.querySelector('.brand-status'); status.textContent = 'Analyzing…';
      try {
        var b64 = await readFileB64(file);
        var res = await fetch('/api/brands/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: b64, mimeType: file.type })
        });
        var data = await res.json();
        if (!res.ok) { status.textContent = ''; pawModal.alert('Analysis failed', data.error || 'Could not analyze.'); return; }
        var s = data.suggestion || {};
        if (s.name && !card.querySelector('.brand-name').value) card.querySelector('.brand-name').value = s.name;
        if (s.tagline) card.querySelector('.brand-tagline').value = s.tagline;
        if (s.colors) Object.keys(s.colors).forEach(function(k){ var hex = card.querySelector('[data-colorhex="' + k + '"]'); if (hex) { hex.value = s.colors[k]; var pick = card.querySelector('[data-color="' + k + '"]'); if (pick && /^#[0-9a-fA-F]{6}$/.test(s.colors[k])) pick.value = s.colors[k]; } });
        if (s.fonts) Object.keys(s.fonts).forEach(function(k){ var f = card.querySelector('[data-font="' + k + '"]'); if (f) f.value = s.fonts[k]; });
        if (s.voice) card.querySelector('.brand-voice').value = s.voice;
        if (s.guidelines) card.querySelector('.brand-guidelines').value = s.guidelines;
        status.textContent = 'Prefilled from analysis — review and Save.';
      } catch (e) { status.textContent = ''; pawModal.alert('Error', String(e)); }
    };

    window.brandAdd = function() {
      var empty = document.getElementById('brand-empty'); if (empty) empty.remove();
      var tpl = document.getElementById('brand-card-template');
      var node = tpl.content ? tpl.content.cloneNode(true) : null;
      if (node) { document.getElementById('brands-list').prepend(node); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  `;
}
