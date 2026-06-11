import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	APP_NAMESPACE,
	buildAppCsp,
	clearCanvasPreservingApps,
	isProtectedAppPath,
	isValidSpaceName,
	listAppSpaces,
	readAppManifest,
	spaceFromAppPath,
} from "../../src/web/app-spaces.js";

let root: string;

beforeAll(() => {
	root = mkdtempSync(resolve(tmpdir(), "paw-appspaces-"));
	const apps = resolve(root, APP_NAMESPACE);
	// constructai: explicit authed + protected, with a CSP override
	mkdirSync(resolve(apps, "constructai"), { recursive: true });
	writeFileSync(
		resolve(apps, "constructai", ".app.json"),
		JSON.stringify({
			visibility: "auth",
			protected: true,
			csp: { "connect-src": "'self' https://api.example.com" },
		}),
	);
	// landing: explicitly unprotected (opts out of the wipe shield)
	mkdirSync(resolve(apps, "landing"), { recursive: true });
	writeFileSync(
		resolve(apps, "landing", ".app.json"),
		JSON.stringify({ protected: false }),
	);
	// nomani: a space directory with NO manifest → safe defaults
	mkdirSync(resolve(apps, "nomani"), { recursive: true });
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("isValidSpaceName", () => {
	it("accepts safe single-segment names", () => {
		expect(isValidSpaceName("constructai")).toBe(true);
		expect(isValidSpaceName("my-app_2")).toBe(true);
	});
	it("rejects traversal, slashes, dots, empties", () => {
		expect(isValidSpaceName("..")).toBe(false);
		expect(isValidSpaceName("a/b")).toBe(false);
		expect(isValidSpaceName("a.b")).toBe(false);
		expect(isValidSpaceName("")).toBe(false);
		expect(isValidSpaceName("-leading")).toBe(false);
	});
});

describe("readAppManifest", () => {
	it("parses an explicit manifest", () => {
		const m = readAppManifest(root, "constructai");
		expect(m.visibility).toBe("auth");
		expect(m.protected).toBe(true);
		expect(m.csp?.["connect-src"]).toContain("api.example.com");
	});
	it("defaults to authed + protected when manifest is missing", () => {
		const m = readAppManifest(root, "nomani");
		expect(m.visibility).toBe("auth");
		expect(m.protected).toBe(true);
		expect(m.csp).toBeUndefined();
	});
	it("honors protected:false", () => {
		expect(readAppManifest(root, "landing").protected).toBe(false);
	});
	it("returns safe defaults for invalid space names", () => {
		expect(readAppManifest(root, "../etc").protected).toBe(true);
	});
});

describe("spaceFromAppPath", () => {
	it("extracts the space segment", () => {
		expect(spaceFromAppPath("/api/app/constructai/Jobs.html")).toBe(
			"constructai",
		);
		expect(spaceFromAppPath("/api/app/constructai")).toBe("constructai");
	});
	it("returns null for non-app or unsafe paths", () => {
		expect(spaceFromAppPath("/api/canvas/preview/x")).toBeNull();
		expect(spaceFromAppPath("/api/app/..%2Fetc/x")).toBeNull();
	});
});

describe("isProtectedAppPath", () => {
	it("protects a protected space", () => {
		expect(isProtectedAppPath(root, "apps/constructai/data.js")).toBe(true);
		expect(isProtectedAppPath(root, "apps/nomani/index.html")).toBe(true);
	});
	it("does not protect an unprotected space", () => {
		expect(isProtectedAppPath(root, "apps/landing/index.html")).toBe(false);
	});
	it("does not protect non-app paths", () => {
		expect(isProtectedAppPath(root, "index.html")).toBe(false);
		expect(isProtectedAppPath(root, "apps")).toBe(false);
	});
});

describe("listAppSpaces", () => {
	it("lists app-space directories, sorted", () => {
		expect(listAppSpaces(root)).toEqual(["constructai", "landing", "nomani"]);
	});
});

describe("clearCanvasPreservingApps", () => {
	it("wipes loose files + unprotected spaces but keeps protected ones", () => {
		const cr = mkdtempSync(resolve(tmpdir(), "paw-clear-"));
		const apps = resolve(cr, APP_NAMESPACE);
		// loose canvas file (should be wiped)
		writeFileSync(resolve(cr, "index.html"), "<h1>sketch</h1>");
		// protected app (should survive)
		mkdirSync(resolve(apps, "constructai"), { recursive: true });
		writeFileSync(
			resolve(apps, "constructai", ".app.json"),
			JSON.stringify({ protected: true }),
		);
		writeFileSync(resolve(apps, "constructai", "data.js"), "x");
		// unprotected app (should be wiped)
		mkdirSync(resolve(apps, "landing"), { recursive: true });
		writeFileSync(
			resolve(apps, "landing", ".app.json"),
			JSON.stringify({ protected: false }),
		);

		clearCanvasPreservingApps(cr);

		expect(existsSync(resolve(cr, "index.html"))).toBe(false);
		expect(existsSync(resolve(apps, "landing"))).toBe(false);
		expect(existsSync(resolve(apps, "constructai", "data.js"))).toBe(true);
		expect(existsSync(cr)).toBe(true); // root recreated

		rmSync(cr, { recursive: true, force: true });
	});
});

describe("buildAppCsp", () => {
	it("emits a strict baseline without unsafe-eval or img wildcard", () => {
		const csp = buildAppCsp();
		expect(csp).toContain("default-src 'self'");
		expect(csp).not.toContain("unsafe-eval");
		expect(csp).not.toContain("img-src *");
		expect(csp).toContain("frame-ancestors 'self'");
		expect(csp.endsWith(";")).toBe(true);
	});
	it("merges per-space overrides over the baseline", () => {
		const csp = buildAppCsp({
			"connect-src": "'self' https://api.example.com",
		});
		expect(csp).toContain("connect-src 'self' https://api.example.com");
		// untouched directives remain
		expect(csp).toContain("script-src 'self' 'unsafe-inline'");
	});
	it("ignores empty / oversized override values", () => {
		const csp = buildAppCsp({ "connect-src": "", "img-src": "x".repeat(600) });
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("img-src 'self' data: blob:");
	});
});
