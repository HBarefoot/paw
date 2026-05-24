import type { AIProvider } from "./base-provider.js";
import type { Logger } from "../types/plugin.js";

export interface RoutingRule {
	match: {
		taskType?: string;
		skillName?: string;
		agentName?: string;
	};
	provider: string;
	model?: string;
}

export interface RoutingContext {
	taskDescription?: string;
	skillName?: string;
	agentName?: string;
	isSubAgent?: boolean;
}

/**
 * Routes requests to the optimal AI provider based on configurable rules.
 * Falls back to the default provider if no rule matches.
 */
export class ProviderRouter {
	private providers: Map<string, AIProvider>;
	private rules: RoutingRule[];
	private defaultProvider: AIProvider;
	private logger: Logger;

	constructor(opts: {
		providers: Map<string, AIProvider>;
		rules: RoutingRule[];
		defaultProvider: AIProvider;
		logger: Logger;
	}) {
		this.providers = opts.providers;
		this.rules = opts.rules;
		this.defaultProvider = opts.defaultProvider;
		this.logger = opts.logger;
	}

	/**
	 * Select the best provider for a given context.
	 * Evaluates rules in order, returns first match.
	 */
	selectProvider(context: RoutingContext): AIProvider {
		for (const rule of this.rules) {
			if (this.matchesRule(rule, context)) {
				const provider = this.providers.get(rule.provider);
				if (provider) {
					this.logger.debug("Router: matched rule", {
						provider: rule.provider,
						agentName: context.agentName,
						skillName: context.skillName,
					});
					return provider;
				}
			}
		}
		return this.defaultProvider;
	}

	/**
	 * Get a provider by name directly (used when agent definition
	 * specifies an explicit provider override).
	 */
	getProvider(name: string): AIProvider | null {
		return this.providers.get(name) ?? null;
	}

	private matchesRule(rule: RoutingRule, context: RoutingContext): boolean {
		const m = rule.match;

		if (m.agentName && context.agentName !== m.agentName) return false;
		if (m.skillName && context.skillName !== m.skillName) return false;

		if (m.taskType && context.taskDescription) {
			const taskType = classifyTask(context.taskDescription);
			if (taskType !== m.taskType) return false;
		}

		return true;
	}
}

/**
 * Simple keyword-based task classification.
 * Used by routing rules to match tasks to provider tiers.
 */
function classifyTask(description: string): string {
	const lower = description.toLowerCase();

	const classificationKeywords = [
		"classify",
		"categorize",
		"label",
		"tag",
		"sort",
	];
	const extractionKeywords = [
		"extract",
		"parse",
		"pull out",
		"find all",
		"list all",
	];
	const summarizationKeywords = [
		"summarize",
		"summary",
		"recap",
		"tldr",
		"brief",
	];
	const reasoningKeywords = [
		"analyze",
		"reason",
		"explain why",
		"compare",
		"evaluate",
		"decide",
		"plan",
		"design",
		"architect",
	];
	const codingKeywords = [
		"code",
		"implement",
		"write a function",
		"debug",
		"fix the",
		"refactor",
	];

	if (classificationKeywords.some((k) => lower.includes(k)))
		return "classification";
	if (extractionKeywords.some((k) => lower.includes(k))) return "extraction";
	if (summarizationKeywords.some((k) => lower.includes(k)))
		return "summarization";
	if (codingKeywords.some((k) => lower.includes(k))) return "coding";
	if (reasoningKeywords.some((k) => lower.includes(k))) return "reasoning";

	return "general";
}
