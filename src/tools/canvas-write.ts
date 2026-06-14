// Shared canvas-write primitives, used by BOTH the `canvas_write` agent tool and
// the owner-only inline-edit routes (so writes go through ONE mechanism: the same
// path validation, version snapshot, and atomic temp→rename). The atomic rename
// fires the fs.watch `file-changed` event that the injected refresh poller
// consumes for live reload.

import type { Database } from "bun:sqlite";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
} from "node:fs";
import { relative, resolve } from "node:path";

/** Resolve a caller-supplied path against the canvas root, rejecting `..`
 *  traversal, NUL bytes, and symlinks that escape the root. Returns the absolute
 *  path or null. */
export function safePath(filePath: string, root: string): string | null {
	const resolved = resolve(root, filePath);
	const rel = relative(root, resolved);
	if (rel.startsWith("..") || resolved.includes("\0")) return null;
	if (existsSync(resolved)) {
		try {
			const realRel = relative(root, realpathSync(resolved));
			if (realRel.startsWith("..")) return null;
		} catch {
			return null;
		}
	}
	return resolved;
}

export type WriteCanvasResult =
	| { ok: true; path: string }
	| { ok: false; error: string };

/**
 * Write a canvas file through the canonical path: validate against root, snapshot
 * the prior content to `canvas_versions` (best-effort, pruned to 10), create
 * parent dirs, then atomically write (temp sibling → rename) so a poller never
 * reads a half-written document. `relPath` is the path relative to the canvas
 * root; `root` must already be resolved.
 */
export async function writeCanvasFile(opts: {
	root: string;
	relPath: string;
	content: string;
	db?: Database;
}): Promise<WriteCanvasResult> {
	const { root, relPath, content, db } = opts;
	const filePath = safePath(relPath, root);
	if (!filePath) return { ok: false, error: "path is outside canvas root" };

	// Snapshot current content as a version before overwriting (best-effort).
	if (db && existsSync(filePath)) {
		try {
			const oldContent = readFileSync(filePath, "utf-8");
			db.run("INSERT INTO canvas_versions (path, content) VALUES (?, ?)", [
				relPath,
				oldContent,
			]);
			db.run(
				`DELETE FROM canvas_versions WHERE path = ? AND id NOT IN (
          SELECT id FROM canvas_versions WHERE path = ? ORDER BY created_at DESC LIMIT 10
        )`,
				[relPath, relPath],
			);
		} catch {
			// version save is best-effort — never block the write
		}
	}

	const dir = resolve(filePath, "..");
	mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
	try {
		await Bun.write(tmp, content);
		renameSync(tmp, filePath);
	} catch (err) {
		try {
			if (existsSync(tmp)) rmSync(tmp, { force: true });
		} catch {
			// best-effort temp cleanup
		}
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
	return { ok: true, path: relPath };
}
