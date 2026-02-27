import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isExcluded } from "../lib/exclude-matcher";
import { stripCodeFences } from "../lib/parse-json";
import type { CachedSearchClient } from "../lib/search-cache";
import type { DiscoveredBrand } from "../types";

// NAICS code to human-readable description
const NAICS_DESCRIPTIONS: Record<string, string> = {
	"722513": "Limited-Service Restaurants",
	"722511": "Full-Service Restaurants",
	"722515": "Snack and Nonalcoholic Beverage Bars",
	"812111": "Barber Shops",
	"812112": "Beauty Salons",
	"812191": "Diet and Weight Reducing Centers",
	"561720": "Janitorial Services",
	"236118": "Residential Remodelers",
	"811111": "General Automotive Repair",
	"611691": "Exam Preparation and Tutoring",
	"721110": "Hotels and Motels",
	"453910": "Pet and Pet Supplies Stores",
	"713940": "Fitness and Recreational Sports Centers",
};

// Industry aliases for better search results — NAICS descriptions are often
// too formal for web search (e.g., "Limited-Service Restaurants" vs "QSR")
const NAICS_ALIASES: Record<string, string[]> = {
	"722513": ["quick service restaurant", "QSR", "fast casual", "fast food franchise"],
	"722511": ["full service restaurant", "casual dining", "sit-down restaurant franchise"],
	"722515": ["coffee shop", "juice bar", "smoothie franchise", "boba tea"],
	"812111": ["barber shop franchise", "men's grooming"],
	"812112": ["beauty salon franchise", "hair salon franchise"],
	"812191": ["weight loss franchise", "fitness nutrition"],
	"561720": ["commercial cleaning franchise", "janitorial franchise"],
	"236118": ["home remodeling franchise", "home improvement franchise"],
	"811111": ["auto repair franchise", "car service franchise"],
	"611691": ["tutoring franchise", "education franchise", "test prep franchise"],
	"721110": ["hotel franchise", "hospitality franchise", "lodging franchise"],
	"453910": ["pet store franchise", "pet supplies franchise"],
	"713940": ["gym franchise", "fitness studio", "boutique fitness franchise"],
};

interface PluginDeps {
	searchClient: CachedSearchClient;
	llm: (options: { system: string; message: string }) => Promise<string>;
	getLiveConfig?: () => { sampleCities?: string[]; excludeBrands?: string[] };
}

const PROMPT_PATH = resolve(import.meta.dir, "../prompts/franchise-parser.md");

// Approximate number of US cities with 50K+ population
const US_CITIES_FACTOR = 400;

