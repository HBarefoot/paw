const BASE_URL = "https://api.hunter.io/v2/domain-search";

export interface HunterConfig {
	apiKey: string;
}

export interface HunterContact {
	value: string;
	first_name: string;
	last_name: string;
	confidence: number;
	position: string;
	department: string;
	seniority: string;
	linkedin: string | null;
}

export interface HunterResponse {
	data?: {
		domain: string;
		organization: string;
		emails?: HunterContact[];
	};
	errors?: Array<{ id: string; detail: string }>;
}

export interface DomainSearchOptions {
	department?: string[];
	seniority?: string[];
	limit?: number;
}

export function createHunterClient(config: HunterConfig) {
	async function domainSearch(
		domain: string,
		options: DomainSearchOptions = {},
	): Promise<HunterContact[]> {
		const params = new URLSearchParams({
			domain,
			api_key: config.apiKey,
			limit: String(options.limit ?? 10),
		});

		if (options.department?.length) {
			params.set("department", options.department.join(","));
		}
		if (options.seniority?.length) {
			params.set("seniority", options.seniority.join(","));
		}

		const res = await fetch(`${BASE_URL}?${params}`);
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Hunter.io search failed (${res.status}): ${text}`);
		}

		const data = (await res.json()) as HunterResponse;
		if (data.errors?.length) {
			throw new Error(`Hunter.io error: ${data.errors[0].detail}`);
		}

		return (data.data?.emails ?? []).filter(
			(contact) => contact.confidence >= 50,
		);
	}

	return { domainSearch };
}
