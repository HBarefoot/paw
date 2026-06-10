/**
 * Minimal HubSpot CRM client (private-app token auth). Used as a routing
 * target for canvas action bindings — a canvas lead form can create a HubSpot
 * contact. Mirrors the shape of StrapiClient (fetch + AbortController timeout).
 */

export interface HubSpotClientConfig {
	token: string;
	timeout?: number;
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
