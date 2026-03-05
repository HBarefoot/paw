import type {
	StrapiListResponse,
	StrapiItemResponse,
	StrapiQueryParams,
} from "./types.js";
import { StrapiError, StrapiTimeoutError } from "./types.js";

export interface StrapiClientConfig {
	url: string;
	token: string;
	timeout?: number;
}

export class StrapiClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly timeout: number;

	constructor(config: StrapiClientConfig) {
		if (!config.token) {
			throw new Error(
				"Strapi token is required. Set PAW_STRAPI_TOKEN or add it to ~/.paw/credentials.json",
			);
		}
		// Strip trailing slash
		this.baseUrl = config.url.replace(/\/+$/, "");
		this.token = config.token;
		this.timeout = config.timeout ?? 10_000;
	}

	async find(
		contentType: string,
		params?: StrapiQueryParams,
	): Promise<StrapiListResponse> {
		const qs = this.buildQueryString(params);
		const url = `${this.baseUrl}/api/${contentType}${qs ? `?${qs}` : ""}`;
		return this.request<StrapiListResponse>(url, "GET");
	}

	async findOne(
		contentType: string,
		documentId: string,
		params?: StrapiQueryParams,
	): Promise<StrapiItemResponse> {
		const qs = this.buildQueryString(params);
		const url = `${this.baseUrl}/api/${contentType}/${documentId}${qs ? `?${qs}` : ""}`;
		return this.request<StrapiItemResponse>(url, "GET");
	}

	async create(
		contentType: string,
		data: Record<string, unknown>,
	): Promise<StrapiItemResponse> {
		const url = `${this.baseUrl}/api/${contentType}`;
		return this.request<StrapiItemResponse>(url, "POST", { data });
	}

	async update(
		contentType: string,
		documentId: string,
		data: Record<string, unknown>,
	): Promise<StrapiItemResponse> {
		const url = `${this.baseUrl}/api/${contentType}/${documentId}`;
		return this.request<StrapiItemResponse>(url, "PUT", { data });
	}

	async getContentTypes(): Promise<unknown> {
		const url = `${this.baseUrl}/api/content-type-builder/content-types`;
		return this.request<unknown>(url, "GET");
	}

	async healthCheck(): Promise<boolean> {
		try {
			const url = `${this.baseUrl}/_health`;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 5_000);
			try {
				const res = await fetch(url, {
					signal: controller.signal,
					headers: { Authorization: `Bearer ${this.token}` },
				});
				return res.ok;
			} finally {
				clearTimeout(timer);
			}
		} catch {
			return false;
		}
	}

	private async request<T>(
		url: string,
		method: string,
		body?: unknown,
	): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);

		try {
			const res = await fetch(url, {
				method,
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${this.token}`,
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new StrapiError(
					`Strapi ${method} ${url} failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
					res.status,
					res.statusText,
				);
			}

			return (await res.json()) as T;
		} catch (err) {
			if (err instanceof StrapiError) throw err;
			if (
				err instanceof DOMException &&
				err.name === "AbortError"
			) {
				throw new StrapiTimeoutError(
					`Strapi request timed out after ${this.timeout}ms: ${method} ${url}`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}

	private buildQueryString(params?: StrapiQueryParams): string {
		if (!params) return "";
		const parts: string[] = [];

		if (params.filters) {
			for (const [key, value] of Object.entries(params.filters)) {
				if (typeof value === "object" && value !== null) {
					for (const [op, val] of Object.entries(
						value as Record<string, unknown>,
					)) {
						parts.push(
							`filters[${key}][${op}]=${encodeURIComponent(String(val))}`,
						);
					}
				} else {
					parts.push(
						`filters[${key}]=${encodeURIComponent(String(value))}`,
					);
				}
			}
		}

		if (params.populate) {
			if (Array.isArray(params.populate)) {
				for (const p of params.populate) {
					parts.push(`populate=${encodeURIComponent(p)}`);
				}
			} else {
				parts.push(`populate=${encodeURIComponent(params.populate)}`);
			}
		}

		if (params.fields) {
			for (const f of params.fields) {
				parts.push(`fields=${encodeURIComponent(f)}`);
			}
		}

		if (params.sort) {
			const sortArr = Array.isArray(params.sort)
				? params.sort
				: [params.sort];
			for (const s of sortArr) {
				parts.push(`sort=${encodeURIComponent(s)}`);
			}
		}

		if (params.pagination) {
			if (params.pagination.page !== undefined) {
				parts.push(`pagination[page]=${params.pagination.page}`);
			}
			if (params.pagination.pageSize !== undefined) {
				parts.push(`pagination[pageSize]=${params.pagination.pageSize}`);
			}
		}

		return parts.join("&");
	}
}
