import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { stripCodeFences } from "../lib/parse-json";
import type { SerpApiConfig } from "../lib/serpapi";
import { createSerpApiClient } from "../lib/serpapi";

interface PluginDeps {
	serpApiConfig: SerpApiConfig;
	anthropicApiKey: string;
}

interface HqData {
	hqAddress: string | null;
	hqCity: string | null;
	hqState: string | null;
	hqDomain: string | null;
	hqPhone: string | null;
}

const PROMPT_PATH = resolve(import.meta.dir, "../prompts/hq-extractor.md");

export function createMapToHqHandler(deps: PluginDeps) {
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

			// Step 1: Google Search for HQ address
			const searchResult = await serpapi.googleSearch(
				`"${companyName}" corporate headquarters address`,
			);

			const organicResults = (searchResult.organic_results ?? [])
				.slice(0, 5)
				.map((r) => `${r.title}: ${r.snippet} (${r.link})`)
				.join("\n");

			const knowledgeGraph = searchResult.knowledge_graph
				? JSON.stringify(searchResult.knowledge_graph, null, 2)
				: "No Knowledge Graph data available";

			// Step 2: Fallback Maps search
			let mapsData = "";
			try {
				const mapsResult = await serpapi.googleMaps(
					`"${companyName}" corporate office`,
					"",
				);
				if (mapsResult.local_results?.length) {
					mapsData = JSON.stringify(
						mapsResult.local_results.slice(0, 3),
						null,
						2,
					);
				}
			} catch {
				mapsData = "Maps search unavailable";
			}

			// Step 3: Claude extraction
			const userMessage = `
Extract HQ data for: ${companyName}

Google Knowledge Graph:
${knowledgeGraph}

Google Search Results:
${organicResults}

Google Maps Results:
${mapsData}
`.trim();

			const response = await claude.messages.create({
				model: "claude-sonnet-4-5-20250929",
				max_tokens: 512,
				system: systemPrompt,
				messages: [{ role: "user", content: userMessage }],
			});

			const responseText =
				response.content[0].type === "text" ? response.content[0].text : "";

			let hqData: HqData;
			try {
				hqData = JSON.parse(stripCodeFences(responseText));
			} catch {
				return {
					content: `Error parsing HQ data for ${companyName}. LLM response: ${responseText}`,
					is_error: true,
				};
			}

			return {
				content: JSON.stringify({ companyName, ...hqData }, null, 2),
			};
		} catch (err) {
			return {
				content: `Error mapping HQ: ${err instanceof Error ? err.message : String(err)}`,
				is_error: true,
			};
		}
	};
}
