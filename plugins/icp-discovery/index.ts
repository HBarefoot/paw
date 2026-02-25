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

		// Config is a live proxy — reads fresh overrides on each access,
		// so web UI changes take effect without a restart.
		const getLiveConfig = () => ({
			sampleCities: Array.isArray(config.sampleCities)
				? (config.sampleCities as string[]).filter((c) => typeof c === "string" && c.trim())
				: undefined,
			excludeBrands: Array.isArray(config.excludeBrands)
				? (config.excludeBrands as string[]).filter((b) => typeof b === "string" && b.trim())
				: undefined,
		});

		// Create tool handlers with dependencies
		const discoverFranchises = createDiscoverFranchisesHandler({
			searchClient,
			anthropicApiKey,
			getLiveConfig,
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

		// Deduplicate qualified_companies by company name (keeps first/most complete entry)
		const dedupeCompanies = (
			companies: Array<Record<string, unknown>>,
		): Array<Record<string, unknown>> => {
			const seen = new Map<string, number>();
			for (let i = 0; i < companies.length; i++) {
				const name = (companies[i].companyName as string)?.toLowerCase();
				if (!name) continue;
				if (seen.has(name)) {
					// Merge: copy non-null fields from duplicate into the first entry
					const firstIdx = seen.get(name)!;
					for (const [key, val] of Object.entries(companies[i])) {
						if (!val) continue;
						const existing = companies[firstIdx][key];
						// Prefer non-empty objects (e.g. revenueEstimate with actual data)
						if (!existing || (typeof existing === "object" && Object.keys(existing as object).length === 0)) {
							companies[firstIdx][key] = val;
						}
					}
					companies.splice(i, 1);
					i--;
				} else {
					seen.set(name, i);
				}
			}
			return companies;
		};

		// Look up brand defaults from discovered_brands for stub entries
		const lookupBrandDefaults = (brandName: string) => {
			const brands = (ctx.store.get("discovered_brands") as Array<Record<string, unknown>>) ?? [];
			const match = brands.find(
				(b) => (b.name as string)?.toLowerCase() === brandName?.toLowerCase(),
			);
			return {
				naicsCode: (match?.naicsCode as string) || "",
				naicsDescription: (match?.naicsDescription as string) || "",
				estimatedLocations: (match?.estimatedLocations as number) || 0,
			};
		};

		// Wrap handlers to persist intermediate results in plugin store
		const wrappedDiscoverFranchises = async (
			input: Record<string, unknown>,
		) => {
			// Clear previous pipeline data to prevent cross-run contamination.
			// Multi-NAICS still works because the AI calls discover_franchises once
			// per NAICS within the same run, and merge logic accumulates brands.
			ctx.store.delete("discovered_brands");
			ctx.store.delete("revenue_estimates");
			ctx.store.delete("qualified_companies");

			const result = await discoverFranchises(input);
			logCacheStats("discover_franchises");
			if (!result.is_error) {
				try {
					const parsed = JSON.parse(result.content);
					// Merge new brands with existing for multi-NAICS pipelines
					const existing =
						(ctx.store.get("discovered_brands") as Array<{ name?: string }>) ?? [];
					const toStore = parsed.allCandidates ?? parsed.brands ?? [];
					// Filter out invalid entries (e.g. prose refusals stored by older code)
					const isValidBrand = (b: { name?: string }) =>
						b.name && b.name.length <= 60 && !/\b(cannot|because|extract|provided|results)\b/i.test(b.name);
					const cleaned = [...existing.filter(isValidBrand), ...toStore];
					ctx.store.set("discovered_brands", cleaned);
					const removed = existing.length - (cleaned.length - toStore.length);
					ctx.logger.info(
						`Stored ${toStore.length} new brands (${cleaned.length} total${removed > 0 ? `, removed ${removed} invalid` : ""}). ${parsed.qualifiedBrands} met location threshold.`,
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
					// Also update qualified_companies with revenue data so it's
					// available even when AI bypasses filter_icp
					const companies = (ctx.store.get("qualified_companies") as Array<Record<string, unknown>>) ?? [];
					const brandName = estimate.companyName as string;
					const compIdx = companies.findIndex(c => (c.companyName as string)?.toLowerCase() === brandName?.toLowerCase());
					if (compIdx >= 0) {
						companies[compIdx].revenueEstimate = estimate;
					} else {
						const defaults = lookupBrandDefaults(brandName);
						companies.push({
							companyName: brandName,
							naicsCode: defaults.naicsCode,
							naicsDescription: defaults.naicsDescription,
							estimatedLocations: defaults.estimatedLocations,
							revenueEstimate: estimate,
							contacts: [],
						});
					}
					dedupeCompanies(companies);
					ctx.store.set("qualified_companies", companies);

					// Auto-register brand in discovered_brands if not already there
					// so filter_icp works even when AI bypasses discover_franchises
					const brands =
						(ctx.store.get("discovered_brands") as Array<Record<string, unknown>>) ?? [];
					if (
						brandName &&
						!brands.some(
							(b) => (b.name as string)?.toLowerCase() === brandName.toLowerCase(),
						)
					) {
						brands.push({
							name: brandName,
							naicsCode: "",
							naicsDescription: "",
							estimatedLocations: 0,
							sources: [],
						});
						ctx.store.set("discovered_brands", brands);
					}
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
					if (parsed.companies && parsed.companies.length > 0) {
						// Merge with existing qualified_companies to preserve
						// revenue/HQ/contact data written by earlier pipeline steps
						const existing = (ctx.store.get("qualified_companies") as Array<Record<string, unknown>>) ?? [];
						const merged = [...parsed.companies] as Array<Record<string, unknown>>;
						for (const entry of existing) {
							const name = (entry.companyName as string)?.toLowerCase();
							if (!name) continue;
							const idx = merged.findIndex(c => (c.companyName as string)?.toLowerCase() === name);
							if (idx >= 0) {
								// Merge existing data (revenue, HQ, contacts) into filter result
								for (const [key, val] of Object.entries(entry)) {
									if (!val) continue;
									const cur = merged[idx][key];
									if (!cur || (typeof cur === "object" && Object.keys(cur as object).length === 0)) {
										merged[idx][key] = val;
									}
								}
							}
						}
						dedupeCompanies(merged);
						ctx.store.set("qualified_companies", merged);
						ctx.logger.info(
							`Stored ${merged.length} qualified companies`,
						);
					} else {
						ctx.logger.info(
							"filter_icp returned 0 companies — keeping existing qualified_companies",
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
						// Only overwrite with non-null values to avoid clobbering good data
						if (hqData.hqAddress) companies[idx].hqAddress = hqData.hqAddress;
						if (hqData.hqCity) companies[idx].hqCity = hqData.hqCity;
						if (hqData.hqState) companies[idx].hqState = hqData.hqState;
						if (hqData.hqDomain) companies[idx].hqDomain = hqData.hqDomain;
						if (hqData.hqPhone) companies[idx].hqPhone = hqData.hqPhone;
						ctx.store.set("qualified_companies", companies);
						ctx.logger.info(
							`Updated HQ data for ${companies[idx].companyName}`,
						);
					} else {
						// Create new entry so data isn't lost when AI bypasses filter_icp
						const mapBrandName = (hqData.companyName || input.companyName) as string;
						const defaults = lookupBrandDefaults(mapBrandName);
						companies.push({
							companyName: mapBrandName,
							naicsCode: defaults.naicsCode,
							naicsDescription: defaults.naicsDescription,
							estimatedLocations: defaults.estimatedLocations,
							revenueEstimate: {},
							contacts: [],
							hqAddress: hqData.hqAddress,
							hqCity: hqData.hqCity,
							hqState: hqData.hqState,
							hqDomain: hqData.hqDomain,
							hqPhone: hqData.hqPhone,
						});
						dedupeCompanies(companies);
						ctx.store.set("qualified_companies", companies);
						ctx.logger.info(
							`Created new store entry with HQ data for ${input.companyName}`,
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
						// Create new entry so data isn't lost when AI bypasses filter_icp
						const contactBrandName = (contactData.companyName || input.companyName || input.domain) as string;
						const defaults = lookupBrandDefaults(contactBrandName);
						companies.push({
							companyName: contactBrandName,
							naicsCode: defaults.naicsCode,
							naicsDescription: defaults.naicsDescription,
							estimatedLocations: defaults.estimatedLocations,
							revenueEstimate: {},
							contacts: contactData.contacts ?? [],
							hqDomain:
								contactData.domain ||
								(input.domain as string) ||
								"",
						});
						dedupeCompanies(companies);
						ctx.store.set("qualified_companies", companies);
						ctx.logger.info(
							`Created new store entry with contacts for ${input.companyName ?? input.domain}`,
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
