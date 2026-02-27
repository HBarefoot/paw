import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isExcluded } from "../lib/exclude-matcher";
import { stripCodeFences } from "../lib/parse-json";
import type { CachedSearchClient } from "../lib/search-cache";

interface PluginDeps {
	searchClient: CachedSearchClient;
	llm: (options: { system: string; message: string }) => Promise<string>;
	getLiveConfig?: () => { excludeBrands?: string[] };
}

interface HqData {
	hqAddress: string | null;
	hqCity: string | null;
	hqState: string | null;
	hqDomain: string | null;
	hqPhone: string | null;
	domainInferred?: boolean;
}

const isAllNull = (data: HqData): boolean =>
	!data.hqAddress && !data.hqCity && !data.hqState && !data.hqDomain && !data.hqPhone;

const PROMPT_PATH = resolve(import.meta.dir, "../prompts/hq-extractor.md");

export function createMapToHqHandler(deps: PluginDeps) {
	const serpapi = deps.searchClient;
	const systemPrompt = readFileSync(PROMPT_PATH, "utf-8");

	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			const companyName = input.companyName as string;
			if (!companyName) {
				return { content: "Error: companyName is required", is_error: true };
			}

			const excludeBrands = deps.getLiveConfig?.()?.excludeBrands ?? [];
			if (isExcluded(companyName, excludeBrands)) {
				return { content: `Skipped: ${companyName} is in the exclude list` };
			}

			// Step 0: Simple query to trigger Google Knowledge Panel
			let knowledgeGraph = "No Knowledge Graph data available";
			try {
				const kgSearch = await serpapi.googleSearch(companyName);
				if (kgSearch.knowledge_graph) {
					knowledgeGraph = JSON.stringify(kgSearch.knowledge_graph, null, 2);
				}
			} catch { /* tolerate */ }

			// Step 1: Google Search for HQ address (tolerate timeout)
			let organicResults = "";
			try {
				const searchResult = await serpapi.googleSearch(
					`"${companyName}" corporate headquarters address`,
				);
				organicResults = (searchResult.organic_results ?? [])
					.slice(0, 5)
					.map((r) => `${r.title}: ${r.snippet} (${r.link})`)
					.join("\n");
				// Merge Knowledge Graph if we didn't get one from Step 0
				if (knowledgeGraph === "No Knowledge Graph data available" && searchResult.knowledge_graph) {
					knowledgeGraph = JSON.stringify(searchResult.knowledge_graph, null, 2);
				}
			} catch (searchErr) {
				organicResults = `Web search failed: ${searchErr instanceof Error ? searchErr.message : String(searchErr)}`;
			}

			// Step 2: Fallback Maps search (tolerate timeout)
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

			const responseText = await deps.llm({
				system: systemPrompt,
				message: userMessage,
			});

			let hqData: HqData;
			try {
				hqData = JSON.parse(stripCodeFences(responseText));
			} catch {
				return {
					content: `Error parsing HQ data for ${companyName}. LLM response: ${responseText}`,
					is_error: true,
				};
			}

			// Retry with alternative queries if all HQ fields are null
			if (isAllNull(hqData)) {
				const retryQueries = [
					`"${companyName}" headquarters location address`,
					`"${companyName}" franchise corporate office location`,
					`"${companyName}" corporate office address site:linkedin.com`,
					`"${companyName}" headquarters ${new Date().getFullYear()}`,
					`"${companyName}" parent company headquarters`,
					`site:bloomberg.com OR site:crunchbase.com "${companyName}" headquarters`,
				];
				for (const query of retryQueries) {
					try {
						const retrySearch = await serpapi.googleSearch(query);
						const retrySnippets = (retrySearch.organic_results ?? [])
							.slice(0, 5)
							.map((r) => `${r.title}: ${r.snippet} (${r.link})`)
							.join("\n");
						const retryKg = retrySearch.knowledge_graph
							? JSON.stringify(retrySearch.knowledge_graph, null, 2)
							: "No Knowledge Graph data available";

						const retryMessage = `
Extract HQ data for: ${companyName}

Google Knowledge Graph:
${retryKg}

Google Search Results:
${retrySnippets}
`.trim();

						const retryText = await deps.llm({
							system: systemPrompt,
							message: retryMessage,
						});
						try {
							const retryData: HqData = JSON.parse(stripCodeFences(retryText));
							if (!isAllNull(retryData)) {
								hqData = retryData;
								break;
							}
						} catch {
							// Parse failed on retry, continue to next query
						}
					} catch {
						// Search failed on retry, continue to next query
					}
				}
			}

			// Wikipedia/Crunchbase fallback if still all null
			if (isAllNull(hqData)) {
				const fallbackQueries = [
					`"${companyName}" site:en.wikipedia.org`,
					`"${companyName}" site:crunchbase.com/organization`,
				];
				const fallbackSnippets: string[] = [];
				for (const query of fallbackQueries) {
					try {
						const result = await serpapi.googleSearch(query);
						for (const r of (result.organic_results ?? []).slice(0, 3)) {
							fallbackSnippets.push(`${r.title}: ${r.snippet} (${r.link})`);
						}
					} catch { /* tolerate */ }
				}
				if (fallbackSnippets.length > 0) {
					try {
						const fallbackText = await deps.llm({
							system: systemPrompt,
							message: `
Extract HQ data for: ${companyName}

Wikipedia / Crunchbase Results:
${fallbackSnippets.join("\n")}
`.trim(),
						});
						const fallbackData: HqData = JSON.parse(stripCodeFences(fallbackText));
						if (!isAllNull(fallbackData)) {
							hqData = fallbackData;
						}
					} catch { /* parse/LLM failed */ }
				}
			}

			// Domain inference fallback if hqDomain is still null
			if (!hqData.hqDomain) {
				const candidate = companyName
					.toLowerCase()
					.replace(/[^a-z0-9]/g, "") + ".com";
				try {
					const res = await fetch(`https://${candidate}`, {
						method: "HEAD",
						redirect: "follow",
						signal: AbortSignal.timeout(5000),
					});
					if (res.ok || (res.status >= 300 && res.status < 400)) {
						hqData.hqDomain = candidate;
						hqData.domainInferred = true;
						console.log(`[icp-discovery] Inferred domain for "${companyName}": ${candidate}`);
					}
				} catch {
					// HEAD request failed, domain likely doesn't exist
				}
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
