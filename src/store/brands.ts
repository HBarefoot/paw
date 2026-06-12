import type { Database } from "bun:sqlite";

/** A brand's editable definition (stored as JSON in the `brands.data_json` column). */
export interface BrandDefinition {
	tagline?: string;
	chatLabel?: string; // Sidebar nav + chat page label; defaults to "Chat" when unset.
	colors: Record<string, string>; // e.g. { primary, accent, bg, surface, text, muted }
	fonts: {
		display?: string;
		body?: string;
		mono?: string;
		googleFontsUrl?: string;
	};
	voice?: string;
	guidelines?: string;
	logos: { light?: string; dark?: string; icon?: string; favicon?: string };
}

export interface Brand {
	id: string;
	name: string;
	slug: string;
	active: boolean;
	data: BrandDefinition;
	createdAt: string;
	updatedAt: string;
}

interface BrandRow {
	id: string;
	name: string;
	slug: string;
	data_json: string;
	active: number;
	created_at: string;
	updated_at: string;
}

const EMPTY_DEF: BrandDefinition = { colors: {}, fonts: {}, logos: {} };

function rowToBrand(r: BrandRow): Brand {
	let data: BrandDefinition = { ...EMPTY_DEF };
	try {
		const parsed = JSON.parse(r.data_json || "{}");
		data = {
			tagline: parsed.tagline,
			chatLabel: parsed.chatLabel,
			colors: parsed.colors ?? {},
			fonts: parsed.fonts ?? {},
			voice: parsed.voice,
			guidelines: parsed.guidelines,
			logos: parsed.logos ?? {},
		};
	} catch {
		/* keep empty */
	}
	return {
		id: r.id,
		name: r.name,
		slug: r.slug,
		active: !!r.active,
		data,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 60) || "brand"
	);
}

export function listBrands(db: Database): Brand[] {
	return db
		.query<BrandRow, []>("SELECT * FROM brands ORDER BY active DESC, name ASC")
		.all()
		.map(rowToBrand);
}

export function getBrand(db: Database, id: string): Brand | null {
	const r = db
		.query<BrandRow, [string]>("SELECT * FROM brands WHERE id = ?")
		.get(id);
	return r ? rowToBrand(r) : null;
}

export function getActiveBrand(db: Database): Brand | null {
	const r = db
		.query<BrandRow, []>("SELECT * FROM brands WHERE active = 1 LIMIT 1")
		.get();
	return r ? rowToBrand(r) : null;
}

export function createBrand(
	db: Database,
	name: string,
	data: Partial<BrandDefinition>,
): Brand {
	const id = crypto.randomUUID().replace(/-/g, "");
	const def: BrandDefinition = { ...EMPTY_DEF, ...data };
	db.run(
		"INSERT INTO brands (id, name, slug, data_json, active) VALUES (?, ?, ?, ?, 0)",
		[id, name, slugify(name), JSON.stringify(def)],
	);
	return getBrand(db, id) as Brand;
}

export function updateBrand(
	db: Database,
	id: string,
	patch: { name?: string; data?: Partial<BrandDefinition> },
): Brand | null {
	const existing = getBrand(db, id);
	if (!existing) return null;
	const name = patch.name?.trim() || existing.name;
	const data: BrandDefinition = { ...existing.data, ...(patch.data ?? {}) };
	db.run(
		"UPDATE brands SET name = ?, slug = ?, data_json = ?, updated_at = datetime('now') WHERE id = ?",
		[name, slugify(name), JSON.stringify(data), id],
	);
	return getBrand(db, id);
}

export function deleteBrand(db: Database, id: string): boolean {
	return db.run("DELETE FROM brands WHERE id = ?", [id]).changes > 0;
}

/** Activate one brand, deactivating all others (single active brand). */
export function activateBrand(db: Database, id: string): boolean {
	const exists = getBrand(db, id);
	if (!exists) return false;
	db.run("UPDATE brands SET active = 0 WHERE active = 1");
	db.run(
		"UPDATE brands SET active = 1, updated_at = datetime('now') WHERE id = ?",
		[id],
	);
	return true;
}

