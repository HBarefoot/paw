import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	activateBrand,
	compileBrandBrief,
	createBrand,
	deleteBrand,
	getActiveBrand,
	getBrandUi,
	listBrands,
	renderBrandAppThemeCss,
	renderBrandTokensCss,
	slugify,
	updateBrand,
} from "../../src/store/brands.js";
import { ChatPage } from "../../src/web/views/chat.js";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
	return db;
}

describe("brand store", () => {
	let db: Database;
	beforeEach(() => {
		db = freshDb();
	});

	test("slugify normalizes names", () => {
		expect(slugify("Frutero Club!")).toBe("frutero-club");
		expect(slugify("  ")).toBe("brand");
	});

	test("create + update + delete round-trips", () => {
		const b = createBrand(db, "Engram", { tagline: "Memory for agents" });
		expect(b.name).toBe("Engram");
		expect(b.slug).toBe("engram");
		expect(b.active).toBe(false);
		expect(b.data.tagline).toBe("Memory for agents");

		const updated = updateBrand(db, b.id, {
			data: { colors: { primary: "#6a4bf0" } },
		});
		// patch merges into existing data (tagline preserved)
		expect(updated?.data.tagline).toBe("Memory for agents");
		expect(updated?.data.colors.primary).toBe("#6a4bf0");

		expect(deleteBrand(db, b.id)).toBe(true);
		expect(listBrands(db)).toHaveLength(0);
		expect(deleteBrand(db, b.id)).toBe(false);
	});

	test("activate enforces a single active brand", () => {
		const a = createBrand(db, "Alpha", {});
		const b = createBrand(db, "Beta", {});
		expect(getActiveBrand(db)).toBeNull();

		expect(activateBrand(db, a.id)).toBe(true);
		expect(getActiveBrand(db)?.id).toBe(a.id);

		expect(activateBrand(db, b.id)).toBe(true);
		expect(getActiveBrand(db)?.id).toBe(b.id);
		// activating Beta cleared Alpha
		expect(listBrands(db).filter((x) => x.active)).toHaveLength(1);

		expect(activateBrand(db, "does-not-exist")).toBe(false);
	});

	test("renderBrandTokensCss emits sanitized :root variables", () => {
		const b = createBrand(db, "Brandy", {
			colors: { primary: "#6a4bf0", evil: "url(javascript:alert(1))" },
			fonts: {
				display: "Space Grotesk",
				body: 'Inter"; } body { display:none } /*',
				googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter",
			},
		});
		const css = renderBrandTokensCss(getActiveBrandOr(db, b.id));
		// valid hex kept
		expect(css).toContain("--brand-primary: #6a4bf0;");
		// non-color value dropped entirely (no var emitted, no injection)
		expect(css).not.toContain("--brand-evil");
		expect(css).not.toContain("javascript");
		// font CSS-injection breakout chars stripped — no closing the
		// quoted string or the declaration block
		expect(css).not.toContain('"; }');
		expect(css).not.toContain("} body {");
		expect(css).not.toContain("}body{");
		expect(css).toContain('--brand-font-display: "Space Grotesk"');
		// only fonts.googleapis.com import allowed
		expect(css).toContain("@import");
		expect(css).toContain("fonts.googleapis.com");
	});

	test("renderBrandTokensCss handles no active brand", () => {
		expect(renderBrandTokensCss(null)).toContain("no active brand");
	});

	test("renderBrandTokensCss rejects non-google font imports", () => {
		const b = createBrand(db, "Sneaky", {
			fonts: { googleFontsUrl: "https://evil.example.com/font.css" },
		});
		const css = renderBrandTokensCss(getBrandById(db, b.id));
		expect(css).not.toContain("@import");
		expect(css).not.toContain("evil.example.com");
	});

	// The app-chrome theme contributes ACCENT + FONTS only — the neutral grounds
	// stay owned by the DS so the light/dark toggle works on every page.
	// REGRESSION: the brand used to pin --bg-*/--text-* onto :root AND :root.dark,
	// freezing dark mode (some tabs changed, others didn't).
	test("renderBrandAppThemeCss emits accent + fonts but NOT neutral grounds", () => {
		const b = createBrand(db, "Barefoot", {
			colors: {
				primary: "#7C5CFF",
				accent: "#00FFA3",
				bg: "#000000",
				surface: "#0A0A0A",
				text: "#ffffff",
				muted: "#A1A1AA",
			},
			fonts: { display: "Space Grotesk", body: "Inter" },
		});
		const css = renderBrandAppThemeCss(getActiveBrandOr(db, b.id));
		expect(css).toContain("--accent: #00FFA3;");
		expect(css).toContain('--font-sans: "Inter"');
		// neutrals are NOT pinned (DS :root / :root.dark own them)
		expect(css).not.toContain("--bg-secondary");
		expect(css).not.toContain("--bg-primary");
		expect(css).not.toContain("--text-primary");
		expect(css).not.toContain("--border-primary");
	});

	// A valid css2 URL (with @/; in the wght spec) must pass AND any configured
	// family missing from it gets appended, so brand fonts actually load.
	// REGRESSION: safeGoogleFontsUrl rejected '@'/';' → the whole @import was
	// dropped, so a body font like Inter silently fell back to the system font.
	test("renderBrandAppThemeCss loads a css2 URL and merges missing families", () => {
		const b = createBrand(db, "Fonted", {
			colors: { accent: "#00FFA3" },
			fonts: {
				display: "Space Grotesk",
				body: "Inter",
				googleFontsUrl:
					"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap",
			},
		});
		const css = renderBrandAppThemeCss(getActiveBrandOr(db, b.id));
		expect(css).toContain("@import");
		// the URL was kept (not dropped by the @/; chars)
		expect(css).toMatch(/family=Space\+Grotesk:wght@400/);
		// the missing body family (Inter) was appended
		expect(css).toMatch(/family=Inter:wght@400;500;600;700/);
	});

	test("compileBrandBrief produces a compact text brief", () => {
		const b = createBrand(db, "Engram", {
			tagline: "Memory for agents",
			colors: { primary: "#6a4bf0", accent: "#00e5a0" },
			fonts: { display: "Space Grotesk", body: "Inter" },
			voice: "Confident, technical, warm",
			guidelines: "Use ample whitespace",
			logos: { light: "logo-light.png" },
		});
		const brief = compileBrandBrief(getBrandById(db, b.id)) ?? "";
		expect(brief).toContain("Brand: Engram");
		expect(brief).toContain("Tagline: Memory for agents");
		expect(brief).toContain("#6a4bf0");
		expect(brief).toContain('display "Space Grotesk"');
		expect(brief).toContain("Voice & tone: Confident, technical, warm");
		expect(brief).toContain("Guidelines: Use ample whitespace");
		expect(brief).toContain(`/api/brand/asset/${b.id}/logo-light.png`);
	});

	test("compileBrandBrief returns undefined for null brand", () => {
		expect(compileBrandBrief(null)).toBeUndefined();
	});
});

