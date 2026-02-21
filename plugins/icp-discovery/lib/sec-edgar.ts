const SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
const USER_AGENT = "Paw ICP Discovery/0.1 (contact@example.com)";

export interface EdgarFiling {
	companyName: string;
	cik: string;
	formType: string;
	dateFiled: string;
	filingUrl: string;
	description: string;
}

export interface EdgarSearchResponse {
	hits?: {
		hits?: Array<{
			_source: {
				display_names?: string[];
				entity_name?: string;
				file_date?: string;
				form_type?: string;
				file_num?: string;
				period_of_report?: string;
			};
			_id?: string;
		}>;
		total?: { value: number };
	};
}

export async function searchEdgar(companyName: string): Promise<EdgarFiling[]> {
	const params = new URLSearchParams({
		q: `"${companyName}"`,
		forms: "10-K",
		dateRange: "custom",
		startdt: "2023-01-01",
	});

	const res = await fetch(`${SEARCH_URL}?${params}`, {
		headers: { "User-Agent": USER_AGENT },
	});

	if (!res.ok) {
		if (res.status === 429) {
			// SEC EDGAR rate limits — wait and retry once
			await new Promise((resolve) => setTimeout(resolve, 2000));
			const retry = await fetch(`${SEARCH_URL}?${params}`, {
				headers: { "User-Agent": USER_AGENT },
			});
			if (!retry.ok) return [];
			const data = (await retry.json()) as EdgarSearchResponse;
			return parseEdgarResponse(data);
		}
		return [];
	}

	const data = (await res.json()) as EdgarSearchResponse;
	return parseEdgarResponse(data);
}

function parseEdgarResponse(data: EdgarSearchResponse): EdgarFiling[] {
	const hits = data.hits?.hits ?? [];
	return hits.map((hit) => {
		const src = hit._source;
		const name = src.display_names?.[0] ?? src.entity_name ?? "Unknown";
		return {
			companyName: name,
			cik: src.file_num ?? "",
			formType: src.form_type ?? "10-K",
			dateFiled: src.file_date ?? src.period_of_report ?? "",
			filingUrl: hit._id
				? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${src.file_num}&type=10-K`
				: "",
			description: `${name} ${src.form_type ?? "10-K"} filed ${src.file_date ?? "unknown date"}`,
		};
	});
}
