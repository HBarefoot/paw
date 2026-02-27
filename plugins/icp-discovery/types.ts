export interface ICPConfig {
	naicsCode: string;
	minLocations: number;
	minRevenue: number;
	excludeCompanies?: string[];
	metroSampleCities: string[];
}

export interface DiscoveredBrand {
	name: string;
	naicsCode: string;
	naicsDescription?: string;
	estimatedLocations: number;
	locationMethodology: string;
	sources: string[];
	parentCompany?: string;
	sisterBrands?: string[];
}

export interface RevenueSource {
	type: "sec_edgar" | "fdd" | "press_release" | "employee_proxy" | "web_search";
	value: number | string;
	url?: string;
	date?: string;
}

export interface RevenueEstimate {
	companyName: string;
	revenueLow: number;
	revenueMid: number;
	revenueHigh: number;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	sources: RevenueSource[];
	reasoning: string;
}

export interface ContactInfo {
	name: string;
	title: string;
	email: string;
	emailConfidence: number;
	linkedIn?: string;
	department: string;
	source?: string;
}

export interface QualifiedCompany {
	companyName: string;
	naicsCode: string;
	naicsDescription?: string;
	estimatedLocations: number;
	revenueEstimate: RevenueEstimate;
	hqAddress?: string;
	hqCity?: string;
	hqState?: string;
	hqDomain?: string;
	hqPhone?: string;
	contacts: ContactInfo[];
	parentCompany?: string;
	sisterBrands?: string[];
}

export interface DiscoveryRunResult {
	runId: string;
	timestamp: string;
	config: ICPConfig;
	totalDiscovered: number;
	totalQualified: number;
	companies: QualifiedCompany[];
	costEstimate: {
		serpapi: number;
		claude: number;
		hunter: number;
		total: number;
	};
}
