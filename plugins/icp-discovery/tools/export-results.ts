import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QualifiedCompany } from "../types";

interface PluginStore {
	get(key: string): unknown | undefined;
}

interface ExportConfig {
	strapiUrl?: string;
	strapiToken?: string;
	outputDir?: string;
}

function flattenCompany(
	company: QualifiedCompany,
	runId: string,
): Record<string, unknown> {
	const bestContact = company.contacts[0];
	return {
		companyName: company.companyName,
		naicsCode: company.naicsCode,
		naicsDescription: company.naicsDescription ?? "",
		estimatedLocations: company.estimatedLocations,
		locationMethodology: "Google Maps metro sampling",
		estimatedRevenueLow: company.revenueEstimate.revenueLow,
		estimatedRevenueMid: company.revenueEstimate.revenueMid,
		estimatedRevenueHigh: company.revenueEstimate.revenueHigh,
		revenueConfidence: (
			company.revenueEstimate.confidence || "LOW"
		).toUpperCase(),
		revenueSources: JSON.stringify(company.revenueEstimate.sources),
		revenueReasoning: company.revenueEstimate.reasoning,
		hqAddress: company.hqAddress ?? "",
		hqCity: company.hqCity ?? "",
		hqState: company.hqState ?? "",
		hqDomain: company.hqDomain ?? "",
		hqPhone: company.hqPhone ?? "",
		contactName: bestContact?.name || null,
		contactTitle: bestContact?.title || null,
		contactEmail: bestContact?.email || null,
		contactEmailConfidence: bestContact?.emailConfidence ?? null,
		contactLinkedIn: bestContact?.linkedIn || null,
		discoveryRunId: runId,
		discoveredAt: new Date().toISOString(),
		leadStatus: "pending",
		syncStatus: "not_synced",
	};
}

