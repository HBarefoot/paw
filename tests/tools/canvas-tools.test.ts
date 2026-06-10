import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { createCanvasTools } from "../../src/tools/canvas-tools.js";

const CANVAS_ROOT = join(import.meta.dir, ".test-canvas");

describe("canvas tools", () => {
	let tools: ReturnType<typeof createCanvasTools>;

	beforeEach(() => {
		mkdirSync(CANVAS_ROOT, { recursive: true });
		tools = createCanvasTools({ canvasRoot: CANVAS_ROOT });
	});

	afterEach(() => {
		rmSync(CANVAS_ROOT, { recursive: true, force: true });
	});

	function getTool(name: string) {
		return tools.find((t) => t.name === name)!;
	}

	// --- canvas_write ---

	test("canvas_write creates a file", async () => {
		const result = await getTool("canvas_write").handler({
			path: "index.html",
			content: "<h1>Hello</h1>",
		});
		expect(result.is_error).toBeUndefined();
		const parsed = JSON.parse(result.content);
		expect(parsed.written).toBe(true);
		expect(parsed.path).toBe("index.html");
		expect(readFileSync(join(CANVAS_ROOT, "index.html"), "utf-8")).toBe(
			"<h1>Hello</h1>",
		);
	});

	test("canvas_write creates parent directories", async () => {
		const result = await getTool("canvas_write").handler({
			path: "css/deep/style.css",
			content: "body { color: red; }",
		});
		expect(result.is_error).toBeUndefined();
		expect(existsSync(join(CANVAS_ROOT, "css/deep/style.css"))).toBe(true);
	});

	test("canvas_write rejects path traversal", async () => {
		const result = await getTool("canvas_write").handler({
			path: "../../../etc/evil",
			content: "bad",
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("outside canvas root");
	});

	test("canvas_write overwrites existing file", async () => {
		await getTool("canvas_write").handler({ path: "test.txt", content: "v1" });
		await getTool("canvas_write").handler({ path: "test.txt", content: "v2" });
		expect(readFileSync(join(CANVAS_ROOT, "test.txt"), "utf-8")).toBe("v2");
	});

	// --- canvas_read ---

	test("canvas_read reads a file", async () => {
		writeFileSync(join(CANVAS_ROOT, "hello.txt"), "Hello Canvas");
		const result = await getTool("canvas_read").handler({ path: "hello.txt" });
		expect(result.content).toBe("Hello Canvas");
		expect(result.is_error).toBeUndefined();
	});

	test("canvas_read rejects path traversal", async () => {
		const result = await getTool("canvas_read").handler({
			path: "../../../etc/passwd",
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("outside canvas root");
	});

	test("canvas_read returns error for missing file", async () => {
		const result = await getTool("canvas_read").handler({ path: "nope.txt" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not found");
	});

	test("canvas_read returns error for directory", async () => {
		mkdirSync(join(CANVAS_ROOT, "subdir"), { recursive: true });
		const result = await getTool("canvas_read").handler({ path: "subdir" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("directory");
	});

	// --- canvas_list ---

	test("canvas_list lists files with sizes", async () => {
		writeFileSync(join(CANVAS_ROOT, "a.html"), "<p>A</p>");
		mkdirSync(join(CANVAS_ROOT, "css"), { recursive: true });
		writeFileSync(join(CANVAS_ROOT, "css/style.css"), "body {}");
		const result = await getTool("canvas_list").handler({});
		expect(result.content).toContain("a.html");
		expect(result.content).toContain("css/");
		expect(result.content).toContain("style.css");
	});

	test("canvas_list returns empty message for empty canvas", async () => {
		rmSync(CANVAS_ROOT, { recursive: true, force: true });
		const result = await getTool("canvas_list").handler({});
		expect(result.content).toBe("(empty canvas)");
	});

	// --- canvas_mkdir / canvas_delete / canvas_move ---

	test("canvas_mkdir creates a folder", async () => {
		const result = await getTool("canvas_mkdir").handler({
			path: "sales-campaign",
		});
		expect(result.is_error).toBeUndefined();
		expect(existsSync(join(CANVAS_ROOT, "sales-campaign"))).toBe(true);
	});

	test("canvas_mkdir rejects path traversal", async () => {
		const result = await getTool("canvas_mkdir").handler({
			path: "../escape",
		});
		expect(result.is_error).toBe(true);
	});

	test("canvas_delete removes a file", async () => {
		writeFileSync(join(CANVAS_ROOT, "gone.txt"), "bye");
		const result = await getTool("canvas_delete").handler({ path: "gone.txt" });
		expect(result.is_error).toBeUndefined();
		expect(existsSync(join(CANVAS_ROOT, "gone.txt"))).toBe(false);
	});

	test("canvas_delete removes a folder recursively", async () => {
		mkdirSync(join(CANVAS_ROOT, "blog/posts"), { recursive: true });
		writeFileSync(join(CANVAS_ROOT, "blog/posts/p1.html"), "x");
		const result = await getTool("canvas_delete").handler({ path: "blog" });
		expect(result.is_error).toBeUndefined();
		expect(existsSync(join(CANVAS_ROOT, "blog"))).toBe(false);
	});

	test("canvas_delete refuses to delete the canvas root", async () => {
		for (const p of ["", ".", "/", "./"]) {
			const result = await getTool("canvas_delete").handler({ path: p });
			expect(result.is_error).toBe(true);
		}
		expect(existsSync(CANVAS_ROOT)).toBe(true);
	});

	test("canvas_delete rejects path traversal", async () => {
		const result = await getTool("canvas_delete").handler({
			path: "../../etc",
		});
		expect(result.is_error).toBe(true);
	});

	test("canvas_move renames/moves a file into a folder", async () => {
		writeFileSync(join(CANVAS_ROOT, "index.html"), "<h1>hi</h1>");
		const result = await getTool("canvas_move").handler({
			from: "index.html",
			to: "sales-campaign/index.html",
		});
		expect(result.is_error).toBeUndefined();
		expect(existsSync(join(CANVAS_ROOT, "index.html"))).toBe(false);
		expect(existsSync(join(CANVAS_ROOT, "sales-campaign/index.html"))).toBe(
			true,
		);
	});

	test("canvas_move refuses to overwrite an existing destination", async () => {
		writeFileSync(join(CANVAS_ROOT, "a.txt"), "a");
		writeFileSync(join(CANVAS_ROOT, "b.txt"), "b");
		const result = await getTool("canvas_move").handler({
			from: "a.txt",
			to: "b.txt",
		});
		expect(result.is_error).toBe(true);
	});

	// --- all tools carry plugin: "kernel" ---
	// Canvas tools belong to the kernel manifest (which grants
	// canvas:read/write) so the sandbox permission check passes. They are
	// grouped into a dedicated always-active "canvas" skill by name, not
	// by plugin (see SkillManager.deriveSkillName).

	test("all tools have plugin set to kernel", () => {
		for (const tool of tools) {
			expect(tool.plugin).toBe("kernel");
		}
	});
});
