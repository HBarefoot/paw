import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { type Context, Hono } from "hono";
import { safePath, writeCanvasFile } from "../../tools/canvas-write.js";
import { spliceEditById, stampEditAnchors } from "../canvas-edit.js";
import { canvasFileFromUrlPath } from "../canvas-serve.js";

// Owner-only inline click-to-edit routes, extracted from createWebApp so they can
// be driven by app-level tests (Hono `app.request`) with a temp canvas dir + an
// in-memory DB. These routes are NOT in PUBLIC_PREFIXES, so the global auth
// middleware already gates them to authenticated admins; the persistence goes
// through the SAME writeCanvasFile path as canvas_write (version snapshot + atomic
// write + the fs.watch live-reload event), and edits patch ONLY the addressed
// element's inner-text byte range (parse5 anchors) — never re-serializing.

export interface CanvasEditDeps {
	canvasRoot: string;
	db: Database;
	/** App-space namespace for URL→file mapping (APP_NAMESPACE). */
	appNamespace?: string;
	/** Audit sink — wired to authManager.audit.log in production. */
	audit?: (
		action: string,
		userId: number | null,
		details: Record<string, unknown>,
		ip?: string,
	) => void;
	getClientIp?: (c: Context) => string;
}

export function createCanvasEditRoutes(deps: CanvasEditDeps): Hono {
	const { canvasRoot, db, appNamespace = "apps", audit, getClientIp } = deps;
	const app = new Hono();

	// "admin" is set by the auth middleware; read via c.var (not c.get) to avoid
	// the repo's known untyped-Variables overload-error class.
	const adminId = (c: Context): number | null =>
		(c.var as unknown as { admin?: { id: number } }).admin?.id ?? null;
	const ip = (c: Context): string | undefined => getClientIp?.(c);

	// Map the page URL to its canvas file, then validate it's an editable HTML
	// file within the workspace. Returns the relative canvas path or null.
	const editTargetFromUrl = (pagePath: unknown): string | null => {
		const url = typeof pagePath === "string" ? pagePath : "";
		const rel = url ? canvasFileFromUrlPath(url, appNamespace) : null;
		if (!rel) return null;
		const full = safePath(rel, canvasRoot);
		if (!full || !existsSync(full)) return null;
		const e = extname(full).toLowerCase();
		if (e !== ".html" && e !== ".htm") return null;
		return rel;
	};

	// Entering Edit Mode stamps stable, append-only data-edit-id anchors into the
	// SOURCE file once (intentional: makes later edits pure lookups).
	app.post("/api/canvas/edit-prep", async (c) => {
		// Defense-in-depth: already gated by the global auth middleware (not in
		// PUBLIC_PREFIXES), but refuse anon here too so editing can NEVER run
		// without an authenticated admin even if the route is ever mis-whitelisted.
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		const body = await c.req
			.json<{ pagePath?: string }>()
			.catch(() => ({}) as { pagePath?: string });
		const rel = editTargetFromUrl(body.pagePath);
		if (!rel) return c.json({ error: "Page is not editable" }, 400);
		const full = safePath(rel, canvasRoot);
		if (!full) return c.json({ error: "Not found" }, 404);
		const { html, changed } = stampEditAnchors(readFileSync(full, "utf-8"));
		if (changed) {
			const res = await writeCanvasFile({
				root: canvasRoot,
				relPath: rel,
				content: html,
				db,
			});
			if (!res.ok) return c.json({ error: res.error }, 500);
		}
		return c.json({ ok: true, changed });
	});

	app.post("/api/canvas/edit", async (c) => {
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		const body = await c.req
			.json<{
				pagePath?: string;
				editId?: string;
				newText?: string;
				originalText?: string;
			}>()
			.catch(() => ({}) as Record<string, never>);
		const editId = typeof body.editId === "string" ? body.editId : "";
		if (
			!editId ||
			typeof body.newText !== "string" ||
			typeof body.originalText !== "string"
		) {
			return c.json(
				{ error: "pagePath, editId, newText, originalText are required" },
				400,
			);
		}
		const rel = editTargetFromUrl(body.pagePath);
		if (!rel) return c.json({ error: "Page is not editable" }, 400);
		const full = safePath(rel, canvasRoot);
		if (!full) return c.json({ error: "Not found" }, 404);

		const result = spliceEditById(
			readFileSync(full, "utf-8"),
			editId,
			body.newText,
			body.originalText,
		);
		if (!result.ok) {
			// Optimistic concurrency: the page changed under the editor — never clobber.
			if (result.error === "stale")
				return c.json({ error: "page changed — reload", reason: "stale" }, 409);
			return c.json({ error: result.error }, 404);
		}
		const wr = await writeCanvasFile({
			root: canvasRoot,
			relPath: rel,
			content: result.html,
			db,
		});
		if (!wr.ok) return c.json({ error: wr.error }, 500);

		audit?.("canvas.inline_edit", adminId(c), { path: rel, editId }, ip(c));
		return c.json({ ok: true });
	});

	// "Restore previous version" — revert the whole page to its most recent
	// canvas_versions snapshot (the state before the last save).
	app.post("/api/canvas/restore-latest", async (c) => {
		if (adminId(c) === null) return c.json({ error: "Unauthorized" }, 401);
		const body = await c.req
			.json<{ pagePath?: string }>()
			.catch(() => ({}) as { pagePath?: string });
		const rel = editTargetFromUrl(body.pagePath);
		if (!rel) return c.json({ error: "Page is not editable" }, 400);
		const ver = db
			.prepare(
				"SELECT id, content FROM canvas_versions WHERE path = ? ORDER BY created_at DESC LIMIT 1",
			)
			.get(rel) as { id: number; content: string } | null;
		if (!ver) return c.json({ error: "No previous version" }, 404);
		const wr = await writeCanvasFile({
			root: canvasRoot,
			relPath: rel,
			content: ver.content,
			db,
		});
		if (!wr.ok) return c.json({ error: wr.error }, 500);
		audit?.(
			"canvas.restore",
			adminId(c),
			{ path: rel, versionId: ver.id },
			ip(c),
		);
		return c.json({ ok: true });
	});

	return app;
}
