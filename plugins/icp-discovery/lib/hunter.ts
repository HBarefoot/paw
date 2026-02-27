const BASE_URL = "https://api.hunter.io/v2/domain-search";
const VERIFIER_URL = "https://api.hunter.io/v2/email-verifier";

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
	meta?: { params?: { remaining?: number } };
	errors?: Array<{ id: string; detail?: string; details?: string }>;
}

export interface EmailVerifyResult {
	status: string;
	score: number;
	email: string;
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
					console.log(`[hunter.io] Rate limited for ${domain}, retry ${attempt + 1}/3`);
					await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
					continue;
				}
				break;
			}
			if (!res) {
				throw new Error(`Hunter.io search failed: no response for ${domain}`);
			}

			// Try to parse response regardless of status — Hunter.io returns
			// 400 for pagination_error but still includes valid email data
			// (plan caps results at N emails).
			let data: HunterResponse;
			if (!res.ok) {
				let body: HunterResponse | undefined;
				try {
					body = (await res.json()) as HunterResponse;
				} catch {
					const text = await res.text().catch(() => "unknown error");
					console.error(`[hunter.io] API error for ${domain}: ${res.status} ${text}`);
					throw new Error(`Hunter.io search failed (${res.status}): ${text}`);
				}

				const isPaginationError = body?.errors?.some(
					(e: { id?: string }) => e.id === "pagination_error",
				);
				if (isPaginationError && body?.data?.emails) {
					console.log(`[hunter.io] Plan limit reached for ${domain} — using ${body.data.emails.length} capped results`);
					data = body;
				} else {
					const errDetail = body?.errors?.[0]?.detail ?? (body?.errors?.[0] as Record<string, unknown>)?.details ?? "unknown";
					console.error(`[hunter.io] API error for ${domain}: ${res.status} ${errDetail}`);
					throw new Error(`Hunter.io search failed (${res.status}): ${errDetail}`);
				}
			} else {
				data = (await res.json()) as HunterResponse;
			}

			const emailCount = data.data?.emails?.length ?? 0;
			const remaining = data.meta?.params?.remaining ?? "unknown";
			console.log(`[hunter.io] Domain: ${domain}${dept ? ` dept=${dept}` : ""} | Status: ${res.status} | Results: ${emailCount} | Quota remaining: ${remaining}`);

			for (const contact of data.data?.emails ?? []) {
				// Accept contacts with confidence >= 30 (lowered from 50 to improve hit rate)
				if (contact.confidence >= 30 && !seenEmails.has(contact.value)) {
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

	async function verifyEmail(email: string): Promise<EmailVerifyResult | null> {
		try {
			const params = new URLSearchParams({
				email,
				api_key: config.apiKey,
			});
			const res = await fetch(`${VERIFIER_URL}?${params}`);
			if (!res.ok) {
				console.log(`[hunter.io] Email verify failed for ${email}: ${res.status}`);
				return null;
			}
			const data = (await res.json()) as { data?: { status: string; score: number; email: string } };
			console.log(`[hunter.io] Email verify: ${email} → ${data.data?.status} (score: ${data.data?.score})`);
			return data.data ?? null;
		} catch {
			return null;
		}
	}

	return { domainSearch, verifyEmail };
}
