import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { StrapiClient } from "../../../src/integrations/strapi/client.js";
import {
	StrapiError,
	StrapiTimeoutError,
} from "../../../src/integrations/strapi/types.js";

const BASE_URL = "http://strapi.railway.internal:1337";
const TOKEN = "test-token-abc123";

// Save and restore global fetch
let originalFetch: typeof globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		return handler(url, init);
	};
}

beforeEach(() => {
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("StrapiClient", () => {
	test("constructor throws when token is missing", () => {
		expect(() => new StrapiClient({ url: BASE_URL, token: "" })).toThrow(
			"Strapi token is required",
		);
	});

	test("find() returns parsed entries from mock response", async () => {
		const mockData = {
			data: [
				{ id: 1, attributes: { title: "Hello World", slug: "hello-world" } },
				{ id: 2, attributes: { title: "Second Post", slug: "second-post" } },
			],
			meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 2 } },
		};

		mockFetch((url, init) => {
			expect(url).toStartWith(`${BASE_URL}/api/articles`);
			expect(init?.headers).toEqual(
				expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
			);
			return new Response(JSON.stringify(mockData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const result = await client.find("articles");

		expect(result.data).toHaveLength(2);
		expect(result.data[0].id).toBe(1);
		expect(result.data[0].attributes.title).toBe("Hello World");
		expect(result.meta.pagination.total).toBe(2);
	});

	test("find() passes filters and pagination as query params", async () => {
		let capturedUrl = "";
		mockFetch((url) => {
			capturedUrl = url;
			return new Response(
				JSON.stringify({ data: [], meta: { pagination: { page: 2, pageSize: 10, pageCount: 5, total: 50 } } }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		await client.find("articles", {
			filters: { status: "published" },
			pagination: { page: 2, pageSize: 10 },
		});

		expect(capturedUrl).toContain("filters[status]=published");
		expect(capturedUrl).toContain("pagination[page]=2");
		expect(capturedUrl).toContain("pagination[pageSize]=10");
	});

	test("findOne() returns single parsed entry", async () => {
		const mockData = {
			data: { id: 42, documentId: "abc123def456", title: "Specific Post", body: "Content here" },
		};

		mockFetch((url) => {
			expect(url).toContain("/api/articles/abc123def456");
			return new Response(JSON.stringify(mockData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const result = await client.findOne("articles", "abc123def456");

		expect(result.data.id).toBe(42);
		expect(result.data.documentId).toBe("abc123def456");
	});

	test("create() sends POST with data and returns new entry", async () => {
		let capturedMethod = "";
		let capturedBody = "";

		mockFetch(async (url, init) => {
			capturedMethod = init?.method ?? "";
			capturedBody = init?.body as string;
			expect(url).toBe(`${BASE_URL}/api/articles`);
			return new Response(
				JSON.stringify({
					data: { id: 99, attributes: { title: "New Post", slug: "new-post" } },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const result = await client.create("articles", {
			title: "New Post",
			slug: "new-post",
		});

		expect(capturedMethod).toBe("POST");
		expect(JSON.parse(capturedBody)).toEqual({
			data: { title: "New Post", slug: "new-post" },
		});
		expect(result.data.id).toBe(99);
	});

	test("update() sends PUT with data and returns updated entry", async () => {
		let capturedMethod = "";

		mockFetch((url, init) => {
			capturedMethod = init?.method ?? "";
			expect(url).toBe(`${BASE_URL}/api/articles/abc123def456`);
			return new Response(
				JSON.stringify({
					data: { id: 42, documentId: "abc123def456", title: "Updated Post" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const result = await client.update("articles", "abc123def456", {
			title: "Updated Post",
		});

		expect(capturedMethod).toBe("PUT");
	});

	test("non-2xx response throws StrapiError with correct status", async () => {
		mockFetch(() => {
			return new Response("Not Found", { status: 404, statusText: "Not Found" });
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });

		try {
			await client.find("nonexistent");
			expect(true).toBe(false); // Should not reach here
		} catch (err) {
			expect(err).toBeInstanceOf(StrapiError);
			const strapiErr = err as StrapiError;
			expect(strapiErr.status).toBe(404);
			expect(strapiErr.statusText).toBe("Not Found");
		}
	});

	test("request timeout throws StrapiTimeoutError", async () => {
		mockFetch(() => {
			// Return a promise that never resolves, but the AbortController will fire
			return new Promise<Response>((_, reject) => {
				// The AbortController will abort, causing fetch to reject
				setTimeout(() => {
					const err = new DOMException("The operation was aborted.", "AbortError");
					reject(err);
				}, 5);
			});
		});

		const client = new StrapiClient({
			url: BASE_URL,
			token: TOKEN,
			timeout: 1, // 1ms timeout to trigger quickly
		});

		try {
			await client.find("articles");
			expect(true).toBe(false); // Should not reach here
		} catch (err) {
			expect(err).toBeInstanceOf(StrapiTimeoutError);
		}
	});

	test("healthCheck() returns true on 200", async () => {
		mockFetch((url) => {
			expect(url).toBe(`${BASE_URL}/_health`);
			return new Response("ok", { status: 200 });
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const ok = await client.healthCheck();
		expect(ok).toBe(true);
	});

	test("healthCheck() returns false on error", async () => {
		mockFetch(() => {
			throw new Error("Connection refused");
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const ok = await client.healthCheck();
		expect(ok).toBe(false);
	});

	test("getContentTypes() calls content-type-builder endpoint", async () => {
		const mockData = {
			data: [
				{
					uid: "api::article.article",
					info: { displayName: "Article", singularName: "article", pluralName: "articles" },
				},
				{
					uid: "api::page.page",
					info: { displayName: "Page", singularName: "page", pluralName: "pages" },
				},
				{
					uid: "plugin::users-permissions.user",
					info: { displayName: "User", singularName: "user", pluralName: "users" },
				},
			],
		};

		mockFetch((url) => {
			expect(url).toBe(`${BASE_URL}/api/content-type-builder/content-types`);
			return new Response(JSON.stringify(mockData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		const result = await client.getContentTypes() as Record<string, unknown>;

		expect(Array.isArray(result.data)).toBe(true);
		const data = result.data as Array<Record<string, unknown>>;
		expect(data).toHaveLength(3);
		expect(data[0].uid).toBe("api::article.article");
	});

	test("find() handles flat array responses (e.g. /api/users)", async () => {
		// Some Strapi endpoints (like users) return flat arrays, not { data, meta }
		const mockData = [
			{ id: 1, username: "admin", email: "admin@test.com" },
			{ id: 2, username: "editor", email: "editor@test.com" },
		];

		mockFetch(() => {
			return new Response(JSON.stringify(mockData), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		const client = new StrapiClient({ url: BASE_URL, token: TOKEN });
		// find() casts to StrapiListResponse, but the raw JSON is a flat array
		const result = await client.find("users");
		// The result won't have .data as an array of {id, attributes} but
		// the tools layer handles this via extractList()
		expect(result).toBeDefined();
	});
});
