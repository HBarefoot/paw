import type { HunterConfig } from "../lib/hunter";
import { createHunterClient } from "../lib/hunter";
import type { CachedSearchClient } from "../lib/search-cache";
import type { ContactInfo } from "../types";

interface PluginDeps {
	hunterConfig: HunterConfig;
	searchClient: CachedSearchClient;
}

export function createEnrichContactsHandler(deps: PluginDeps) {
	const hunter = createHunterClient(deps.hunterConfig);
	const serpapi = deps.searchClient;

	return async (
		input: Record<string, unknown>,
	): Promise<{ content: string; is_error?: boolean }> => {
		try {
			const domain = input.domain as string;
			const companyName = (input.companyName as string) ?? domain;

			if (!domain) {
				return { content: "Error: domain is required", is_error: true };
			}

			if (!deps.hunterConfig.apiKey) {
				return {
					content: "Error: HUNTER_API_KEY not configured in .env",
					is_error: true,
				};
			}

			const contacts: ContactInfo[] = [];

			// Step 1: Hunter.io domain search with marketing/executive filters
			try {
				// Fetch without department filter — Hunter.io often lacks accurate
				// department tags, so we get all contacts and filter by title/seniority
				// client-side. This avoids 0-result responses from overly narrow filters.
				const hunterResults = await hunter.domainSearch(domain, {
					limit: 20,
				});

				const MARKETING_TITLES =
					/\b(marketing|cmo|brand|communication|pr|public.?relations|growth|demand.?gen|digital|media|content|advertising)\b/i;
				const EXECUTIVE_TITLES =
					/\b(chief|ceo|cfo|coo|president|vp|vice.?president|svp|evp|director|head|senior)\b/i;
				const TARGET_DEPTS = new Set([
					"marketing",
					"executive",
					"communication",
					"management",
				]);

				for (const contact of hunterResults) {
					const title = contact.position || "";
					const dept = (contact.department || "").toLowerCase();
					const isTargetDept = !dept || TARGET_DEPTS.has(dept);
					const isRelevantTitle =
						MARKETING_TITLES.test(title) || EXECUTIVE_TITLES.test(title);

					if (isTargetDept || isRelevantTitle) {
						contacts.push({
							name: `${contact.first_name} ${contact.last_name}`.trim(),
							title: title || "Unknown",
							email: contact.value,
							emailConfidence: contact.confidence,
							linkedIn: contact.linkedin || undefined,
							department: contact.department || "marketing",
						});
					}
				}
			} catch (err) {
				// Hunter.io failed — fall through to SerpApi fallback
				const msg = err instanceof Error ? err.message : String(err);
				if (contacts.length === 0) {
					// Only use fallback if Hunter.io produced no results
					try {
						const searchResult = await serpapi.googleSearch(
							`"${companyName}" "VP Marketing" OR "CMO" OR "Chief Marketing Officer" site:linkedin.com`,
						);

						for (const result of (searchResult.organic_results ?? []).slice(
							0,
							3,
						)) {
							const linkedInUrl = result.link.includes("linkedin.com")
								? result.link
								: undefined;

							// Extract name and title from search result
							const titleMatch = result.title.match(
								/^(.+?)\s*[-–—|]\s*(.+?)(?:\s*[-–—|]|$)/,
							);
							if (titleMatch) {
								contacts.push({
									name: titleMatch[1].trim(),
									title: titleMatch[2].trim(),
									email: "",
									emailConfidence: 0,
									linkedIn: linkedInUrl,
									department: "marketing",
								});
							}
						}
					} catch {
						// Both methods failed
					}

					if (contacts.length === 0) {
						return {
							content: JSON.stringify({
								companyName,
								domain,
								contacts: [],
								note: `No contacts found via Hunter.io (${msg}) or LinkedIn search`,
							}),
						};
					}
				}
			}

			// Sort by confidence descending, prefer marketing department
			contacts.sort((a, b) => {
				const deptPriority = (dept: string) =>
					dept.toLowerCase() === "marketing" ? 0 : 1;
				const deptDiff =
					deptPriority(a.department) - deptPriority(b.department);
				if (deptDiff !== 0) return deptDiff;
				return b.emailConfidence - a.emailConfidence;
			});

			return {
				content: JSON.stringify(
					{ companyName, domain, contactCount: contacts.length, contacts },
					null,
					2,
				),
			};
		} catch (err) {
			return {
				content: `Error enriching contacts: ${err instanceof Error ? err.message : String(err)}`,
				is_error: true,
			};
		}
	};
}
