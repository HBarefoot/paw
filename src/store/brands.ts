import type { Database } from "bun:sqlite";

/** A brand's editable definition (stored as JSON in the `brands.data_json` column). */
export interface BrandDefinition {
	tagline?: string;
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
