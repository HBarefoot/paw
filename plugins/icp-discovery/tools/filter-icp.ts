import { isExcluded } from "../lib/exclude-matcher";
import type {
	DiscoveredBrand,
	QualifiedCompany,
	RevenueEstimate,
} from "../types";

interface PluginStore {
	get(key: string): unknown | undefined;
}

interface FilterIcpDeps {
	store: PluginStore;
	getLiveConfig?: () => { excludeBrands?: string[] };
}

export function createFilterIcpHandler(deps: FilterIcpDeps) {
	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			const minRevenue = (input.minRevenue as number) ?? 200_000_000;
			const minLocations = (input.minLocations as number) ?? 100;
			const excludeCompanies = (input.excludeCompanies as string[]) ?? [];

			// Merge config excludes (from web UI) with per-call excludes
			const liveConfig = deps.getLiveConfig?.() ?? {};
			const combinedExcludes = [
				...excludeCompanies,
				...(liveConfig.excludeBrands ?? []),
			];

			// Retrieve discovered brands and revenue estimates from plugin store
			const storedBrands = deps.store.get("discovered_brands") as
				| DiscoveredBrand[]
				| undefined;
			const storedRevenues = deps.store.get("revenue_estimates") as
				| RevenueEstimate[]
				| undefined;

			if (!storedBrands || storedBrands.length === 0) {
				return {
					content:
						"No discovered brands found in store. Run discover_franchises first.",
					is_error: true,
				};
			}

			if (!storedRevenues || storedRevenues.length === 0) {
				return {
					content:
						"No revenue estimates found in store. Run estimate_revenue for discovered brands first.",
					is_error: true,
				};
			}

			// Build revenue lookup by company name (case-insensitive)
			const revenueLookup = new Map<string, RevenueEstimate>();
			for (const rev of storedRevenues) {
				revenueLookup.set(rev.companyName.toLowerCase(), rev);
			}

			// Filter and join
			const qualified: QualifiedCompany[] = [];
			const filtered: Array<{ name: string; reason: string }> = [];

			for (const brand of storedBrands) {
				// Check exclusion list (substring matching)
				if (isExcluded(brand.name, combinedExcludes)) {
					filtered.push({ name: brand.name, reason: "excluded by config" });
					continue;
				}

				// Check location threshold
				if (brand.estimatedLocations < minLocations) {
					filtered.push({
						name: brand.name,
						reason: `locations ${brand.estimatedLocations} < ${minLocations}`,
					});
					continue;
				}

				// Find matching revenue estimate
				const nameKey = brand.name.toLowerCase();
				const revenue = revenueLookup.get(nameKey);
				if (!revenue) {
					filtered.push({
						name: brand.name,
						reason: "no revenue estimate available",
					});
					continue;
				}

				// Check revenue threshold
				if (revenue.revenueMid < minRevenue) {
					filtered.push({
						name: brand.name,
						reason: `revenue $${(revenue.revenueMid / 1_000_000).toFixed(0)}M < $${(minRevenue / 1_000_000).toFixed(0)}M`,
					});
					continue;
				}

				qualified.push({
					companyName: brand.name,
					naicsCode: brand.naicsCode,
					naicsDescription: brand.naicsDescription,
					estimatedLocations: brand.estimatedLocations,
					revenueEstimate: revenue,
					contacts: [],
					...(brand.parentCompany && { parentCompany: brand.parentCompany }),
					...(brand.sisterBrands?.length && { sisterBrands: brand.sisterBrands }),
				});
			}

			// Sort by revenue descending
			qualified.sort(
				(a, b) => b.revenueEstimate.revenueMid - a.revenueEstimate.revenueMid,
			);

			return {
				content: JSON.stringify(
					{
						totalBrands: storedBrands.length,
						totalWithRevenue: storedRevenues.length,
						qualified: qualified.length,
						filteredOut: filtered.length,
						criteria: { minRevenue, minLocations, excludeCompanies },
						companies: qualified,
						filteredDetails: filtered,
						nextSteps:
							"IMPORTANT: For each qualified company, call map_to_hq to get HQ address/domain, then enrich_contacts with the domain to get marketing contacts. Do this BEFORE calling export_results.",
					},
					null,
					2,
				),
			};
		} catch (err) {
			return {
				content: `Error filtering ICP: ${err instanceof Error ? err.message : String(err)}`,
				is_error: true,
			};
		}
	};
}
