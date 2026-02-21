import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { scoreConfidence } from "../lib/confidence";
import { stripCodeFences } from "../lib/parse-json";
import { searchEdgar } from "../lib/sec-edgar";
import type { SerpApiConfig } from "../lib/serpapi";
import { createSerpApiClient } from "../lib/serpapi";
import type { RevenueEstimate, RevenueSource } from "../types";

interface PluginDeps {
	serpApiConfig: SerpApiConfig;
	anthropicApiKey: string;
}

const PROMPT_PATH = resolve(
	import.meta.dir,
	"../prompts/revenue-synthesizer.md",
);

export function createEstimateRevenueHandler(deps: PluginDeps) {
	const serpapi = createSerpApiClient(deps.serpApiConfig);
	const claude = new Anthropic({ apiKey: deps.anthropicApiKey });
	const systemPrompt = readFileSync(PROMPT_PATH, "utf-8");

	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			const companyName = input.companyName as string;
			if (!companyName) {
				return { content: "Error: companyName is required", is_error: true };
			}

			const dataSources: string[] = [];

			// Step 1: SEC EDGAR search
			let edgarResults: string;
			try {
				const filings = await searchEdgar(companyName);
				if (filings.length > 0) {
					edgarResults = JSON.stringify(filings.slice(0, 5), null, 2);
					dataSources.push(`SEC EDGAR filings found: ${filings.length}`);
				} else {
					edgarResults = "No SEC filings found (likely private company)";
					dataSources.push("No SEC filings (private company)");
				}
			} catch {
				edgarResults = "SEC EDGAR search failed";
				dataSources.push("SEC EDGAR unavailable");
			}

			// Step 2: Web search for revenue data
			const revenueQueries = [
				`"${companyName}" annual revenue 2024 2025`,
				`"${companyName}" franchise disclosure document revenue`,
			];

			const webSnippets: string[] = [];
			for (const query of revenueQueries) {
				try {
					const result = await serpapi.googleSearch(query);
					const snippets = (result.organic_results ?? [])
						.slice(0, 5)
						.map((r) => `${r.title}: ${r.snippet} (${r.link})`);
					webSnippets.push(...snippets);
				} catch {
					// Continue with available data
				}
			}

			// Step 3: Employee count search for proxy
			let employeeData: string;
			try {
				const empResult = await serpapi.googleSearch(
					`"${companyName}" employees number of employees`,
				);
				employeeData = (empResult.organic_results ?? [])
					.slice(0, 3)
					.map((r) => `${r.title}: ${r.snippet}`)
					.join("\n");
				if (!employeeData) employeeData = "No employee data found";
			} catch {
				employeeData = "Employee search failed";
			}

			// Step 4: Send all data to Claude for synthesis
			const userMessage = `
Estimate revenue for: ${companyName}

SEC EDGAR Results:
${edgarResults}

Web Search Results:
${webSnippets.join("\n")}

Employee Data:
${employeeData}

Data sources consulted: ${dataSources.join(", ")}
`.trim();

			const response = await claude.messages.create({
				model: "claude-sonnet-4-5-20250929",
				max_tokens: 1024,
				system: systemPrompt,
				messages: [{ role: "user", content: userMessage }],
			});

			const responseText =
				response.content[0].type === "text" ? response.content[0].text : "";

			let estimate: RevenueEstimate;
			try {
				const parsed = JSON.parse(stripCodeFences(responseText));
				const sources: RevenueSource[] = (parsed.sources ?? []).map(
					(s: RevenueSource) => ({
						type: s.type,
						value: s.value,
						url: s.url,
						date: s.date,
					}),
				);

				// Apply our confidence scoring on top of LLM's assessment
				const calculatedConfidence = scoreConfidence(sources);

				estimate = {
					companyName,
					revenueLow: parsed.revenueLow ?? 0,
					revenueMid: parsed.revenueMid ?? 0,
					revenueHigh: parsed.revenueHigh ?? 0,
					confidence: calculatedConfidence,
					sources,
					reasoning: parsed.reasoning ?? "",
				};
			} catch {
				return {
					content: `Error parsing revenue estimate for ${companyName}. LLM response: ${responseText}`,
					is_error: true,
				};
			}

			return { content: JSON.stringify(estimate, null, 2) };
		} catch (err) {
			return {
				content: `Error estimating revenue: ${err instanceof Error ? err.message : String(err)}`,
				is_error: true,
			};
		}
	};
}
