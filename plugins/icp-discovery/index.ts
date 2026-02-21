import type { ToolDefinition } from "../../src/types/message";
import type { ChannelPlugin } from "../../src/types/plugin";
import { createDiscoverFranchisesHandler } from "./tools/discover-franchises";
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
			(config.serpApiKey as string) || process.env.SERP_API_KEY || "";
		const hunterApiKey =
			(config.hunterApiKey as string) || process.env.HUNTER_API_KEY || "";
		const anthropicApiKey =
			(config.anthropicApiKey as string) || process.env.ANTHROPIC_API_KEY || "";

		if (!serpApiKey) {
			ctx.logger.warn(
				"SERP_API_KEY not configured — discover_franchises and map_to_hq will fail",
			);
		}
		if (!anthropicApiKey) {
			ctx.logger.warn(
				"ANTHROPIC_API_KEY not configured — LLM parsing tools will fail",
			);
		}

		const serpApiConfig = { apiKey: serpApiKey };
		const hunterConfig = { apiKey: hunterApiKey };

		const exportConfig = {
			strapiUrl: (config.strapiUrl as string) || process.env.STRAPI_URL || "",
			strapiToken:
				(config.strapiToken as string) || process.env.STRAPI_API_TOKEN || "",
			outputDir: (config.outputDir as string) || "./data",
		};

		// Create tool handlers with dependencies
		const discoverFranchises = createDiscoverFranchisesHandler({
			serpApiConfig,
			anthropicApiKey,
		});
		const estimateRevenue = createEstimateRevenueHandler({
			serpApiConfig,
			anthropicApiKey,
		});
		const filterIcp = createFilterIcpHandler(ctx.store);
		const mapToHq = createMapToHqHandler({ serpApiConfig, anthropicApiKey });
		const enrichContacts = createEnrichContactsHandler({
			hunterConfig,
			serpApiConfig,
		});
		const exportResults = createExportResultsHandler(ctx.store, exportConfig);

		// Wrap handlers to persist intermediate results in plugin store
		const wrappedDiscoverFranchises = async (
			input: Record<string, unknown>,
		) => {
			const result = await discoverFranchises(input);
			if (!result.is_error) {
				try {
					const parsed = JSON.parse(result.content);
					if (parsed.brands) {
						ctx.store.set("discovered_brands", parsed.brands);
						ctx.logger.info(`Stored ${parsed.brands.length} discovered brands`);
					}
				} catch {
					// Store result as-is if not JSON
				}
			}
			return result;
		};

		const wrappedEstimateRevenue = async (input: Record<string, unknown>) => {
			const result = await estimateRevenue(input);
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
			if (!result.is_error) {
				try {
					const hqData = JSON.parse(result.content);
					// Update the matching qualified company in store
					const companies =
						(ctx.store.get("qualified_companies") as Array<
							Record<string, unknown>
						>) ?? [];
					const idx = companies.findIndex(
						(c) =>
							(c.companyName as string)?.toLowerCase() ===
							hqData.companyName?.toLowerCase(),
					);
					if (idx >= 0) {
						companies[idx].hqAddress = hqData.hqAddress;
						companies[idx].hqCity = hqData.hqCity;
						companies[idx].hqState = hqData.hqState;
						companies[idx].hqDomain = hqData.hqDomain;
						companies[idx].hqPhone = hqData.hqPhone;
						ctx.store.set("qualified_companies", companies);
					}
				} catch {
					// Ignore
				}
			}
			return result;
		};

		const wrappedEnrichContacts = async (input: Record<string, unknown>) => {
			const result = await enrichContacts(input);
			if (!result.is_error) {
				try {
					const contactData = JSON.parse(result.content);
					// Update the matching qualified company in store
					const companies =
						(ctx.store.get("qualified_companies") as Array<
							Record<string, unknown>
						>) ?? [];
					const idx = companies.findIndex(
						(c) =>
							(c.companyName as string)?.toLowerCase() ===
								contactData.companyName?.toLowerCase() ||
							(c.hqDomain as string)?.toLowerCase() ===
								contactData.domain?.toLowerCase(),
					);
					if (idx >= 0) {
						companies[idx].contacts = contactData.contacts ?? [];
						ctx.store.set("qualified_companies", companies);
					}
				} catch {
					// Ignore
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
					"Find VP Marketing / CMO contacts at a company HQ via Hunter.io domain search with LinkedIn fallback",
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
		const hasSerpApi = !!(
			(config?.serpApiKey as string) || process.env.SERP_API_KEY
		);

		if (!hasSerpApi) {
			return {
				ok: false,
				details: "Missing API key: SERP_API_KEY",
			};
		}

		return { ok: true, details: "Required API keys configured" };
	}
}
