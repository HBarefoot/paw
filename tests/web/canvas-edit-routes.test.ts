import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Hono } from "hono";
import { createCanvasEditRoutes } from "../../src/web/routes/canvas-edit.js";

const PAGE = `<!DOCTYPE html><html><body><h1>Hello</h1><p>World &amp; co</p>
<script>var a = 1 < 2;</script></body></html>`;

type Audit = {
	action: string;
	userId: number | null;
	details: Record<string, unknown>;
};
type TestApp = Hono<{ Variables: { admin: { id: number } } }>;

async function post(
	app: TestApp,
	path: string,
	body: unknown,
): Promise<Response> {
	return app.request(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("canvas inline-edit routes", () => {
	let root: string;
	let db: Database;
	let audits: Audit[];
	let routes: Hono;

	beforeEach(() => {
		// realpath so the canvas root has no unresolved symlink segment (macOS
		// tmpdir is /var → /private/var); safePath resolves symlinks and would
		// otherwise reject every path as "outside root".
		root = realpathSync(mkdtempSync(resolve(tmpdir(), "paw-canvas-edit-")));
		writeFileSync(resolve(root, "index.html"), PAGE);
		db = new Database(":memory:");
		db.run(
			`CREATE TABLE canvas_versions (id INTEGER PRIMARY KEY AUTOINCREMENT,
       path TEXT NOT NULL, content TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		);
		audits = [];
		routes = createCanvasEditRoutes({
			canvasRoot: root,
			db,
			appNamespace: "apps",
			audit: (action, userId, details) =>
				audits.push({ action, userId, details }),
			getClientIp: () => "127.0.0.1",
		});
	});

	afterEach(() => {
		db.close();
		rmSync(root, { recursive: true, force: true });
	});

	// Build a test app; an admin middleware simulates the (production) auth
	// middleware that sets `admin` on authed routes. Omit it for the anon case.
	function appWith(admin: { id: number } | null): TestApp {
		const app = new Hono<{ Variables: { admin: { id: number } } }>();
		if (admin) {
			app.use("*", async (c, next) => {
				c.set("admin", admin);
				await next();
			});
		}
		app.route("/", routes);
		return app;
	}

	const PREVIEW = "/api/canvas/preview/index.html";

	it("edit-prep stamps anchors into the source file", async () => {
		const app = appWith({ id: 1 });
		const res = await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, changed: true });
		const src = readFileSync(resolve(root, "index.html"), "utf-8");
		expect(src).toContain('<h1 data-edit-id="e1">Hello</h1>');
	});

	it("an inline edit persists to source, keeps surrounding markup/scripts byte-intact, and audits", async () => {
		const app = appWith({ id: 7 });
		await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		const stamped = readFileSync(resolve(root, "index.html"), "utf-8");

		const res = await post(app, "/api/canvas/edit", {
			pagePath: PREVIEW,
			editId: "e1",
			newText: "Hi there",
			originalText: "Hello",
		});
		expect(res.status).toBe(200);
		const after = readFileSync(resolve(root, "index.html"), "utf-8");
		// Only the inner text changed — everything else is byte-identical.
		expect(after).toBe(stamped.replace(">Hello<", ">Hi there<"));
		expect(after).toContain("<script>var a = 1 < 2;</script>");
		// A version was snapshotted, and the action was audited.
		const versions = db
			.query(
				"SELECT COUNT(*) AS n FROM canvas_versions WHERE path = 'index.html'",
			)
			.get() as { n: number };
		expect(versions.n).toBeGreaterThan(0);
		expect(audits.some((a) => a.action === "canvas.inline_edit")).toBe(true);
	});

	it("survives reload: re-stamp after an edit is a no-op (anchors stable)", async () => {
		const app = appWith({ id: 1 });
		await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		await post(app, "/api/canvas/edit", {
			pagePath: PREVIEW,
			editId: "e1",
			newText: "Changed",
			originalText: "Hello",
		});
		const before = readFileSync(resolve(root, "index.html"), "utf-8");
		// A subsequent edit-prep (e.g. on the next Edit-Mode entry) must not churn.
		const res = await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		expect(await res.json()).toEqual({ ok: true, changed: false });
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toBe(before);
	});

	it("rejects a stale edit with 409 and does NOT clobber", async () => {
		const app = appWith({ id: 1 });
		await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		const before = readFileSync(resolve(root, "index.html"), "utf-8");
		const res = await post(app, "/api/canvas/edit", {
			pagePath: PREVIEW,
			editId: "e1",
			newText: "X",
			originalText: "STALE — not what's there",
		});
		expect(res.status).toBe(409);
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toBe(before);
	});

	it("HTML-escapes saved text (no stored XSS)", async () => {
		const app = appWith({ id: 1 });
		await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		await post(app, "/api/canvas/edit", {
			pagePath: PREVIEW,
			editId: "e1",
			newText: "<script>alert(1)</script>",
			originalText: "Hello",
		});
		const after = readFileSync(resolve(root, "index.html"), "utf-8");
		expect(after).toContain(
			'<h1 data-edit-id="e1">&lt;script&gt;alert(1)&lt;/script&gt;</h1>',
		);
	});

	it("restore-latest reverts to the previous saved version", async () => {
		const app = appWith({ id: 1 });
		await post(app, "/api/canvas/edit-prep", { pagePath: PREVIEW });
		await post(app, "/api/canvas/edit", {
			pagePath: PREVIEW,
			editId: "e1",
			newText: "Hi",
			originalText: "Hello",
		});
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toContain(
			">Hi<",
		);
		const res = await post(app, "/api/canvas/restore-latest", {
			pagePath: PREVIEW,
		});
		expect(res.status).toBe(200);
		// Reverted to the pre-edit snapshot.
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toContain(
			">Hello<",
		);
		expect(audits.some((a) => a.action === "canvas.restore")).toBe(true);
	});

	it("is owner-only: an anonymous request is refused (401)", async () => {
		const app = appWith(null);
		const res = await post(app, "/api/canvas/edit", {
			pagePath: PREVIEW,
			editId: "e1",
			newText: "x",
			originalText: "Hello",
		});
		expect(res.status).toBe(401);
	});

	it("refuses a non-canvas / unsupported page (400)", async () => {
		const app = appWith({ id: 1 });
		const res = await post(app, "/api/canvas/edit-prep", { pagePath: "/chat" });
		expect(res.status).toBe(400);
	});
});
