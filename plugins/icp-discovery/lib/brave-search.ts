const BRAVE_WEB_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_LOCAL_URL =
	"https://api.search.brave.com/res/v1/local/pois/search";
const DELAY_MS = 500;

let lastCallTime = 0;

async function throttle(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastCallTime;
	if (elapsed < DELAY_MS) {
		await new Promise((resolve) => setTimeout(resolve, DELAY_MS - elapsed));
	}
	lastCallTime = Date.now();
}

// Re-export types with original names for backward compatibility
export interface SerpApiConfig {
	apiKey: string;
}

export interface OrganicResult {
	title: string;
	link: string;
	snippet: string;
	position: number;
}

export interface GoogleSearchResponse {
	organic_results?: OrganicResult[];
	knowledge_graph?: Record<string, unknown>;
	search_metadata?: Record<string, unknown>;
}

export interface MapsResult {
	title: string;
	address: string;
	gps_coordinates?: { latitude: number; longitude: number };
	place_id?: string;
	rating?: number;
	reviews?: number;
}

export interface GoogleMapsResponse {
	local_results?: MapsResult[];
	search_metadata?: Record<string, unknown>;
}

// Brave API response types (internal)
interface BraveWebResult {
	title: string;
	url: string;
	description: string;
	extra_snippets?: string[];
}

interface BraveWebResponse {
	web?: { results?: BraveWebResult[] };
	infobox?: { results?: Array<Record<string, unknown>> };
}

interface BraveLocalResult {
	title: string;
	address?: {
		streetAddress?: string;
		addressLocality?: string;
		addressRegion?: string;
		postalCode?: string;
	};
	coordinates?: { latitude: number; longitude: number };
	rating?: { ratingValue: number; ratingCount: number };
	id?: string;
}

interface BraveLocalResponse {
	results?: BraveLocalResult[];
}

function braveHeaders(apiKey: string): Record<string, string> {
	return {
		Accept: "application/json",
		"Accept-Encoding": "gzip",
		"X-Subscription-Token": apiKey,
	};
}

export type SearchClient = ReturnType<typeof createSerpApiClient>;

export function createSerpApiClient(config: SerpApiConfig) {
	async function googleSearch(query: string): Promise<GoogleSearchResponse> {
		await throttle();
		const params = new URLSearchParams({ q: query, count: "10" });
		const res = await fetch(`${BRAVE_WEB_URL}?${params}`, {
			headers: braveHeaders(config.apiKey),
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) {
			throw new Error(
				`Brave Web Search failed (${res.status}): ${await res.text()}`,
			);
		}
		const data = (await res.json()) as BraveWebResponse;

		const organic_results: OrganicResult[] = (data.web?.results ?? []).map(
			(r, i) => ({
				title: r.title,
				link: r.url,
				snippet: r.description || "",
				position: i + 1,
			}),
		);

		// Map Brave infobox to knowledge_graph format
		let knowledge_graph: Record<string, unknown> | undefined;
		if (data.infobox?.results?.[0]) {
			knowledge_graph = data.infobox.results[0];
		}

		return { organic_results, knowledge_graph };
	}

	async function googleMaps(
		query: string,
		location: string,
	): Promise<GoogleMapsResponse> {
		await throttle();
		const params = new URLSearchParams({
			q: `${query} ${location}`,
			count: "20",
		});
		const res = await fetch(`${BRAVE_LOCAL_URL}?${params}`, {
			headers: braveHeaders(config.apiKey),
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) {
			throw new Error(
				`Brave Local Search failed (${res.status}): ${await res.text()}`,
			);
		}
		const data = (await res.json()) as BraveLocalResponse;

		const local_results: MapsResult[] = (data.results ?? []).map((r) => {
			const addressParts = [
				r.address?.streetAddress,
				r.address?.addressLocality,
				r.address?.addressRegion,
				r.address?.postalCode,
			].filter(Boolean);

			return {
				title: r.title,
				address: addressParts.join(", "),
				gps_coordinates: r.coordinates,
				place_id: r.id,
				rating: r.rating?.ratingValue,
				reviews: r.rating?.ratingCount,
			};
		});

		return { local_results };
	}

	return { googleSearch, googleMaps };
}