// Check if a Maps result title fuzzy-matches the brand name
function isBrandMatch(resultTitle: string, brandName: string): boolean {
	const normalize = (s: string) => s.toLowerCase().replace(/[''`\u2018\u2019]/g, "");
	const title = normalize(resultTitle);
	const brand = normalize(brandName);
	// Direct inclusion: "Crunch Fitness - Midtown" matches "Crunch Fitness"
	if (title.includes(brand)) return true;
	// Brand words all appear in title (handles "Gold's Gym" vs "Golds Gym")
	const brandWords = brand.split(/\s+/).filter((w) => w.length > 2);
	if (brandWords.length > 0 && brandWords.every((w) => title.includes(w)))
		return true;
	// Token overlap fallback: if 2+ significant brand words match, accept
	if (brandWords.length >= 2) {
		const matchCount = brandWords.filter((w) => title.includes(w)).length;
		if (matchCount >= 2) return true;
	}
	return false;
}

/** Parse a location count string, handling commas, k/m suffixes, and decimals */
export function parseLocationCount(text: string): number {
	const cleaned = text.trim().toLowerCase();
	// Match patterns like "1,500", "1.2k", "20.5k", "1.5m", or plain "1500"
	const match = cleaned.match(/([\d,]+(?:\.\d+)?)\s*([km])?/);
	if (!match) return 0;
	const num = Number.parseFloat(match[1].replace(/,/g, ""));
	if (Number.isNaN(num)) return 0;
	const suffix = match[2];
	if (suffix === "k") return Math.round(num * 1_000);
	if (suffix === "m") return Math.round(num * 1_000_000);
	return Math.round(num);
}

/** Primary method: web search for location count + LLM extraction */
async function webSearchLocationCount(
	brand: string,
	searchClient: CachedSearchClient,
	llm: PluginDeps["llm"],
): Promise<{ count: number; methodology: string } | null> {
	const queries = [
		`"${brand}" "number of locations" OR "locations nationwide" OR "units open"`,
		`"${brand}" franchise "how many" locations`,
		`"${brand}" location count ${new Date().getFullYear()}`,
	];

	for (const query of queries) {
		try {
			const webResult = await searchClient.googleSearch(query);
			const snippets = (webResult.organic_results ?? [])
				.slice(0, 5)
				.map((r) => `${r.title}: ${r.snippet}`)
				.join("\n");

			if (!snippets) continue;

			const numText = (
				await llm({
					system:
						"Extract the requested number from the search results. Return ONLY a number (integer). If unclear, return 0.",
					message: `Extract the number of locations/units for "${brand}" from these search results. Return ONLY a number (integer). If unclear, return 0.\n\n${snippets}`,
				})
			).trim();
			const parsed = parseLocationCount(numText);
			if (parsed > 0) {
				return {
					count: parsed,
					methodology: `Web search extraction ("${brand}" location count from snippets)`,
				};
			}
		} catch {
			continue;
		}
	}
	return null;
}

/** Secondary method: Google Maps metro sampling to estimate location count */
async function mapsLocationEstimate(
	brand: string,
	sampleCities: string[],
	searchClient: CachedSearchClient,
): Promise<{ estimate: number; methodology: string } | null> {
	try {
		const cityCounts = await Promise.all(
			sampleCities.map(async (city) => {
				try {
					const mapsResult = await searchClient.googleMaps(brand, city);
					const totalResults = mapsResult.local_results?.length ?? 0;
					if (totalResults === 0) return -1; // API returned nothing — don't count
					const matched = (mapsResult.local_results ?? []).filter((r) =>
						isBrandMatch(r.title, brand),
					);
					console.log(
						`[icp-discovery] Maps sampling for "${brand}" in ${city}: ${matched.length}/${totalResults} results matched`,
					);
					return matched.length;
				} catch {
					return -1; // API error — don't count
				}
			}),
		);

		const validCounts = cityCounts.filter((c) => c >= 0);
		if (validCounts.length === 0) return null;
		const avgPerCity =
			validCounts.reduce((a, b) => a + b, 0) / validCounts.length;
		const saturationRatio = Math.min(avgPerCity / 20, 1.0);
		const estimate = Math.round(saturationRatio * US_CITIES_FACTOR);

		if (estimate === 0) return null;

		return {
			estimate,
			methodology: `Google Maps metro sampling x${sampleCities.length} cities, avg ${avgPerCity.toFixed(1)}/city, saturation ${(saturationRatio * 100).toFixed(0)}% x${US_CITIES_FACTOR} cities`,
		};
	} catch {
		return null;
	}
}

/** Tertiary method: ask the LLM directly for a location count estimate */
async function llmLocationEstimate(
	brand: string,
	llm: PluginDeps["llm"],
): Promise<{ count: number; methodology: string } | null> {
	try {
		const text = await llm({
			system: "You are a franchise industry analyst. Return ONLY an integer.",
			message: `How many US locations does "${brand}" have as of ${new Date().getFullYear()}? Return ONLY a number.`,
		});
		const parsed = parseLocationCount(text);
		if (parsed > 0) {
			return { count: parsed, methodology: "LLM estimate (unverified)" };
		}
		return null;
	} catch {
		return null;
	}
}

interface BrandMergeInfo {
	parentCompany: string;
	sisterBrands: string[];
}

/** Deduplicate sister brands owned by the same parent company */
async function deduplicateBrands(
	brands: string[],
	llm: PluginDeps["llm"],
): Promise<{ kept: string[]; mergeMap: Map<string, BrandMergeInfo> }> {
	const mergeMap = new Map<string, BrandMergeInfo>();
	if (brands.length < 2) return { kept: brands, mergeMap };

	try {
		const text = await llm({
			system:
				"You are a franchise industry analyst. Identify sister brands owned by the same parent company. Return ONLY a JSON array.",
			message: `Given this list of franchise brands, identify any that are sister brands owned by the same parent company. Return a JSON array where each entry is { "parentCompany": string, "brands": string[], "keepBrand": string }. The keepBrand should be the most well-known brand name. Only include entries where duplicates exist. If no duplicates, return [].\n\nBrands: ${JSON.stringify(brands)}`,
		});

		const parsed = JSON.parse(stripCodeFences(text.trim()));
		if (!Array.isArray(parsed)) return { kept: brands, mergeMap };

		const removedBrands = new Set<string>();
		const brandsLower = new Set(brands.map((b) => b.toLowerCase()));

		for (const group of parsed) {
			if (!group.keepBrand || !Array.isArray(group.brands) || group.brands.length < 2) continue;
			let keepBrand = group.keepBrand as string;

			// Validate keepBrand exists in the original list; if not, pick the
			// first brand from the group that IS in the input to avoid silently
			// dropping the entire group when the LLM hallucinates a parent name.
			if (!brandsLower.has(keepBrand.toLowerCase())) {
				const fallback = (group.brands as string[]).find((b) =>
					brandsLower.has(b.toLowerCase()),
				);
				if (!fallback) continue; // none of the group's brands are in the input
				keepBrand = fallback;
			}

			const sisters = (group.brands as string[]).filter(
				(b) => b.toLowerCase() !== keepBrand.toLowerCase(),
			);
			if (sisters.length === 0) continue;

			// Normalize key to lowercase so lookup in the handler matches
			mergeMap.set(keepBrand.toLowerCase(), {
				parentCompany: (group.parentCompany as string) || "",
				sisterBrands: sisters,
			});
			for (const sister of sisters) {
				removedBrands.add(sister.toLowerCase());
			}
			console.log(
				`[icp-discovery] Dedup: keeping "${keepBrand}" (${group.parentCompany}), merged: ${sisters.join(", ")}`,
			);
		}

		const kept = brands.filter((b) => !removedBrands.has(b.toLowerCase()));
		return { kept, mergeMap };
	} catch (err) {
		console.warn(
			`[icp-discovery] Dedup failed, keeping all brands: ${err instanceof Error ? err.message : String(err)}`,
		);
		return { kept: brands, mergeMap };
	}
}

export function createDiscoverFranchisesHandler(deps: PluginDeps) {
	const serpapi = deps.searchClient;
	const systemPrompt = readFileSync(PROMPT_PATH, "utf-8");

	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			// Read config live so web UI changes take effect without restart
			const liveConfig = deps.getLiveConfig?.() ?? {};

			const naicsCode = input.naicsCode as string;
			const minLocations = (input.minLocations as number) ?? 100;
			const naicsDescription = NAICS_DESCRIPTIONS[naicsCode] ?? naicsCode;

			// Step 1: Google Search for franchise brands in this industry
			// Use industry aliases when available for better search results
			const aliases = NAICS_ALIASES[naicsCode] ?? [];
			const searchTerms = aliases.length > 0
				? aliases.slice(0, 2).join(" OR ")
				: naicsDescription;

			const searchQueries = [
				`"top franchise brands" ${searchTerms}`,
				`"franchise 500" ${searchTerms} 2025`,
				`largest franchise companies ${searchTerms} locations`,
				`top ${searchTerms} franchise chains in the US`,
				`"emerging franchise" OR "fastest growing franchise" ${searchTerms}`,
				`"franchise directory" ${naicsDescription} -McDonald's -Subway -Starbucks`,
				`"regional franchise" OR "up and coming franchise" ${searchTerms} 2025`,
				`site:franchisedirect.com OR site:franchisegator.com ${naicsDescription}`,
			];

			const searchResults = await Promise.all(
				searchQueries.map(async (query) => {
					const result = await serpapi.googleSearch(query);
					return { query, results: result.organic_results ?? [] };
				}),
			);

			// Extract candidate brand names from search results
			const allSnippets = searchResults
				.flatMap((r) => r.results.map((o) => `${o.title}: ${o.snippet}`))
				.join("\n");

			// Step 2: Ask LLM to extract brand names from search results
			const extractionText = await deps.llm({
				system: systemPrompt,
				message: `Extract franchise brand names from these search results for NAICS ${naicsCode} (${naicsDescription}):\n\n${allSnippets}`,
			});

			let candidateBrands: string[];
			try {
				const parsed = JSON.parse(stripCodeFences(extractionText));
				if (Array.isArray(parsed)) {
					candidateBrands = parsed
						.map((b: { brandName: string }) => b.brandName)
						.filter(
							(name: string) => typeof name === "string" && name.length > 0,
						);
				} else {
					candidateBrands = [];
				}
			} catch {
				// Fallback: extract brand names — reject lines that look like prose
				candidateBrands = extractionText
					.split("\n")
					.map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
					.filter((line) => {
						if (!line || line.length > 60) return false;
						// Reject sentences (prose refusals, explanations)
						if (
							/^(I |The |This |These |No |Unfortunately|However|Note|Based)/i.test(
								line,
							)
						)
							return false;
						if (
							/\b(cannot|because|results|provided|search|extract)\b/i.test(line)
						)
							return false;
						return true;
					})
					.slice(0, 20);
			}

			// Filter out excluded brands before Maps sampling
			const excludeBrands = liveConfig.excludeBrands;
			if (excludeBrands?.length) {
				candidateBrands = candidateBrands.filter(
					(brand) => !isExcluded(brand, excludeBrands),
				);
			}

			// Deduplicate sister brands before expensive location estimation
			const { kept: dedupedBrands, mergeMap } = await deduplicateBrands(
				candidateBrands,
				deps.llm,
			);
			candidateBrands = dedupedBrands;

			if (candidateBrands.length === 0) {
				return {
					content: JSON.stringify(
						{
							naicsCode,
							naicsDescription,
							totalCandidates: 0,
							qualifiedBrands: 0,
							brands: [],
							allCandidates: [],
							note: `No franchise brands found for NAICS ${naicsCode} (${naicsDescription}). Search results may not contain relevant franchises for this industry.`,
						},
						null,
						2,
					),
				};
			}

			// Step 3: Estimate location counts (web search primary, Maps fallback)
			const defaultCities = [
				"New York",
				"Los Angeles",
				"Chicago",
				"Dallas",
				"Houston",
			];
			const sampleCities = liveConfig.sampleCities?.length
				? liveConfig.sampleCities
				: defaultCities;
			const allBrands: DiscoveredBrand[] = [];

			const MAX_BRANDS = 20;
			const BATCH_SIZE = 10;
			const brandsToProcess = candidateBrands.slice(0, MAX_BRANDS);

			for (let i = 0; i < brandsToProcess.length; i += BATCH_SIZE) {
				const batch = brandsToProcess.slice(i, i + BATCH_SIZE);
				const batchResults = await Promise.all(
					batch.map(async (brand) => {
						// Primary: web search extraction (fast, reliable)
						const webResult = await webSearchLocationCount(
							brand,
							serpapi,
							deps.llm,
						);
						if (webResult) {
							console.log(
								`[icp-discovery] "${brand}": ${webResult.count} locations (via web search)`,
							);
							return {
								brand,
								estimatedLocations: webResult.count,
								methodology: webResult.methodology,
							};
						}

						// Fallback: Maps metro sampling (slower, less reliable for chains)
						const mapsResult = await mapsLocationEstimate(
							brand,
							sampleCities,
							serpapi,
						);
						if (mapsResult) {
							console.log(
								`[icp-discovery] "${brand}": ${mapsResult.estimate} locations (via Maps sampling)`,
							);
							return {
								brand,
								estimatedLocations: mapsResult.estimate,
								methodology: mapsResult.methodology,
							};
						}

						// Tertiary: LLM knowledge estimate (least reliable)
						const llmResult = await llmLocationEstimate(brand, deps.llm);
						if (llmResult) {
							console.log(
								`[icp-discovery] "${brand}": ${llmResult.count} locations (via LLM estimate)`,
							);
							return {
								brand,
								estimatedLocations: llmResult.count,
								methodology: llmResult.methodology,
							};
						}

						console.log(
							`[icp-discovery] "${brand}": no location data from web, Maps, or LLM`,
						);
						return {
							brand,
							estimatedLocations: 0,
							methodology: "No data available",
						};
					}),
				);

				for (const { brand, estimatedLocations, methodology } of batchResults) {
					const merge = mergeMap.get(brand.toLowerCase());
					allBrands.push({
						name: brand,
						naicsCode,
						naicsDescription,
						estimatedLocations,
						locationMethodology: methodology,
						sources: searchResults.flatMap((r) =>
							r.results
								.filter((o) =>
									o.title.toLowerCase().includes(brand.toLowerCase()),
								)
								.map((o) => o.link),
						),
						...(merge && {
							parentCompany: merge.parentCompany,
							sisterBrands: merge.sisterBrands,
						}),
					});
				}
			}

			// Sort by estimated locations descending
			allBrands.sort((a, b) => b.estimatedLocations - a.estimatedLocations);

			const qualifiedBrands = allBrands.filter(
				(b) => b.estimatedLocations >= minLocations,
			);

			return {
				content: JSON.stringify(
					{
						naicsCode,
						naicsDescription,
						totalCandidates: candidateBrands.length,
						qualifiedBrands: qualifiedBrands.length,
						brands: qualifiedBrands,
						allCandidates: allBrands,
					},
					null,
					2,
				),
			};
		} catch (err) {
			return {
				content: `Error discovering franchises: ${err instanceof Error ? err.message : String(err)}`,
				is_error: true,
			};
		}
	};
}
