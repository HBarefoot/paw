import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillManager } from "../../../src/ai/skills.js";
import { ToolRegistry } from "../../../src/ai/tools.js";
import { WordPressClient } from "../../../src/integrations/wordpress/client.js";
import { createWordPressTools } from "../../../src/integrations/wordpress/tools.js";
import { WordPressError } from "../../../src/integrations/wordpress/types.js";

const SITE = "https://example.com";
const USER = "admin";
const PASS = "app pass word";
const EXPECTED_AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;

interface Captured {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
}

let calls: Captured[];
let originalFetch: typeof globalThis.fetch;

function mockFetch(status: number, payload: unknown) {
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const u =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		calls.push({
			url: u,
			method: init?.method,
			headers: init?.headers as Record<string, string> | undefined,
			body: init?.body,
		});
		return new Response(
			typeof payload === "string" ? payload : JSON.stringify(payload),
			{ status, headers: { "Content-Type": "application/json" } },
		);
	}) as typeof globalThis.fetch;
}

beforeEach(() => {
	calls = [];
	originalFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const makeClient = () =>
	new WordPressClient({ url: SITE, username: USER, appPassword: PASS });

describe("WordPressClient", () => {
	test("createContent defaults to draft and sends Basic auth", async () => {
		mockFetch(201, { id: 12, status: "draft" });
		const res = await makeClient().createContent("posts", {
			title: "Hello",
			content: "<p>hi</p>",
		});
		expect((res as { id: number }).id).toBe(12);
		expect(calls[0].url).toBe(`${SITE}/wp-json/wp/v2/posts`);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].headers?.Authorization).toBe(EXPECTED_AUTH);
		expect(JSON.parse(calls[0].body as string)).toEqual({
			status: "draft",
			title: "Hello",
			content: "<p>hi</p>",
		});
	});

	test("createContent honors an explicit publish status", async () => {
		mockFetch(201, { id: 13 });
		await makeClient().createContent("posts", {
			title: "Live",
			status: "publish",
		});
		expect(JSON.parse(calls[0].body as string).status).toBe("publish");
	});

	test("updateContent POSTs to the page by id", async () => {
		mockFetch(200, { id: 5 });
		await makeClient().updateContent("pages", 5, { title: "New" });
		expect(calls[0].method).toBe("POST");
		expect(calls[0].url).toBe(`${SITE}/wp-json/wp/v2/pages/5`);
	});

	test("listContent encodes status, search, and per_page", async () => {
		mockFetch(200, []);
		await makeClient().listContent("posts", {
			status: "draft",
			search: "hi there",
			perPage: 5,
		});
		expect(calls[0].url).toBe(
			`${SITE}/wp-json/wp/v2/posts?status=draft&search=hi%20there&per_page=5`,
		);
	});

	test("deleteContent DELETEs by id with force", async () => {
		mockFetch(200, { deleted: true });
		await makeClient().deleteContent("posts", 9, true);
		expect(calls[0].method).toBe("DELETE");
		expect(calls[0].url).toBe(`${SITE}/wp-json/wp/v2/posts/9?force=true`);
	});

	test("uploadMedia posts raw bytes with Content-Disposition", async () => {
		mockFetch(201, { id: 99, source_url: "https://example.com/x.png" });
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const res = await makeClient().uploadMedia("x.png", bytes);
		expect((res as { id: number }).id).toBe(99);
		expect(calls[0].url).toBe(`${SITE}/wp-json/wp/v2/media`);
		expect(calls[0].headers?.["Content-Type"]).toBe("image/png");
		expect(calls[0].headers?.["Content-Disposition"]).toBe(
			'attachment; filename="x.png"',
		);
	});

	test("non-2xx throws a typed WordPressError", async () => {
		mockFetch(401, "unauthorized");
		await expect(makeClient().getContent("posts", 1)).rejects.toBeInstanceOf(
			WordPressError,
		);
	});
});

describe("wp_upload_media tool (sandboxed workspace)", () => {
	let workspace: string;
	beforeAll(() => {
		// realpathSync canonicalizes /var→/private/var so safePath's symlink check
		// (which realpaths the target) agrees with the workspace root on macOS.
		workspace = realpathSync(mkdtempSync(join(tmpdir(), "paw-wp-")));
		writeFileSync(
			join(workspace, "pic.png"),
			Buffer.from([0x89, 0x50, 0x4e, 0x47]),
		);
		writeFileSync(join(workspace, "big.png"), Buffer.alloc(2048));
	});
	afterAll(() => rmSync(workspace, { recursive: true, force: true }));

	function tool(maxMediaBytes?: number) {
		const tools = createWordPressTools(makeClient(), {
			workspace,
			maxMediaBytes,
		});
		const t = tools.find((x) => x.name === "wp_upload_media");
		if (!t) throw new Error("wp_upload_media not found");
		return t;
	}

	test("uploads a workspace file", async () => {
		mockFetch(201, { id: 7 });
		const res = await tool().handler({ path: "pic.png" });
		expect(res.is_error).toBeFalsy();
		expect(JSON.parse(res.content).id).toBe(7);
		expect(calls[0].url).toBe(`${SITE}/wp-json/wp/v2/media`);
	});

	test("refuses a file over the size cap without uploading", async () => {
		mockFetch(201, { id: 7 });
		const res = await tool(1024).handler({ path: "big.png" });
		expect(res.is_error).toBe(true);
		expect(res.content).toMatch(/too large/);
		expect(calls.length).toBe(0);
	});

	test("refuses a path escaping the workspace", async () => {
		mockFetch(201, { id: 7 });
		const res = await tool().handler({ path: "../escape.png" });
		expect(res.is_error).toBe(true);
		expect(res.content).toMatch(/outside the workspace/);
		expect(calls.length).toBe(0);
	});
});

describe("wordpress skill registration", () => {
	test("tools form a single on-demand skill (13 tools)", () => {
		const registry = new ToolRegistry();
		registry.register(
			createWordPressTools(makeClient(), { workspace: "/tmp" }),
		);
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		const skill = skills.getSkill("wordpress");
		expect(skill).toBeDefined();
		expect(skill?.alwaysActive).toBe(false);
		expect(skill?.toolNames).toContain("wp_create_post");
		expect(skill?.toolNames).toContain("wp_upload_media");
		expect(skill?.toolNames).toContain("wp_delete_page");
		expect(skill?.toolNames.length).toBe(13);
	});

	test("config absent → no wordpress skill, zero behavior change", () => {
		const registry = new ToolRegistry();
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		expect(skills.getSkill("wordpress")).toBeUndefined();
	});
});
