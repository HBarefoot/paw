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

	// Normalize company name for comparison
	const normalizeCompany = (s: string): string =>
		s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

	// Check if two company names are a fuzzy match
	const isCompanyMatch = (contactOrg: string, targetCompany: string): boolean => {
		const target = normalizeCompany(targetCompany);
		const org = normalizeCompany(contactOrg);
		if (!target || !org) return true; // can't determine, assume match
		if (org.includes(target) || target.includes(org)) return true;
		// Handle suffixes: "Crunch Fitness" matches "Crunch Fitness Holdings LLC"
		const NOISE = new Set(["inc", "llc", "corp", "co", "ltd", "group", "holdings", "international", "franchise", "systems"]);
		const targetWords = target.split(/\s+/).filter(w => !NOISE.has(w) && w.length > 2);
		return targetWords.length > 0 && targetWords.every(word => org.includes(word));
	};

	// Check if a contact's title references a different company
	const isCompanyMismatch = (title: string, companyName: string): boolean => {
		const companyInTitle = title.match(/(?:\bat\b|[-–—],|\|)\s*(.+?)$/i);
		if (!companyInTitle) return false;
		const extracted = companyInTitle[1].trim();
		return !isCompanyMatch(extracted, companyName);
	};

	// Parse LinkedIn search result title: "Name - Title - Company | LinkedIn"
	const parseLinkedInTitle = (title: string): { name: string; role: string; company: string } | null => {
		const match = title.match(/^(.+?)\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+?)(?:\s*\||$)/);
		if (!match) return null;
		return {
			name: match[1].trim(),
			role: match[2].trim(),
			company: match[3].trim().replace(/\s*\|.*$/, ""),
		};
	};

	// LinkedIn fallback via SerpApi — tries multiple title variations
	const linkedInFallback = async (companyName: string, _domain: string): Promise<ContactInfo[]> => {
		const titleQueries = [
			`"${companyName}" "Chief Marketing Officer" site:linkedin.com/in/`,
			`"${companyName}" "VP Marketing" OR "Vice President Marketing" site:linkedin.com/in/`,
			`"${companyName}" "Head of Marketing" OR "Director of Marketing" site:linkedin.com/in/`,
			`"${companyName}" "SVP Marketing" OR "CMO" site:linkedin.com/in/`,
		];

		const results: ContactInfo[] = [];
		const seenNames = new Set<string>();

		for (const query of titleQueries) {
			if (results.length >= 3) break;
			try {
				const searchResult = await serpapi.googleSearch(query);
				const linkedInResults = (searchResult.organic_results ?? []).filter(
					(r) => r.link?.includes("linkedin.com/in/"),
				);

				for (const result of linkedInResults.slice(0, 2)) {
					const parsed = parseLinkedInTitle(result.title);
					if (!parsed) continue;
					// Validate company match
					if (!isCompanyMatch(parsed.company, companyName)) {
						console.log(`[icp-discovery] LinkedIn skip: ${parsed.name} at "${parsed.company}" doesn't match "${companyName}"`);
						continue;
					}
					if (seenNames.has(parsed.name.toLowerCase())) continue;
					seenNames.add(parsed.name.toLowerCase());

					results.push({
						name: parsed.name,
						title: parsed.role,
						email: "",
						emailConfidence: 0,
						linkedIn: result.link,
						department: "marketing",
					});
				}
			} catch {
				// Search query failed, try next
			}
		}
		return results;
	};

	// Guess email patterns and verify via Hunter.io
	const guessAndVerifyEmail = async (firstName: string, lastName: string, domain: string): Promise<{ email: string; confidence: number } | null> => {
		const fn = firstName.toLowerCase().replace(/[^a-z]/g, "");
		const ln = lastName.toLowerCase().replace(/[^a-z]/g, "");
		if (!fn || !ln) return null;

		const patterns = [
			`${fn}.${ln}@${domain}`,
			`${fn[0]}${ln}@${domain}`,
			`${fn}@${domain}`,
			`${fn}${ln}@${domain}`,
			`${fn[0]}.${ln}@${domain}`,
		];

		for (const email of patterns) {
			const result = await hunter.verifyEmail(email);
			if (result && (result.status === "valid" || result.status === "accept_all") && result.score >= 50) {
				return { email, confidence: result.score };
			}
		}
		return null;
	};

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

			let contacts: ContactInfo[] = [];

			// Step 1: Hunter.io domain search — unfiltered, then filter client-side
			try {
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

				// If strict filters returned nothing, try keeping ANY contact from the domain
				if (contacts.length === 0 && hunterResults.length > 0) {
					console.log(`[icp-discovery] No marketing/exec contacts for ${domain}, using best available from ${hunterResults.length} results`);
					for (const contact of hunterResults.slice(0, 5)) {
						contacts.push({
							name: `${contact.first_name} ${contact.last_name}`.trim(),
							title: contact.position || "Unknown",
							email: contact.value,
							emailConfidence: contact.confidence,
							linkedIn: contact.linkedin || undefined,
							department: contact.department || "unknown",
						});
					}
				}

				// Filter out contacts whose title references a different company
				contacts = contacts.filter(c => !isCompanyMismatch(c.title, companyName));
			} catch (err) {
				console.error(`[icp-discovery] Hunter.io failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`);
			}

			// Step 2: LinkedIn fallback when Hunter returned no usable contacts
			if (contacts.length === 0) {
				contacts = await linkedInFallback(companyName, domain);
			}

			// Step 3: For LinkedIn-sourced contacts without email, try email guessing
			for (const contact of contacts) {
				if (!contact.email && contact.name) {
					const parts = contact.name.split(/\s+/);
					if (parts.length >= 2) {
						const verified = await guessAndVerifyEmail(parts[0], parts[parts.length - 1], domain);
						if (verified) {
							contact.email = verified.email;
							contact.emailConfidence = verified.confidence;
						}
					}
				}
			}

			if (contacts.length === 0) {
				return {
					content: JSON.stringify({
						companyName,
						domain,
						contacts: [],
						note: "No contacts found via Hunter.io or LinkedIn search",
					}),
				};
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
