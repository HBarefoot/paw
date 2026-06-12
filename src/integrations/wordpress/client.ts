/**
 * WordPress REST client (Application Passwords / HTTP Basic). Mirrors the
 * StrapiClient/HubSpotClient shape (fetch + AbortController timeout + typed
 * errors). Posts default to "draft" — publishing is an explicit, audited action.
 * Media is uploaded as a raw binary body; the caller reads bytes from a
 * sandboxed workspace path.
 */

import {
	type WordPressClientConfig,
	type WordPressContentInput,
	type WordPressContentType,
	WordPressError,
	type WordPressTerm,
	WordPressTimeoutError,
} from "./types.js";

/** Minimal extension → MIME map for media uploads. */
const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	pdf: "application/pdf",
};

export function mimeForFilename(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export class WordPressClient {
	private readonly baseUrl: string;
	private readonly authHeader: string;
	private readonly timeout: number;

	constructor(config: WordPressClientConfig) {
		if (!config.url) throw new Error("WordPress url is required.");
		if (!config.username || !config.appPassword) {
			throw new Error("WordPress username and appPassword are required.");
		}
		this.baseUrl = `${config.url.replace(/\/+$/, "")}/wp-json/wp/v2`;
		this.authHeader = `Basic ${Buffer.from(
			`${config.username}:${config.appPassword}`,
		).toString("base64")}`;
		this.timeout = config.timeout ?? 10_000;
	}

	// --- Posts / pages (shared CRUD) ---

	/** Create a post or page. Status defaults to "draft" (publishing is explicit). */
	async createContent(
		type: WordPressContentType,
		input: WordPressContentInput,
	): Promise<Record<string, unknown>> {
		const body = {
			status: "draft",
			...stripUndefined(input as Record<string, unknown>),
		};
		return this.request(`/${type}`, "POST", body);
	}

	/** Update a post or page by id. */
	async updateContent(
		type: WordPressContentType,
		id: number,
		input: WordPressContentInput,
	): Promise<Record<string, unknown>> {
		return this.request(
			`/${type}/${id}`,
			"POST",
			stripUndefined(input as Record<string, unknown>),
		);
	}

	async getContent(
		type: WordPressContentType,
		id: number,
	): Promise<Record<string, unknown>> {
		return this.request(`/${type}/${id}`, "GET");
	}

	async listContent(
		type: WordPressContentType,
		opts: { status?: string; search?: string; perPage?: number } = {},
	): Promise<Record<string, unknown>[]> {
		const qs: string[] = [];
		if (opts.status) qs.push(`status=${encodeURIComponent(opts.status)}`);
		if (opts.search) qs.push(`search=${encodeURIComponent(opts.search)}`);
		qs.push(`per_page=${Math.min(opts.perPage ?? 10, 100)}`);
		return this.request(`/${type}?${qs.join("&")}`, "GET");
	}

	/** Delete a post or page. `force` skips the trash and deletes permanently. */
	async deleteContent(
		type: WordPressContentType,
		id: number,
		force = false,
	): Promise<Record<string, unknown>> {
		return this.request(
			`/${type}/${id}?force=${force ? "true" : "false"}`,
			"DELETE",
		);
	}

	// --- Taxonomies ---

	listCategories(): Promise<WordPressTerm[]> {
		return this.request("/categories?per_page=100", "GET");
	}
	listTags(): Promise<WordPressTerm[]> {
		return this.request("/tags?per_page=100", "GET");
	}

	// --- Media ---

	/**
	 * Upload a media file (raw binary body). `data` is the file bytes; the caller
	 * is responsible for reading them from a sandboxed workspace path and for the
	 * size cap. Returns the created media object (id, source_url, …).
	 */
	async uploadMedia(
		filename: string,
		data: ArrayBuffer | Uint8Array,
		mimeType?: string,
	): Promise<Record<string, unknown>> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		const url = `${this.baseUrl}/media`;
		try {
			const res = await fetch(url, {
				method: "POST",
				signal: controller.signal,
				redirect: "error",
				headers: {
					Authorization: this.authHeader,
					"Content-Type": mimeType ?? mimeForFilename(filename),
					"Content-Disposition": `attachment; filename="${filename}"`,
				},
				body: data as BodyInit,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new WordPressError(
					`WordPress media upload failed: ${res.status} ${res.statusText}${
						text ? ` — ${text.slice(0, 300)}` : ""
					}`,
					res.status,
					res.statusText,
				);
			}
			return (await res.json()) as Record<string, unknown>;
		} catch (err) {
			if (err instanceof WordPressError) throw err;
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new WordPressTimeoutError(
					`WordPress media upload timed out after ${this.timeout}ms`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}

	private async request<T = Record<string, unknown>>(
		path: string,
		method: string,
		body?: unknown,
	): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				method,
				signal: controller.signal,
				redirect: "error",
				headers: {
					Authorization: this.authHeader,
					"Content-Type": "application/json",
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new WordPressError(
					`WordPress ${method} ${path} failed: ${res.status} ${res.statusText}${
						text ? ` — ${text.slice(0, 300)}` : ""
					}`,
					res.status,
					res.statusText,
				);
			}
			const raw = await res.text();
			return (raw ? JSON.parse(raw) : null) as T;
		} catch (err) {
			if (err instanceof WordPressError) throw err;
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new WordPressTimeoutError(
					`WordPress request timed out after ${this.timeout}ms: ${method} ${path}`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k] = v;
	}
	return out;
}
