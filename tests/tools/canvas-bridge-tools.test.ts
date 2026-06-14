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
import { GitHubApprovals } from "../../src/integrations/github/approvals.js";
import {
	type ApplyEditParams,
	applyCanvasEdit,
	createCanvasBridgeTools,
} from "../../src/tools/canvas-bridge-tools.js";
import type { ToolDefinition } from "../../src/types/message.js";

const PAGE = `<!DOCTYPE html><html><body><h1>Hello</h1>
<script>var a = 1 < 2;</script></body></html>`;

function call(tool: ToolDefinition, input: Record<string, unknown>) {
	return tool.handler(input);
}

describe("canvas bridge tools (companion-driven edits)", () => {
	let root: string;
	let db: Database;
	let approvals: GitHubApprovals;
	let audits: Array<{ action: string; details: Record<string, unknown> }>;
	let tools: ToolDefinition[];
	const byName = (n: string) => {
		const t = tools.find((x) => x.name === n);
		if (!t) throw new Error(`no tool ${n}`);
		return t;
	};

	beforeEach(() => {
		root = realpathSync(mkdtempSync(resolve(tmpdir(), "paw-bridge-")));
		writeFileSync(resolve(root, "index.html"), PAGE);
		db = new Database(":memory:");
		db.run(
			`CREATE TABLE canvas_versions (id INTEGER PRIMARY KEY AUTOINCREMENT,
       path TEXT NOT NULL, content TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		);
		db.run(
			`CREATE TABLE github_pending_actions (
       id TEXT PRIMARY KEY, action TEXT NOT NULL, repo TEXT NOT NULL,
       summary TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
       status TEXT NOT NULL DEFAULT 'pending', requested_by TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       decided_at TEXT, decided_by TEXT, result_json TEXT,
       origin_channel TEXT, origin_ref TEXT)`,
		);
		audits = [];
		const audit = (action: string, details: Record<string, unknown>) =>
			audits.push({ action, details });
		// Always-on queue WITHOUT a GitHub client (the production default).
		approvals = new GitHubApprovals(db, undefined, audit);
		approvals.registerExecutor("canvas_apply_edit", (row) =>
			applyCanvasEdit(row.params as unknown as ApplyEditParams, {
				canvasRoot: root,
				db,
				audit,
			}),
		);
		tools = createCanvasBridgeTools({ canvasRoot: root, db, approvals, audit });
	});

	afterEach(() => {
		db.close();
		rmSync(root, { recursive: true, force: true });
	});

	it("canvas_list_edits stamps anchors and returns the editable map (no approval)", async () => {
		const res = await call(byName("canvas_list_edits"), { path: "index.html" });
		expect(res.is_error).toBeFalsy();
		const data = JSON.parse(res.content) as {
			edits: Array<{ editId: string; tag: string; text: string }>;
		};
		expect(data.edits).toEqual([{ editId: "e1", tag: "h1", text: "Hello" }]);
		// Anchors were persisted to the source; no approval was queued.
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toContain(
			'data-edit-id="e1"',
		);
		const pending = approvals.actionable(24);
		expect(pending.length).toBe(0);
	});

	it("canvas_apply_edit QUEUES an approval and does NOT apply on call", async () => {
		await call(byName("canvas_list_edits"), { path: "index.html" });
		const before = readFileSync(resolve(root, "index.html"), "utf-8");

		const res = await call(byName("canvas_apply_edit"), {
			path: "index.html",
			editId: "e1",
			newText: "Hi there",
			originalText: "Hello",
		});
		const data = JSON.parse(res.content) as { queued: boolean; id: string };
		expect(data.queued).toBe(true);
		expect(typeof data.id).toBe("string");
		// Page is UNCHANGED until a human approves.
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toBe(before);
		// It shows up as a pending approval.
		const pending = approvals.actionable(24);
		expect(pending.length).toBe(1);
		expect(pending[0].action).toBe("canvas_apply_edit");
	});

	it("approving the edit applies it (anchor-splice, byte-intact) and audits", async () => {
		await call(byName("canvas_list_edits"), { path: "index.html" });
		const stamped = readFileSync(resolve(root, "index.html"), "utf-8");
		const res = await call(byName("canvas_apply_edit"), {
			path: "index.html",
			editId: "e1",
			newText: "Hi there",
			originalText: "Hello",
		});
		const { id } = JSON.parse(res.content) as { id: string };

		await approvals.approve(id, "web:1");

		const after = readFileSync(resolve(root, "index.html"), "utf-8");
		expect(after).toBe(stamped.replace(">Hello<", ">Hi there<"));
		expect(after).toContain("<script>var a = 1 < 2;</script>");
		expect(audits.some((a) => a.action === "canvas_bridge.apply_edit")).toBe(
			true,
		);
	});

	it("a stale edit does not clobber the page on approve", async () => {
		await call(byName("canvas_list_edits"), { path: "index.html" });
		const stamped = readFileSync(resolve(root, "index.html"), "utf-8");
		const res = await call(byName("canvas_apply_edit"), {
			path: "index.html",
			editId: "e1",
			newText: "X",
			originalText: "WRONG — not the current text",
		});
		const { id } = JSON.parse(res.content) as { id: string };
		await approvals.approve(id, "web:1");
		// Splice round-trip guard fired inside the executor → file unchanged.
		expect(readFileSync(resolve(root, "index.html"), "utf-8")).toBe(stamped);
	});

	it("canvas_apply_edit reports unavailable when there is no approval queue", async () => {
		const noQueue = createCanvasBridgeTools({ canvasRoot: root, db });
		const applyTool = noQueue.find((t) => t.name === "canvas_apply_edit");
		if (!applyTool) throw new Error("canvas_apply_edit missing");
		const res = await call(applyTool, {
			path: "index.html",
			editId: "e1",
			newText: "x",
			originalText: "Hello",
		});
		expect(res.is_error).toBe(true);
	});
});
