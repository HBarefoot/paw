import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createFileTools } from "../../src/tools/file-tools.js";

const WORKSPACE = join(import.meta.dir, ".test-workspace");

describe("file tools", () => {
	let tools: ReturnType<typeof createFileTools>;

	beforeEach(() => {
		mkdirSync(WORKSPACE, { recursive: true });
		mkdirSync(join(WORKSPACE, "sub"), { recursive: true });
		writeFileSync(join(WORKSPACE, "hello.txt"), "Hello World\nLine 2\nLine 3");
		writeFileSync(join(WORKSPACE, "sub/nested.txt"), "nested file");
		tools = createFileTools({
			workspacePath: WORKSPACE,
			maxFileSize: 1_048_576,
			maxOutputLength: 10_000,
		});
	});

	afterEach(() => {
		rmSync(WORKSPACE, { recursive: true, force: true });
	});

	function getTool(name: string) {
		return tools.find((t) => t.name === name)!;
	}

	test("file_read reads a file", async () => {
		const result = await getTool("file_read").handler({ path: "hello.txt" });
		expect(result.content).toContain("Hello World");
		expect(result.is_error).toBeUndefined();
	});

	test("file_read with offset and limit", async () => {
		const result = await getTool("file_read").handler({
			path: "hello.txt",
			offset: 1,
			limit: 1,
		});
		expect(result.content).toBe("Line 2");
	});

	test("file_read rejects path traversal", async () => {
		const result = await getTool("file_read").handler({
			path: "../../../etc/passwd",
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("outside workspace");
	});

	test("file_read returns error for missing file", async () => {
		const result = await getTool("file_read").handler({ path: "nope.txt" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not found");
	});

	test("file_write creates a file", async () => {
		const result = await getTool("file_write").handler({
			path: "new.txt",
			content: "hello",
		});
		expect(result.is_error).toBeUndefined();
		const readResult = await getTool("file_read").handler({ path: "new.txt" });
		expect(readResult.content).toBe("hello");
	});

	test("file_write appends to a file", async () => {
		await getTool("file_write").handler({
			path: "hello.txt",
			content: "\nLine 4",
			append: true,
		});
		const result = await getTool("file_read").handler({ path: "hello.txt" });
		expect(result.content).toContain("Line 4");
	});

	test("file_list lists directory", async () => {
		const result = await getTool("file_list").handler({ path: "." });
		expect(result.content).toContain("hello.txt");
		expect(result.content).toContain("sub/");
	});

	test("file_list recursive", async () => {
		const result = await getTool("file_list").handler({
			path: ".",
			recursive: true,
		});
		expect(result.content).toContain("sub/nested.txt");
	});
});
