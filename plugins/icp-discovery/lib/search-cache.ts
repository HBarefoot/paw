import { createHash } from "node:crypto";
import type { SerpApiConfig, SearchClient } from "./serpapi";
import { createSerpApiClient } from "./serpapi";

interface PluginStore {
	get(key: string): unknown | undefined;
	set(key: string, value: unknown): void;
}

interface CacheEntry {
	data: unknown;
	cachedAt: string;
}

interface CacheStats {
	hits: number;
	misses: number;
}

export type CachedSearchClient = SearchClient & { cacheStats: CacheStats };

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function isExpired(entry: CacheEntry, ttlDays: number): boolean {
	const age = Date.now() - new Date(entry.cachedAt).getTime();
	return age > ttlDays * 86_400_000;
}

export function createCachedSearchClient(
	config: SerpApiConfig,
	store: PluginStore,
	ttlDays: { web?: number; maps?: number } = {},
): CachedSearchClient {
	const inner = createSerpApiClient(config);
	const webTtl = ttlDays.web ?? 7;
	const mapsTtl = ttlDays.maps ?? 30;
	const stats: CacheStats = { hits: 0, misses: 0 };

	async function googleSearch(
		...args: Parameters<SearchClient["googleSearch"]>
	): ReturnType<SearchClient["googleSearch"]> {
		const [query] = args;
		const key = `search:web:${sha256(query)}`;
		const cached = store.get(key) as CacheEntry | undefined;

		if (cached && !isExpired(cached, webTtl)) {
			stats.hits++;
			return cached.data as Awaited<ReturnType<SearchClient["googleSearch"]>>;
		}

		const data = await inner.googleSearch(query);
		store.set(key, { data, cachedAt: new Date().toISOString() });
		stats.misses++;
		return data;
	}

	async function googleMaps(
		...args: Parameters<SearchClient["googleMaps"]>
	): ReturnType<SearchClient["googleMaps"]> {
		const [query, location] = args;
		const key = `search:maps:${sha256(query + location)}`;
		const cached = store.get(key) as CacheEntry | undefined;

		if (cached && !isExpired(cached, mapsTtl)) {
			stats.hits++;
			return cached.data as Awaited<ReturnType<SearchClient["googleMaps"]>>;
		}

		const data = await inner.googleMaps(query, location);
		store.set(key, { data, cachedAt: new Date().toISOString() });
		stats.misses++;
		return data;
	}

	return { googleSearch, googleMaps, cacheStats: stats };
}
