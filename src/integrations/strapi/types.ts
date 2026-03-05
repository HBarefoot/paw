export interface StrapiAttributes {
	[key: string]: unknown;
}

export interface StrapiEntry {
	id: number;
	documentId: string;
	attributes?: StrapiAttributes;
}

export interface StrapiPagination {
	page: number;
	pageSize: number;
	pageCount: number;
	total: number;
}

export interface StrapiListResponse {
	data: StrapiEntry[];
	meta: { pagination: StrapiPagination };
}

export interface StrapiItemResponse {
	data: StrapiEntry;
}

export interface StrapiQueryParams {
	filters?: Record<string, unknown>;
	populate?: string | string[];
	fields?: string[];
	sort?: string | string[];
	pagination?: { page?: number; pageSize?: number };
}

export class StrapiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly statusText: string,
	) {
		super(message);
		this.name = "StrapiError";
	}
}

export class StrapiTimeoutError extends Error {
	constructor(message = "Strapi request timed out") {
		super(message);
		this.name = "StrapiTimeoutError";
	}
}
