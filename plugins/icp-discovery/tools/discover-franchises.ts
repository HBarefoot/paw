import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { stripCodeFences } from "../lib/parse-json";
import type { SerpApiConfig } from "../lib/serpapi";
import { createSerpApiClient } from "../lib/serpapi";
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
	serpApiConfig: SerpApiConfig;
	anthropicApiKey: string;
}

const PROMPT_PATH = resolve(import.meta.dir, "../prompts/franchise-parser.md");

export function createDiscoverFranchisesHandler(deps: PluginDeps) {
	const serpapi = createSerpApiClient(deps.serpApiConfig);
	const claude = new Anthropic({ apiKey: deps.anthropicApiKey });
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
				candidateBrands = parsed.map((b: { brandName: string }) => b.brandName);
			} catch {
				// Fallback: extract brand names with a simpler approach
				candidateBrands = extractionText
					.split("\n")
					.filter((line) => line.trim().length > 0)
					.slice(0, 30);
			}

			// Step 3: Google Maps sampling for location counts
			const sampleCities = [
				"New York",
				"Los Angeles",
				"Chicago",
				"Dallas",
				"Miami",
			];
			const brands: DiscoveredBrand[] = [];

			for (const brand of candidateBrands.slice(0, 30)) {
				const cityCounts: number[] = [];

				for (const city of sampleCities) {
					try {
						const mapsResult = await serpapi.googleMaps(brand, city);
						cityCounts.push(mapsResult.local_results?.length ?? 0);
					} catch {
						cityCounts.push(0);
					}
				}

				const avgPerCity =
					cityCounts.reduce((a, b) => a + b, 0) / cityCounts.length;
				// Scale: avg per city * 200 (approximate US metro areas with franchise presence)
				// Cap per-city at 20 to avoid SerpApi result limit skewing
				const cappedAvg = Math.min(avgPerCity, 20);
				const estimatedLocations = Math.round(cappedAvg * 200);

				if (estimatedLocations >= minLocations) {
					brands.push({
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
			brands.sort((a, b) => b.estimatedLocations - a.estimatedLocations);

			return {
				content: JSON.stringify(
					{
						naicsCode,
						naicsDescription,
						totalCandidates: candidateBrands.length,
						qualifiedBrands: brands.length,
						brands,
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
