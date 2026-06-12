import type { Logger } from "../types/plugin.js";
import type { AIProvider } from "./base-provider.js";

/** Inline notes appended to a reply when an image can't be handled normally. */
export const VISION_UNCONFIGURED_NOTE =
	"⚠️ This message includes an image, but the active model can't see images and no vision model is configured (`ai.vision`). I answered from the text only.";
export const VISION_ERROR_NOTE =
	"⚠️ The configured vision model couldn't be reached, so I answered with the default model — which may not be able to see the image.";

/**
 * Decide how to handle an inbound turn's images (pure — unit-testable without the
 * kernel). `useVision` ⇒ route to the vision provider; `note` ⇒ prepend the
 * unconfigured warning (only when there's an image, vision isn't configured, and
 * the default provider can't see images). The error-fallback note is applied by
 * the caller when the vision provider throws.
 */
export function planImageTurn(opts: {
	hasImage: boolean;
	visionConfigured: boolean;
	defaultCanSeeImages: boolean;
}): { useVision: boolean; note: "unconfigured" | null } {
	if (!opts.hasImage) return { useVision: false, note: null };
	if (opts.visionConfigured) return { useVision: true, note: null };
	return {
		useVision: false,
		note: opts.defaultCanSeeImages ? null : "unconfigured",
	};
}

/**
 * Run the primary (vision) attempt; if it throws AND this was a vision route,
 * degrade to the fallback (default provider) instead of dropping the turn.
 * Non-vision errors propagate unchanged. Returns whether the fallback was used
 * so the caller can swap in the default model/provider + the error note.
 */
export async function withVisionFallback<T>(opts: {
	isVision: boolean;
	primary: () => Promise<T>;
	onFallback: () => Promise<T>;
}): Promise<{ value: T; usedFallback: boolean }> {
	try {
		return { value: await opts.primary(), usedFallback: false };
	} catch (err) {
		if (!opts.isVision) throw err;
		return { value: await opts.onFallback(), usedFallback: true };
	}
}

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
	private visionProvider: AIProvider | null;
	private logger: Logger;

	constructor(opts: {
		providers: Map<string, AIProvider>;
		rules: RoutingRule[];
		defaultProvider: AIProvider;
		visionProvider?: AIProvider | null;
		logger: Logger;
	}) {
		this.providers = opts.providers;
		this.rules = opts.rules;
		this.defaultProvider = opts.defaultProvider;
		this.visionProvider = opts.visionProvider ?? null;
		this.logger = opts.logger;
	}

	/**
	 * Vision routing rule: an image-bearing turn goes to the configured vision
	 * provider; everything else stays on the default route (the general rules are
	 * deliberately NOT consulted here, so text turns are byte-identical). Returns
	 * the default provider when no vision provider is configured.
	 */
	selectForImageTurn(hasImage: boolean): AIProvider {
		return hasImage && this.visionProvider
			? this.visionProvider
			: this.defaultProvider;
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
