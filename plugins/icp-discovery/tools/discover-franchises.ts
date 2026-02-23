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
};

interface PluginDeps {
	searchClient: CachedSearchClient;
	anthropicApiKey: string;
}

const PROMPT_PATH = resolve(import.meta.dir, "../prompts/franchise-parser.md");

export function createDiscoverFranchisesHandler(deps: PluginDeps) {
	const serpapi = deps.searchClient;
	const claude = new Anthropic({ apiKey: deps.anthropicApiKey, timeout: 60_000 });
	const systemPrompt = readFileSync(PROMPT_PATH, "utf-8");

	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			const naicsCode = input.naicsCode as string;
			const minLocations = (input.minLocations as number) ?? 100;
			const naicsDescription = NAICS_DESCRIPTIONS[naicsCode] ?? naicsCode;

			// Step 1: Google Search for franchise brands in this industry
			const searchQueries = [
				`"top franchise brands" "${naicsDescription}"`,
				`"franchise 500" "${naicsDescription}" 2025`,
				`largest franchise companies ${naicsDescription} locations`,
				`top ${naicsDescription} franchise chains in the US`,
			];

			const searchResults = [];
			for (const query of searchQueries) {
				const result = await serpapi.googleSearch(query);
				searchResults.push({ query, results: result.organic_results ?? [] });
			}

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
			const sampleCities = [
				"New York",
				"Los Angeles",
				"Chicago",
				"Dallas",
			];
			const allBrands: DiscoveredBrand[] = [];

			const MAX_BRANDS = 20;
			const BATCH_SIZE = 5;
			const brandsToProcess = candidateBrands.slice(0, MAX_BRANDS);

			for (let i = 0; i < brandsToProcess.length; i += BATCH_SIZE) {
				const batch = brandsToProcess.slice(i, i + BATCH_SIZE);
				const batchResults = await Promise.all(
					batch.map(async (brand) => {
						const cityCounts: number[] = [];
						for (const city of sampleCities) {
							try {
								const mapsResult = await serpapi.googleMaps(brand, city);
								cityCounts.push(mapsResult.local_results?.length ?? 0);
							} catch {
								cityCounts.push(0);
							}
						}
						return { brand, cityCounts };
					}),
				);

				for (const { brand, cityCounts } of batchResults) {
					const avgPerCity =
						cityCounts.reduce((a, b) => a + b, 0) / cityCounts.length;
					// Scale: avg per city * 200 (approximate US metro areas with franchise presence)
					// Cap per-city at 20 to avoid SerpApi result limit skewing
					const cappedAvg = Math.min(avgPerCity, 20);
					const estimatedLocations = Math.round(cappedAvg * 200);

					allBrands.push({
						name: brand,
						naicsCode,
						naicsDescription,
						estimatedLocations,
						locationMethodology: `Google Maps metro sampling x${sampleCities.length} cities, avg ${cappedAvg.toFixed(1)} per city x200 metros`,
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
