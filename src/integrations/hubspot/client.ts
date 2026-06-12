/**
 * Minimal HubSpot CRM client (private-app token auth). Used as a routing
 * target for canvas action bindings — a canvas lead form can create a HubSpot
 * contact. Mirrors the shape of StrapiClient (fetch + AbortController timeout).
 */

export interface HubSpotClientConfig {
	token: string;
	timeout?: number;
}

/** A CRM record as returned by the v3 objects API. */
export interface HubSpotObject {
	id: string;
	properties?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

/** One property filter for a CRM search (combined with AND in a filter group). */
export interface HubSpotSearchFilter {
	propertyName: string;
	/** HubSpot operator, e.g. EQ, NEQ, GT, LT, CONTAINS_TOKEN, HAS_PROPERTY. */
	operator: string;
	value?: string;
}

export class HubSpotError extends Error {
	constructor(
		message: string,
		public status: number,
		public statusText: string,
	) {
		super(message);
		this.name = "HubSpotError";
	}
}

export class HubSpotTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HubSpotTimeoutError";
	}
}

const BASE_URL = "https://api.hubapi.com";

export class HubSpotClient {
	private readonly token: string;
	private readonly timeout: number;

	constructor(config: HubSpotClientConfig) {
		this.token = config.token;
		this.timeout = config.timeout ?? 10_000;
	}

	/**
	 * Create a CRM contact. `properties` is a flat map of HubSpot contact
	 * property names → values (e.g. { email, firstname, lastname, phone }).
	 * Returns the new contact id.
	 */
	async createContact(
		properties: Record<string, unknown>,
	): Promise<{ id: string }> {
		const body = await this.request<{ id: string }>(
			`${BASE_URL}/crm/v3/objects/contacts`,
			"POST",
			{ properties: stringifyValues(properties) },
		);
		return { id: body.id };
	}

	// --- Generic CRM object helpers (contacts/companies/deals share a shape) ---

	/** Create any CRM object; `properties` is a flat map coerced to strings. */
	async createObject(
		objectType: string,
		properties: Record<string, unknown>,
	): Promise<HubSpotObject> {
		return this.request<HubSpotObject>(
			`${BASE_URL}/crm/v3/objects/${objectType}`,
			"POST",
			{ properties: stringifyValues(properties) },
		);
	}

	/** Fetch a CRM object by id, optionally selecting specific properties. */
	async getObject(
		objectType: string,
		id: string,
		properties?: string[],
	): Promise<HubSpotObject> {
		const qs = properties?.length
			? `?properties=${properties.map(encodeURIComponent).join(",")}`
			: "";
		return this.request<HubSpotObject>(
			`${BASE_URL}/crm/v3/objects/${objectType}/${id}${qs}`,
			"GET",
		);
	}

	/** Update a CRM object's properties. */
	async updateObject(
		objectType: string,
		id: string,
		properties: Record<string, unknown>,
	): Promise<HubSpotObject> {
		return this.request<HubSpotObject>(
			`${BASE_URL}/crm/v3/objects/${objectType}/${id}`,
			"PATCH",
			{ properties: stringifyValues(properties) },
		);
	}

	/**
	 * Search a CRM object type. Accepts a free-text `query` and/or a flat list of
	 * property filters (combined with AND in a single filter group).
	 */
	async searchObjects(
		objectType: string,
		opts: {
			query?: string;
			filters?: HubSpotSearchFilter[];
			properties?: string[];
			limit?: number;
		} = {},
	): Promise<{ total: number; results: HubSpotObject[] }> {
		const body: Record<string, unknown> = {};
		if (opts.query) body.query = opts.query;
		if (opts.filters?.length) {
			body.filterGroups = [{ filters: opts.filters }];
		}
		if (opts.properties) body.properties = opts.properties;
		if (opts.limit) body.limit = opts.limit;
		return this.request<{ total: number; results: HubSpotObject[] }>(
			`${BASE_URL}/crm/v3/objects/${objectType}/search`,
			"POST",
			body,
		);
	}

	// --- Named convenience wrappers ---

	searchContacts(opts: {
		query?: string;
		filters?: HubSpotSearchFilter[];
		properties?: string[];
		limit?: number;
	}): Promise<{ total: number; results: HubSpotObject[] }> {
		return this.searchObjects("contacts", opts);
	}
	getContact(id: string, properties?: string[]): Promise<HubSpotObject> {
		return this.getObject("contacts", id, properties);
	}
	updateContact(
		id: string,
		properties: Record<string, unknown>,
	): Promise<HubSpotObject> {
		return this.updateObject("contacts", id, properties);
	}

	createCompany(properties: Record<string, unknown>): Promise<HubSpotObject> {
		return this.createObject("companies", properties);
	}
	searchCompanies(opts: {
		query?: string;
		filters?: HubSpotSearchFilter[];
		properties?: string[];
		limit?: number;
	}): Promise<{ total: number; results: HubSpotObject[] }> {
		return this.searchObjects("companies", opts);
	}
	getCompany(id: string, properties?: string[]): Promise<HubSpotObject> {
		return this.getObject("companies", id, properties);
	}
	updateCompany(
		id: string,
		properties: Record<string, unknown>,
	): Promise<HubSpotObject> {
		return this.updateObject("companies", id, properties);
	}

	createDeal(properties: Record<string, unknown>): Promise<HubSpotObject> {
		return this.createObject("deals", properties);
	}
	getDeal(id: string, properties?: string[]): Promise<HubSpotObject> {
		return this.getObject("deals", id, properties);
	}
	updateDeal(
		id: string,
		properties: Record<string, unknown>,
	): Promise<HubSpotObject> {
		return this.updateObject("deals", id, properties);
	}

	/**
	 * Create a note and (optionally) associate it to a contact/company/deal.
	 * `timestamp` defaults to now; HubSpot requires hs_timestamp on notes.
	 */
	async createNote(opts: {
		body: string;
		associateTo?: { type: string; id: string };
		timestamp?: string;
	}): Promise<HubSpotObject> {
		const note = await this.createObject("notes", {
			hs_note_body: opts.body,
			hs_timestamp: opts.timestamp ?? new Date().toISOString(),
		});
		if (opts.associateTo) {
			await this.associate(
				"notes",
				note.id,
				opts.associateTo.type,
				opts.associateTo.id,
			);
		}
		return note;
	}

	/**
	 * Associate two CRM records using HubSpot's default association type
	 * (v4 `PUT .../associations/default/...`).
	 */
	async associate(
		fromType: string,
		fromId: string,
		toType: string,
		toId: string,
	): Promise<void> {
		await this.request<unknown>(
			`${BASE_URL}/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
			"PUT",
		);
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
				redirect: "error",
				headers: {
					Authorization: `Bearer ${this.token}`,
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new HubSpotError(
					`HubSpot ${method} ${url} failed: ${res.status} ${text.slice(0, 200)}`,
					res.status,
					res.statusText,
				);
			}
			return (await res.json()) as T;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new HubSpotTimeoutError(
					`HubSpot request timed out after ${this.timeout}ms`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}
}

/** HubSpot contact properties must be strings. Coerce defensively. */
function stringifyValues(obj: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v == null) continue;
		out[k] = typeof v === "string" ? v : String(v);
	}
	return out;
}
