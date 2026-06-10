import type { Database } from "bun:sqlite";

/** Approximate cost per 1M tokens (USD) */
const PRICING: Record<string, { input: number; output: number }> = {
	// Claude
	"claude-sonnet-4-5-20250929": { input: 3, output: 15 },
	"claude-haiku-3-5-20241022": { input: 0.8, output: 4 },
	// OpenAI
	"gpt-4o": { input: 2.5, output: 10 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
	// Gemini
	"gemini-2.0-flash": { input: 0.1, output: 0.4 },
	// Ollama (local/free)
	default: { input: 0, output: 0 },
};

export interface UsageRecord {
	sessionId: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	estimatedCostUsd: number;
}

/**
 * Rough fallback token estimator for providers that don't surface a
 * `usage` object (OpenAI/Gemini/Ollama in this codebase). Counts
 * ~4 chars per token, which is the rule of thumb for English text
 * in modern transformer tokenizers. The estimate is intentionally
 * crude; the goal is "non-zero" cost data, not precise billing.
 */
export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

export class CostTracker {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	recordUsage(record: UsageRecord): void {
		this.db.run(
			`INSERT INTO usage_log (session_id, provider, model, input_tokens, output_tokens, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?)`,
			[
				record.sessionId,
				record.provider,
				record.model,
				record.inputTokens,
				record.outputTokens,
				record.estimatedCostUsd,
			],
		);
	}

	getSessionCost(sessionId: string): {
		totalInputTokens: number;
		totalOutputTokens: number;
		estimatedCostUsd: number;
	} {
		const row = this.db
			.prepare<
				{
					total_input: number;
					total_output: number;
					total_cost: number;
				},
				[string]
			>(
				`SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COALESCE(SUM(estimated_cost_usd), 0) as total_cost
       FROM usage_log WHERE session_id = ?`,
			)
			.get(sessionId);

		return {
			totalInputTokens: row?.total_input ?? 0,
			totalOutputTokens: row?.total_output ?? 0,
			estimatedCostUsd: row?.total_cost ?? 0,
		};
	}

	getTotalCost(opts?: { since?: string }): {
		totalInputTokens: number;
		totalOutputTokens: number;
		estimatedCostUsd: number;
		byProvider: Record<
			string,
			{ inputTokens: number; outputTokens: number; costUsd: number }
		>;
	} {
		const whereClause = opts?.since
			? "WHERE created_at >= ?"
			: "";
		const params = opts?.since ? [opts.since] : [];

		const total = this.db
			.prepare<
				{ total_input: number; total_output: number; total_cost: number },
				string[]
			>(
				`SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COALESCE(SUM(estimated_cost_usd), 0) as total_cost
       FROM usage_log ${whereClause}`,
			)
			.get(...params);

		const byProviderRows = this.db
			.prepare<
				{
					provider: string;
					total_input: number;
					total_output: number;
					total_cost: number;
				},
				string[]
			>(
				`SELECT provider,
              COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COALESCE(SUM(estimated_cost_usd), 0) as total_cost
       FROM usage_log ${whereClause} GROUP BY provider`,
			)
			.all(...params);

		const byProvider: Record<
			string,
			{ inputTokens: number; outputTokens: number; costUsd: number }
		> = {};
		for (const row of byProviderRows) {
			byProvider[row.provider] = {
				inputTokens: row.total_input,
				outputTokens: row.total_output,
				costUsd: row.total_cost,
			};
		}

		return {
			totalInputTokens: total?.total_input ?? 0,
			totalOutputTokens: total?.total_output ?? 0,
			estimatedCostUsd: total?.total_cost ?? 0,
			byProvider,
		};
	}

	static estimateCost(
		model: string,
		inputTokens: number,
		outputTokens: number,
	): number {
		const pricing = PRICING[model] ?? PRICING.default;
		return (
			(inputTokens / 1_000_000) * pricing.input +
			(outputTokens / 1_000_000) * pricing.output
		);
	}
}
