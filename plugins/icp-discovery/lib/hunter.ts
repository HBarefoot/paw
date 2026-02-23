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
		// Hunter.io only accepts a single department/seniority value per request.
		// When multiple departments are requested, make one call per department
		// and merge/deduplicate the results.
		const departments =
			options.department && options.department.length > 0
				? options.department
				: [undefined]; // undefined = no filter

		const seenEmails = new Set<string>();
		const allContacts: HunterContact[] = [];

		for (const dept of departments) {
			const params = new URLSearchParams({
				domain,
				api_key: config.apiKey,
				limit: String(options.limit ?? 10),
			});

			if (dept) {
				params.set("department", dept);
			}
			if (options.seniority?.length === 1) {
				params.set("seniority", options.seniority[0]);
			}

			let res: Response | undefined;
			for (let attempt = 0; attempt < 3; attempt++) {
				res = await fetch(`${BASE_URL}?${params}`);
				if (res.status === 429) {
					// Rate limited — wait with exponential backoff then retry
					await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
					continue;
				}
				break;
			}
			if (!res || !res.ok) {
				const text = await res?.text().catch(() => "unknown error");
				throw new Error(`Hunter.io search failed (${res?.status ?? "no response"}): ${text}`);
			}

			const data = (await res.json()) as HunterResponse;
			if (data.errors?.length) {
				throw new Error(`Hunter.io error: ${data.errors[0].detail}`);
			}

			for (const contact of data.data?.emails ?? []) {
				if (contact.confidence >= 50 && !seenEmails.has(contact.value)) {
					seenEmails.add(contact.value);
					// If seniority filter has multiple values, filter client-side
					if (
						options.seniority &&
						options.seniority.length > 1 &&
						contact.seniority &&
						!options.seniority.includes(contact.seniority)
					) {
						continue;
					}
					allContacts.push(contact);
				}
			}
		}

		return allContacts;
	}

	return { domainSearch };
}
