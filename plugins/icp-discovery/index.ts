import type { ToolDefinition } from "../../src/types/message";
import type { ChannelPlugin } from "../../src/types/plugin";
import { createDiscoverFranchisesHandler } from "./tools/discover-franchises";
import { createCachedSearchClient } from "./lib/search-cache";
import { createEnrichContactsHandler } from "./tools/enrich-contacts";
import { createEstimateRevenueHandler } from "./tools/estimate-revenue";
import { createExportResultsHandler } from "./tools/export-results";
import { createFilterIcpHandler } from "./tools/filter-icp";
import { createMapToHqHandler } from "./tools/map-to-hq";

interface PluginContext {
	bus: unknown;
	registerTools(tools: ToolDefinition[]): void;
	logger: {
		info(msg: string): void;
		warn(msg: string): void;
		error(msg: string): void;
		debug(msg: string): void;
	};
	config: Record<string, unknown>;
	store: {
		get(key: string): unknown | undefined;
		set(key: string, value: unknown): void;
		delete(key: string): void;
	};
}

export default class IcpDiscoveryPlugin implements ChannelPlugin {
	readonly name = "icp-discovery";
	private ctx: PluginContext | null = null;

	async register(ctx: PluginContext): Promise<void> {
		this.ctx = ctx;
		const config = ctx.config as Record<string, unknown>;

		// Resolve API keys from plugin config or environment
		const serpApiKey =
			(config.braveApiKey as string) || process.env.BRAVE_API_KEY || "";
		const hunterApiKey =
			(config.hunterApiKey as string) || process.env.HUNTER_API_KEY || "";
		const anthropicApiKey =
			(config.anthropicApiKey as string) || process.env.ANTHROPIC_API_KEY || "";

		if (!serpApiKey) {
			ctx.logger.warn(
				"BRAVE_API_KEY not configured — discover_franchises and map_to_hq will fail",
			);
		}
		if (!anthropicApiKey) {
			ctx.logger.warn(
				"ANTHROPIC_API_KEY not configured — LLM parsing tools will fail",
			);
		}
		if (!hunterApiKey) {
			ctx.logger.warn(
				"HUNTER_API_KEY not configured — enrich_contacts will fall back to LinkedIn search only",
			);
		}

		const searchClient = createCachedSearchClient(
			{ apiKey: serpApiKey },
			ctx.store,
		);
		const hunterConfig = { apiKey: hunterApiKey };

		const exportConfig = {
			strapiUrl: (config.strapiUrl as string) || process.env.STRAPI_URL || "",
			strapiToken:
				(config.strapiToken as string) || process.env.STRAPI_API_TOKEN || "",
			outputDir: (config.outputDir as string) || "./data",
		};

		// Create tool handlers with dependencies
		const discoverFranchises = createDiscoverFranchisesHandler({
			searchClient,
			anthropicApiKey,
		});
		const estimateRevenue = createEstimateRevenueHandler({
			searchClient,
			anthropicApiKey,
		});
		const filterIcp = createFilterIcpHandler(ctx.store);
		const mapToHq = createMapToHqHandler({ searchClient, anthropicApiKey });
		const enrichContacts = createEnrichContactsHandler({
			hunterConfig,
			searchClient,
		});
		const exportResults = createExportResultsHandler(ctx.store, exportConfig);

		const logCacheStats = (toolName: string) => {
			const { hits, misses } = searchClient.cacheStats;
			ctx.logger.info(
				`[${toolName}] Search cache: ${hits} hits, ${misses} misses`,
			);
		};

		// Wrap handlers to persist intermediate results in plugin store
		const wrappedDiscoverFranchises = async (
			input: Record<string, unknown>,
		) => {
			// Don't clear any store state here — filter_icp rebuilds qualified_companies
			// from discovered_brands + revenue_estimates each time it runs.
			// Clearing here would wipe data if the AI retries discover mid-pipeline.

			const result = await discoverFranchises(input);
			logCacheStats("discover_franchises");
			if (!result.is_error) {
				try {
					const parsed = JSON.parse(result.content);
					// Merge new brands with existing for multi-NAICS pipelines
					const existing =
						(ctx.store.get("discovered_brands") as unknown[]) ?? [];
					const toStore = parsed.allCandidates ?? parsed.brands ?? [];
					ctx.store.set("discovered_brands", [...existing, ...toStore]);
					ctx.logger.info(
						`Stored ${toStore.length} new brands (${existing.length} existing, ${existing.length + toStore.length} total). ${parsed.qualifiedBrands} met location threshold.`,
					);
				} catch {
					// Store result as-is if not JSON
				}
			}
			return result;
		};

		const wrappedEstimateRevenue = async (input: Record<string, unknown>) => {
			const result = await estimateRevenue(input);
			logCacheStats("estimate_revenue");
			if (!result.is_error) {
				try {
					const estimate = JSON.parse(result.content);
					// Append to stored revenue estimates
					const existing =
						(ctx.store.get("revenue_estimates") as unknown[]) ?? [];
					existing.push(estimate);
					ctx.store.set("revenue_estimates", existing);
					ctx.logger.info(
						`Stored revenue estimate for ${estimate.companyName} (${existing.length} total)`,
					);
				} catch {
					// Ignore parse errors
				}
			}
			return result;
		};

		const wrappedFilterIcp = async (input: Record<string, unknown>) => {
			const result = await filterIcp(input);
			if (!result.is_error) {
				try {
					const parsed = JSON.parse(result.content);
					if (parsed.companies) {
						ctx.store.set("qualified_companies", parsed.companies);
						ctx.logger.info(
							`Stored ${parsed.companies.length} qualified companies`,
						);
					}
				} catch {
					// Ignore
				}
			}
			return result;
		};

		const wrappedMapToHq = async (input: Record<string, unknown>) => {
			const result = await mapToHq(input);
			logCacheStats("map_to_hq");
			if (!result.is_error) {
				try {
					const hqData = JSON.parse(result.content);
					const companies =
						(ctx.store.get("qualified_companies") as Array<
							Record<string, unknown>
						>) ?? [];
					// Match on input name first (what the model passed), then output name
					const inputName = (input.companyName as string)?.toLowerCase();
					const outputName = hqData.companyName?.toLowerCase();
					const idx = companies.findIndex((c) => {
						const stored = (c.companyName as string)?.toLowerCase();
						if (!stored) return false;
						return (
							stored === inputName ||
							stored === outputName ||
							(inputName && stored.includes(inputName)) ||
							(inputName && inputName.includes(stored))
						);
					});
					if (idx >= 0) {
						companies[idx].hqAddress = hqData.hqAddress;
						companies[idx].hqCity = hqData.hqCity;
						companies[idx].hqState = hqData.hqState;
						companies[idx].hqDomain = hqData.hqDomain;
						companies[idx].hqPhone = hqData.hqPhone;
						ctx.store.set("qualified_companies", companies);
						ctx.logger.info(
							`Updated HQ data for ${companies[idx].companyName}`,
						);
					} else {
						ctx.logger.warn(
							`map_to_hq: no matching company in store for "${input.companyName}" (store has: ${companies.map((c) => c.companyName).join(", ")})`,
						);
					}
				} catch (err) {
					ctx.logger.warn(
						`map_to_hq wrapper failed to update store: ${err}`,
					);
				}
			}
			return result;
		};

		const wrappedEnrichContacts = async (input: Record<string, unknown>) => {
			const result = await enrichContacts(input);
			logCacheStats("enrich_contacts");
			if (!result.is_error) {
				try {
					const contactData = JSON.parse(result.content);
					const companies =
						(ctx.store.get("qualified_companies") as Array<
							Record<string, unknown>
						>) ?? [];
					// Match on input name/domain, output name/domain, or substring
					const inputName = (input.companyName as string)?.toLowerCase();
					const inputDomain = (input.domain as string)?.toLowerCase();
					const outputName = contactData.companyName?.toLowerCase();
					const outputDomain = contactData.domain?.toLowerCase();
					const idx = companies.findIndex((c) => {
						const storedName = (c.companyName as string)?.toLowerCase();
						const storedDomain = (c.hqDomain as string)?.toLowerCase();
						if (!storedName) return false;
						return (
							storedName === inputName ||
							storedName === outputName ||
							(storedDomain &&
								(storedDomain === inputDomain ||
									storedDomain === outputDomain)) ||
							(inputName && storedName.includes(inputName)) ||
							(inputName && inputName.includes(storedName))
						);
					});
					if (idx >= 0) {
						companies[idx].contacts = contactData.contacts ?? [];
						ctx.store.set("qualified_companies", companies);
						ctx.logger.info(
							`Updated contacts for ${companies[idx].companyName}`,
						);
					} else {
						ctx.logger.warn(
							`enrich_contacts: no matching company in store for "${input.companyName ?? input.domain}" (store has: ${companies.map((c) => `${c.companyName}/${c.hqDomain}`).join(", ")})`,
						);
					}
				} catch (err) {
					ctx.logger.warn(
						`enrich_contacts wrapper failed to update store: ${err}`,
					);
				}
			}
			return result;
		};

		// Register all tools
		ctx.registerTools([
			{
				name: "discover_franchises",
				description:
					"Discover franchise brands by NAICS code with location count estimates via Google Search + Maps sampling",
				plugin: "icp-discovery",
				input_schema: {
					type: "object",
					properties: {
						naicsCode: {
							type: "string",
							description:
								'NAICS code (e.g., "722513" for Limited-Service Restaurants)',
						},
						minLocations: {
							type: "number",
							description: "Minimum franchise locations to qualify",
							default: 100,
						},
					},
					required: ["naicsCode"],
				},
				handler: wrappedDiscoverFranchises,
			},
			{
				name: "estimate_revenue",
				description:
					"Estimate annual revenue via SEC EDGAR + web search + employee proxy triangulation with confidence scoring",
				plugin: "icp-discovery",
				input_schema: {
					type: "object",
					properties: {
						companyName: {
							type: "string",
							description: "Company or franchise brand name",
						},
					},
					required: ["companyName"],
				},
				handler: wrappedEstimateRevenue,
			},
			{
				name: "filter_icp",
				description:
					"Filter discovered companies against ICP criteria (revenue, locations, NAICS, exclusions)",
				plugin: "icp-discovery",
				input_schema: {
					type: "object",
					properties: {
						minRevenue: {
							type: "number",
							description: "Minimum annual revenue in dollars",
							default: 200_000_000,
						},
						minLocations: {
							type: "number",
							description: "Minimum franchise locations",
							default: 100,
						},
						excludeCompanies: {
							type: "array",
							items: { type: "string" },
							description: "Company names to exclude",
						},
					},
				},
				handler: wrappedFilterIcp,
			},
			{
				name: "map_to_hq",
				description:
					"Find corporate HQ address, domain, and phone for a franchise brand via Google Knowledge Panel",
				plugin: "icp-discovery",
				input_schema: {
					type: "object",
					properties: {
						companyName: {
							type: "string",
							description: "Company or franchise brand name",
						},
					},
					required: ["companyName"],
				},
				handler: wrappedMapToHq,
			},
			{
				name: "enrich_contacts",
				description:
					"Find VP Marketing / CMO contacts at a company HQ via Hunter.io domain search (pre-configured) with LinkedIn fallback. Call this for each qualified company BEFORE exporting.",
				plugin: "icp-discovery",
				input_schema: {
					type: "object",
					properties: {
						domain: {
							type: "string",
							description: 'Company HQ website domain (e.g., "wingstop.com")',
						},
						companyName: {
							type: "string",
							description: "Company name for fallback search",
						},
					},
					required: ["domain"],
				},
				handler: wrappedEnrichContacts,
			},
			{
				name: "export_results",
				description: "Export qualified ICP leads to CSV, JSON, or Strapi CMS",
				plugin: "icp-discovery",
				input_schema: {
					type: "object",
					properties: {
						format: {
							type: "string",
							enum: ["csv", "json", "strapi"],
							default: "csv",
						},
					},
				},
				handler: exportResults,
			},
		]);

		ctx.logger.info("ICP Discovery skill registered with 6 tools");
	}

	async start(): Promise<void> {
		this.ctx?.logger.info("ICP Discovery plugin ready");
	}

	async stop(): Promise<void> {
		// No background processes to clean up
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		const config = this.ctx?.config as Record<string, unknown> | undefined;
		const hasBraveApi = !!(
			(config?.braveApiKey as string) || process.env.BRAVE_API_KEY
		);

		if (!hasBraveApi) {
			return {
				ok: false,
				details: "Missing API key: BRAVE_API_KEY",
			};
		}

		return { ok: true, details: "Required API keys configured" };
	}
}
