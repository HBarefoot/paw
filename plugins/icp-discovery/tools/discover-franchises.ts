import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
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

interface PluginDeps {
	searchClient: CachedSearchClient;
	anthropicApiKey: string;
	getLiveConfig?: () => { sampleCities?: string[]; excludeBrands?: string[] };
}

const PROMPT_PATH = resolve(import.meta.dir, "../prompts/franchise-parser.md");

// Approximate number of US cities with 50K+ population
const US_CITIES_FACTOR = 400;

// Check if a Maps result title fuzzy-matches the brand name
function isBrandMatch(resultTitle: string, brandName: string): boolean {
	const title = resultTitle.toLowerCase();
	const brand = brandName.toLowerCase();
	// Direct inclusion: "Crunch Fitness - Midtown" matches "Crunch Fitness"
	if (title.includes(brand)) return true;
	// Brand words all appear in title (handles "Gold's Gym" vs "Golds Gym")
	const brandWords = brand.replace(/['']/g, "").split(/\s+/).filter(w => w.length > 2);
	const titleNorm = title.replace(/['']/g, "");
	if (brandWords.length > 0 && brandWords.every(w => titleNorm.includes(w))) return true;
	return false;
}

export function createDiscoverFranchisesHandler(deps: PluginDeps) {
	const serpapi = deps.searchClient;
	const claude = new Anthropic({ apiKey: deps.anthropicApiKey, timeout: 60_000 });
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
			const searchQueries = [
				`"top franchise brands" "${naicsDescription}"`,
				`"franchise 500" "${naicsDescription}" 2025`,
				`largest franchise companies ${naicsDescription} locations`,
				`top ${naicsDescription} franchise chains in the US`,
				`"emerging franchise" OR "fastest growing franchise" ${naicsDescription}`,
				`"franchise directory" ${naicsDescription} -McDonald's -Subway -Starbucks`,
				`"regional franchise" OR "up and coming franchise" ${naicsDescription} 2025`,
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

			// Step 2: Ask Claude to extract brand names from search results
			const extractionResponse = await claude.messages.create({
				model: "claude-sonnet-4-5-20250929",
				max_tokens: 2048,
				system: systemPrompt,
				messages: [
					{
						role: "user",
						content: `Extract franchise brand names from these search results for NAICS ${naicsCode} (${naicsDescription}):\n\n${allSnippets}`,
					},
				],
			});

			const extractionText =
				extractionResponse.content[0].type === "text"
					? extractionResponse.content[0].text
					: "";

			let candidateBrands: string[];
			try {
				const parsed = JSON.parse(stripCodeFences(extractionText));
				if (Array.isArray(parsed)) {
					candidateBrands = parsed
						.map((b: { brandName: string }) => b.brandName)
						.filter((name: string) => typeof name === "string" && name.length > 0);
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
						if (/^(I |The |This |These |No |Unfortunately|However|Note|Based)/i.test(line)) return false;
						if (/\b(cannot|because|results|provided|search|extract)\b/i.test(line)) return false;
						return true;
					})
					.slice(0, 20);
			}

			// Filter out excluded brands before Maps sampling
			if (liveConfig.excludeBrands?.length) {
				const excludeSet = new Set(liveConfig.excludeBrands.map((b) => b.toLowerCase()));
				candidateBrands = candidateBrands.filter(
					(brand) => !excludeSet.has(brand.toLowerCase()),
				);
			}

			if (candidateBrands.length === 0) {
				return {
					content: JSON.stringify({
						naicsCode,
						naicsDescription,
						totalCandidates: 0,
						qualifiedBrands: 0,
						brands: [],
						allCandidates: [],
						note: `No franchise brands found for NAICS ${naicsCode} (${naicsDescription}). Search results may not contain relevant franchises for this industry.`,
					}, null, 2),
				};
			}

			// Step 3: Google Maps sampling for location counts
			const defaultCities = [
				"New York",
				"Los Angeles",
				"Chicago",
				"Dallas",
				"Houston",
			];
			const sampleCities = liveConfig.sampleCities?.length ? liveConfig.sampleCities : defaultCities;
			const allBrands: DiscoveredBrand[] = [];

			const MAX_BRANDS = 20;
			const BATCH_SIZE = 10;
			const brandsToProcess = candidateBrands.slice(0, MAX_BRANDS);

			for (let i = 0; i < brandsToProcess.length; i += BATCH_SIZE) {
				const batch = brandsToProcess.slice(i, i + BATCH_SIZE);
				const batchResults = await Promise.all(
					batch.map(async (brand) => {
						const cityCounts = await Promise.all(
							sampleCities.map(async (city) => {
								try {
									const mapsResult = await serpapi.googleMaps(brand, city);
									const matched = (mapsResult.local_results ?? []).filter(
										(r) => isBrandMatch(r.title, brand),
									);
									console.log(
										`[icp-discovery] Maps sampling for "${brand}" in ${city}: ${matched.length}/${mapsResult.local_results?.length ?? 0} results matched`,
									);
									return matched.length;
								} catch {
									return 0;
								}
							}),
						);
						return { brand, cityCounts };
					}),
				);

				for (const { brand, cityCounts } of batchResults) {
					const avgPerCity =
						cityCounts.reduce((a, b) => a + b, 0) / cityCounts.length;
					// Saturation ratio: avg results / 20-result API cap
					const saturationRatio = Math.min(avgPerCity / 20, 1.0);
					let estimatedLocations = Math.round(saturationRatio * US_CITIES_FACTOR);
					let methodology = `Google Maps metro sampling x${sampleCities.length} cities, avg ${avgPerCity.toFixed(1)}/city, saturation ${(saturationRatio * 100).toFixed(0)}% x${US_CITIES_FACTOR} cities`;

					// Fallback: if Maps returned 0 matches, try web search for location count
					if (estimatedLocations === 0) {
						try {
							const webResult = await serpapi.googleSearch(
								`"${brand}" "number of locations" OR "locations nationwide" OR "units open" OR "locations across"`,
							);
							const snippets = (webResult.organic_results ?? [])
								.slice(0, 5)
								.map((r) => `${r.title}: ${r.snippet}`)
								.join("\n");

							if (snippets) {
								const fallbackResponse = await claude.messages.create({
									model: "claude-sonnet-4-5-20250929",
									max_tokens: 128,
									messages: [
										{
											role: "user",
											content: `Extract the number of locations/units for "${brand}" from these search results. Return ONLY a number (integer). If unclear, return 0.\n\n${snippets}`,
										},
									],
								});
								const numText =
									fallbackResponse.content[0].type === "text"
										? fallbackResponse.content[0].text.trim()
										: "0";
								const parsed = Number.parseInt(numText.replace(/[^0-9]/g, ""), 10);
								if (parsed > 0) {
									estimatedLocations = parsed;
									methodology = `Web search extraction ("${brand}" location count from snippets)`;
									console.log(
										`[icp-discovery] Web fallback for "${brand}": ${estimatedLocations} locations`,
									);
								}
							}
						} catch {
							// Web fallback failed, leave at 0
						}
					}

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