// ---- sanitizers (values are operator-provided + served publicly) ----

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGB_RE = /^rgba?\([\d.,\s%]+\)$/i;
function safeColor(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const t = v.trim();
	return HEX_RE.test(t) || RGB_RE.test(t) ? t : null;
}
function safeFont(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const t = v.replace(/[;{}<>"'`\\]/g, "").trim();
	return t ? t : null;
}
function safeGoogleFontsUrl(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const t = v.trim();
	return /^https:\/\/fonts\.googleapis\.com\/[\w./?=:&%+-]+$/.test(t)
		? t
		: null;
}

/**
 * Whether a color is light enough that dark text reads better on top of it.
 * Uses YIQ perceived brightness on `#rgb`/`#rrggbb`. Non-hex (e.g. `rgb(...)`)
 * returns false → defaults to white text, matching the dark default accent.
 */
function isLightColor(color: string): boolean {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
	if (!m) return false;
	let h = m[1];
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

/**
 * A `:root { --brand-* }` stylesheet for the active brand. Served publicly so
 * sandboxed/shared canvas pages can `<link>` it. All values are sanitized.
 */
export function renderBrandTokensCss(brand: Brand | null): string {
	if (!brand) return "/* no active brand */\n:root {}\n";
	const c = brand.data.colors ?? {};
	const f = brand.data.fonts ?? {};
	const lines: string[] = [];
	for (const [key, val] of Object.entries(c)) {
		const col = safeColor(val);
		if (col)
			lines.push(`  --brand-${key.replace(/[^a-z0-9-]/gi, "")}: ${col};`);
	}
	const display = safeFont(f.display);
	const body = safeFont(f.body);
	const mono = safeFont(f.mono);
	if (display)
		lines.push(`  --brand-font-display: "${display}", system-ui, sans-serif;`);
	if (body)
		lines.push(`  --brand-font-body: "${body}", system-ui, sans-serif;`);
	if (mono)
		lines.push(`  --brand-font-mono: "${mono}", ui-monospace, monospace;`);
	const fontImport = safeGoogleFontsUrl(f.googleFontsUrl);
	const header = fontImport ? `@import url("${fontImport}");\n` : "";
	return `${header}/* brand: ${brand.name.replace(/[*/]/g, "")} */\n:root {\n${lines.join("\n")}\n}\n`;
}

/**
 * App-chrome theme stylesheet: maps the active brand's palette + fonts onto the
 * Paw design-system tokens (`--accent*`, `--bg-*`, `--text-*`, `--font-*`) so
 * the whole console + auth screens re-skin to the brand. Served at
 * `/api/brand/theme.css` and `<link>`ed by the chrome `<head>`s.
 *
 * Returns an empty (no-op) sheet when no brand is active — so the default Paw
 * look is byte-for-byte unchanged. Only emits an override for the brand keys
 * actually present, applied to BOTH `:root` and `:root.dark` (a brand defines a
 * single white-label look); tokens the brand omits keep their light/dark DS
 * behavior, so partial palettes degrade gracefully. All values are sanitized
 * (hex/rgb colors, font-name stripping, Google-Fonts-only `@import`), then only
 * composed via `var()` / `color-mix()` — no new injection surface.
 */
export function renderBrandAppThemeCss(brand: Brand | null): string {
	if (!brand) return "/* no active brand */\n";
	const c = brand.data.colors ?? {};
	const f = brand.data.fonts ?? {};
	const primary = safeColor(c.primary) ?? safeColor(c.accent);
	const accent = safeColor(c.accent) ?? primary;
	const bg = safeColor(c.bg);
	const surface = safeColor(c.surface) ?? bg;
	const text = safeColor(c.text);
	const muted = safeColor(c.muted);
	const display = safeFont(f.display);
	const body = safeFont(f.body);
	const mono = safeFont(f.mono);
	const fontImport = safeGoogleFontsUrl(f.googleFontsUrl);

	// Contrast anchor for deriving hover/border shades; brand text if given.
	const anchor = text ?? "#15161b";
	const onSurface = surface ?? bg ?? "#ffffff";
	const m: string[] = [];

	if (accent) {
		m.push(`--accent: ${accent};`);
		m.push(`--accent-hover: color-mix(in srgb, ${accent} 86%, #000);`);
		m.push(`--accent-press: color-mix(in srgb, ${accent} 74%, #000);`);
		m.push(`--accent-bright: color-mix(in srgb, ${accent} 82%, #fff);`);
		m.push(`--accent-subtle: color-mix(in srgb, ${accent} 12%, transparent);`);
		m.push(`--accent-line: color-mix(in srgb, ${accent} 30%, transparent);`);
		m.push(`--border-focus: color-mix(in srgb, ${accent} 30%, transparent);`);
		m.push(
			`--accent-gradient: linear-gradient(150deg, color-mix(in srgb, ${accent} 82%, #fff), ${accent} 55%, color-mix(in srgb, ${accent} 74%, #000));`,
		);
		// On-accent foreground: dark text on light accents (e.g. mint), white on
		// dark accents (e.g. violet), so text/icons on accent fills stay readable.
		m.push(`--accent-fg: ${isLightColor(accent) ? "#0b0b0b" : "#ffffff"};`);
	}
	if (bg) {
		m.push(`--bg-secondary: ${bg};`);
		m.push(`--bg-sidebar: ${bg};`);
	}
	if (surface) {
		m.push(`--bg-primary: ${surface};`);
		m.push(`--bg-card: ${surface};`);
		m.push(`--bg-input: ${surface};`);
		m.push(`--bg-tertiary: color-mix(in srgb, ${surface} 93%, ${anchor});`);
		m.push(`--bg-hover: color-mix(in srgb, ${surface} 93%, ${anchor});`);
		m.push(`--bg-active: color-mix(in srgb, ${surface} 86%, ${anchor});`);
		m.push(`--border-primary: color-mix(in srgb, ${surface} 86%, ${anchor});`);
		m.push(
			`--border-secondary: color-mix(in srgb, ${surface} 92%, ${anchor});`,
		);
		m.push(`--border-strong: color-mix(in srgb, ${surface} 74%, ${anchor});`);
	}
	if (text) m.push(`--text-primary: ${text};`);
	// Secondary text tier: the brand's Muted color drives it (operator choice);
	// fall back to a derived shade of the primary text when Muted is unset.
	const secondary =
		muted ?? (text ? `color-mix(in srgb, ${text} 72%, ${onSurface})` : null);
	if (secondary) m.push(`--text-secondary: ${secondary};`);
	// Faintest tier: a step dimmer than secondary (Muted mixed toward the
	// surface), so the three tiers stay distinct. --text-muted aliases this.
	const tertiary = muted
		? `color-mix(in srgb, ${muted} 70%, ${onSurface})`
		: text
			? `color-mix(in srgb, ${text} 50%, ${onSurface})`
			: null;
	if (tertiary) m.push(`--text-tertiary: ${tertiary};`);
	if (body)
		m.push(
			`--font-sans: "${body}", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;`,
		);
	if (mono) m.push(`--font-mono: "${mono}", ui-monospace, monospace;`);
	if (display) m.push(`--font-display: "${display}", var(--font-sans);`);

	const header = fontImport ? `@import url("${fontImport}");\n` : "";
	if (!m.length) return `${header}/* brand has no themeable tokens */\n`;
	const displayRule = display
		? "\nh1, h2, h3, .wordmark .name, .welcome-title { font-family: var(--font-display); }\n"
		: "";
	return `${header}/* brand UI theme: ${brand.name.replace(/[*/]/g, "")} */\n:root, :root.dark {\n  ${m.join("\n  ")}\n}\n${displayRule}`;
}

/**
 * Slim identity for theming the Paw web UI (sidebar wordmark, favicon, page
 * title, "Welcome to …" wording). Returns null when no brand is active so the
 * UI falls back to the default Paw identity. Asset URLs reuse the public
 * `/api/brand/asset/<id>/<file>` route.
 */
export function getBrandUi(
	brand: Brand | null,
	assetBase = "/api/brand/asset",
): {
	name: string;
	logo: string | null;
	favicon: string | null;
	chatLabel?: string;
} | null {
	if (!brand) return null;
	const asset = (file?: string) =>
		file ? `${assetBase}/${brand.id}/${file}` : null;
	const logos = brand.data.logos ?? {};
	return {
		name: brand.name,
		logo: asset(logos.light) ?? asset(logos.icon),
		favicon: asset(logos.favicon) ?? asset(logos.icon) ?? asset(logos.light),
		chatLabel: brand.data.chatLabel?.trim() || undefined,
	};
}

/**
 * The active brand's sanitized color palette (`{primary, accent, bg, surface,
 * text, muted}`, only keys with a valid color). Used to brand server-rendered
 * surfaces that can't `<link>` the theme stylesheet (e.g. the sandboxed canvas
 * placeholder iframe). Returns null when no brand / no valid colors.
 */
export function getBrandPalette(
	brand: Brand | null,
): Record<string, string> | null {
	if (!brand) return null;
	const c = brand.data.colors ?? {};
	const out: Record<string, string> = {};
	for (const key of ["primary", "accent", "bg", "surface", "text", "muted"]) {
		const col = safeColor(c[key]);
		if (col) out[key] = col;
	}
	return Object.keys(out).length ? out : null;
}

/**
 * Compile the active brand into a compact text brief for the system prompt.
 * `assetBase` is the public URL prefix for this brand's assets.
 */
export function compileBrandBrief(
	brand: Brand | null,
	assetBase = "/api/brand/asset",
): string | undefined {
	if (!brand) return undefined;
	const d = brand.data;
	const parts: string[] = [`Brand: ${brand.name}`];
	if (d.tagline) parts.push(`Tagline: ${d.tagline}`);
	const colors = Object.entries(d.colors ?? {})
		.map(([k, v]) => `${k} ${v}`)
		.join(", ");
	if (colors) parts.push(`Colors: ${colors}`);
	const fonts = [
		d.fonts?.display && `display "${d.fonts.display}"`,
		d.fonts?.body && `body "${d.fonts.body}"`,
		d.fonts?.mono && `mono "${d.fonts.mono}"`,
	]
		.filter(Boolean)
		.join(", ");
	if (fonts) parts.push(`Fonts: ${fonts}`);
	if (d.voice) parts.push(`Voice & tone: ${d.voice}`);
	if (d.guidelines) parts.push(`Guidelines: ${d.guidelines}`);
	if (d.logos?.light)
		parts.push(`Logo: ${assetBase}/${brand.id}/${d.logos.light}`);
	return parts.join("\n");
}