function escapeCsvField(value: unknown): string {
	const str = String(value ?? "");
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function toCsv(companies: QualifiedCompany[]): string {
	const headers = [
		"company_name",
		"naics_code",
		"naics_description",
		"est_locations",
		"location_methodology",
		"est_revenue_low",
		"est_revenue_mid",
		"est_revenue_high",
		"revenue_confidence",
		"revenue_sources",
		"revenue_reasoning",
		"hq_address",
		"hq_city",
		"hq_state",
		"hq_domain",
		"hq_phone",
		"contact_name",
		"contact_title",
		"contact_email",
		"contact_email_confidence",
		"contact_linkedin",
	];

	const rows = companies.map((company) => {
		const flat = flattenCompany(company, "");
		return [
			flat.companyName,
			flat.naicsCode,
			flat.naicsDescription,
			flat.estimatedLocations,
			flat.locationMethodology,
			flat.estimatedRevenueLow,
			flat.estimatedRevenueMid,
			flat.estimatedRevenueHigh,
			flat.revenueConfidence,
			flat.revenueSources,
			flat.revenueReasoning,
			flat.hqAddress,
			flat.hqCity,
			flat.hqState,
			flat.hqDomain,
			flat.hqPhone,
			flat.contactName,
			flat.contactTitle,
			flat.contactEmail,
			flat.contactEmailConfidence,
			flat.contactLinkedIn,
		]
			.map(escapeCsvField)
			.join(",");
	});

	return [headers.join(","), ...rows].join("\n");
}

export function createExportResultsHandler(
	store: PluginStore,
	config: ExportConfig,
) {
	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			const format = (input.format as string) ?? "csv";

			// Retrieve qualified companies from plugin store
			const companies = store.get("qualified_companies") as
				| QualifiedCompany[]
				| undefined;

			if (companies === undefined) {
				return {
					content:
						"No qualified companies found in store. Run the discovery pipeline first (discover_franchises → estimate_revenue → filter_icp).",
					is_error: true,
				};
			}

			if (companies.length === 0) {
				return {
					content:
						"The ICP pipeline ran but 0 companies passed the filters. Try lowering minRevenue or minLocations thresholds in filter_icp, or run discover_franchises for additional NAICS codes.",
					is_error: true,
				};
			}

			// Warn if HQ or contacts haven't been enriched yet
			const missingHq = companies.filter((c) => !c.hqDomain);
			const missingContacts = companies.filter(
				(c) => !c.contacts || c.contacts.length === 0,
			);
			if (missingHq.length > 0 || missingContacts.length > 0) {
				const warnings: string[] = [];
				if (missingHq.length > 0)
					warnings.push(
						`${missingHq.length} companies missing HQ data — run map_to_hq for each first`,
					);
				if (missingContacts.length > 0)
					warnings.push(
						`${missingContacts.length} companies missing contacts — run enrich_contacts for each first`,
					);
				return {
					content: `Export blocked: ${warnings.join("; ")}. Run these tools before exporting.`,
					is_error: true,
				};
			}

			const outputDir = config.outputDir ?? "./data";
			const timestamp = new Date()
				.toISOString()
				.replace(/[:.]/g, "-")
				.slice(0, 19);

			if (format === "csv") {
				const csv = toCsv(companies);
				const filePath = resolve(outputDir, `qualified_leads_${timestamp}.csv`);
				writeFileSync(filePath, csv, "utf-8");
				return {
					content: `Exported ${companies.length} companies to CSV: ${filePath}`,
				};
			}

			if (format === "json") {
				const filePath = resolve(
					outputDir,
					`qualified_leads_${timestamp}.json`,
				);
				writeFileSync(filePath, JSON.stringify(companies, null, 2), "utf-8");
				return {
					content: `Exported ${companies.length} companies to JSON: ${filePath}`,
				};
			}

			if (format === "strapi") {
				const strapiUrl = config.strapiUrl;
				const strapiToken = config.strapiToken;

				if (!strapiUrl || !strapiToken) {
					return {
						content:
							"Strapi export requires strapiUrl and strapiToken in plugin config or environment variables.",
						is_error: true,
					};
				}

				const runId = `run_${timestamp}`;
				const leads = companies.map((c) => flattenCompany(c, runId));

				// Try bulk import first
				const bulkRes = await fetch(
					`${strapiUrl}/api/enterprise-leads/bulk-import`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${strapiToken}`,
						},
						body: JSON.stringify({ discoveryRunId: runId, leads }),
					},
				);

				if (bulkRes.ok) {
					const result = await bulkRes.json();
					return {
						content: `Pushed ${companies.length} leads to Strapi (bulk import, run: ${runId}). Response: ${JSON.stringify(result)}`,
					};
				}

				// Bulk import failed — capture reason, fall back to individual creates
				const bulkErrText = await bulkRes.text();
				const bulkStatus = bulkRes.status;

				let created = 0;
				const errors: string[] = [];

				for (const lead of leads) {
					const res = await fetch(`${strapiUrl}/api/enterprise-leads`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${strapiToken}`,
						},
						body: JSON.stringify({ data: lead }),
					});

					if (res.ok) {
						created++;
					} else {
						const errText = await res.text();
						errors.push(
							`${lead.companyName} (${res.status}): ${errText.slice(0, 200)}`,
						);
					}
				}

				if (created === 0) {
					return {
						content: `Failed to push leads to Strapi. Bulk import failed (${bulkStatus}): ${bulkErrText.slice(0, 200)}. Individual creates also failed: ${errors.join("; ")}`,
						is_error: true,
					};
				}

				const summary = `Pushed ${created}/${companies.length} leads to Strapi individually (bulk import failed with ${bulkStatus}).`;
				if (errors.length > 0) {
					return {
						content: `${summary} Errors: ${errors.join("; ")}`,
						is_error: true,
					};
				}
				return { content: summary };
			}

			return {
				content: `Unknown format: ${format}. Use "csv", "json", or "strapi".`,
				is_error: true,
			};
		} catch (err) {
			return {
				content: `Error exporting results: ${err instanceof Error ? err.message : String(err)}`,
				is_error: true,
			};
		}
	};
}