// Regression: chatLabel must survive the DB round-trip. rowToBrand() rebuilds
// `data` from a hand-written field whitelist; chatLabel was written by
// create/update but omitted on read-back, so the feature silently rendered
// "Chat" no matter what the brand stored. The original PR only tested the
// render path with an in-memory brand, never the row round-trip.
describe("brand chatLabel — DB round-trip (read-back)", () => {
	let db: Database;
	beforeEach(() => {
		db = freshDb();
	});

	test("a persisted chatLabel survives rowToBrand and reaches the chat title", () => {
		const b = createBrand(db, "Acme", { chatLabel: "Command AI" });
		activateBrand(db, b.id);

		// read back through the real store path (getActiveBrand → rowToBrand)
		const read = getActiveBrand(db);
		expect(read?.data.chatLabel).toBe("Command AI");
		expect(getBrandUi(read)?.chatLabel).toBe("Command AI");

		const html = String(
			ChatPage({ sessionId: "s1", chatLabel: getBrandUi(read)?.chatLabel }),
		);
		expect(html).toContain("<title>Command AI - Paw</title>");
	});

	test("a brand without chatLabel still defaults to Chat", () => {
		const b = createBrand(db, "Plain", { tagline: "no label" });
		activateBrand(db, b.id);

		const read = getActiveBrand(db);
		expect(getBrandUi(read)?.chatLabel).toBeUndefined();

		const html = String(
			ChatPage({ sessionId: "s1", chatLabel: getBrandUi(read)?.chatLabel }),
		);
		expect(html).toContain("<title>Chat - Paw</title>");
	});
});

// helpers (re-read after mutation)
function getBrandById(db: Database, id: string) {
	return listBrands(db).find((b) => b.id === id) ?? null;
}
function getActiveBrandOr(db: Database, id: string) {
	activateBrand(db, id);
	return getActiveBrand(db);
}
