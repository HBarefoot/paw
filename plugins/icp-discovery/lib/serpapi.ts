const BASE_URL = "https://serpapi.com/search.json";
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

export function createSerpApiClient(config: SerpApiConfig) {
	async function googleSearch(query: string): Promise<GoogleSearchResponse> {
		await throttle();
		const params = new URLSearchParams({
			engine: "google",
			api_key: config.apiKey,
			q: query,
			num: "10",
		});
		const res = await fetch(`${BASE_URL}?${params}`);
		if (!res.ok) {
			throw new Error(
				`SerpApi Google Search failed (${res.status}): ${await res.text()}`,
			);
		}
		return res.json() as Promise<GoogleSearchResponse>;
	}

	async function googleMaps(
		query: string,
		location: string,
	): Promise<GoogleMapsResponse> {
		await throttle();
		const params = new URLSearchParams({
			engine: "google_maps",
			api_key: config.apiKey,
			q: query,
			ll: "", // let SerpApi resolve from location text
			type: "search",
		});
		// Use location as a text parameter for Google Maps
		params.set("q", `${query} ${location}`);
		const res = await fetch(`${BASE_URL}?${params}`);
		if (!res.ok) {
			throw new Error(
				`SerpApi Maps Search failed (${res.status}): ${await res.text()}`,
			);
		}
		return res.json() as Promise<GoogleMapsResponse>;
	}

	return { googleSearch, googleMaps };
}
