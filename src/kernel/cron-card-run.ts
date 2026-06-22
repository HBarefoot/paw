import type { Database } from "bun:sqlite";
import type { SkillManager } from "../ai/skills.js";
import { upsertCronCard } from "../store/agent-work.js";

// Phase 2c.1 — cron self-report. A cron `prompt` run gets the same
// close-with-evidence discipline a board run got in 2a.1: it's told which durable
// card it's on and to prove its work via `task_update`. Extracted here (not inline
// in the kernel) so the turn-building + skill pre-activation are unit-testable
// with a real SkillManager — mirrors 2a.1's `withSkill` seam.

/**
 * Prepend a close-with-evidence preamble to a cron run's turn, naming the durable
 * card the run is tracked on. Pure. Mirrors the board's `turnFor` (2a.1): the
 * preamble leads the turn (the cron carries only a prompt string), interpolating
 * the exact card id the agent must update.
 */
export function cronCardTurn(cardId: string, prompt: string): string {
	const preamble = [
		`This run is tracked as board card ${cardId}. When you finish, you MUST record the outcome with the task_update tool:`,
		`- If you completed the work, call task_update { id: "${cardId}", status: "done", evidence: <proof> } where evidence is real proof it landed — a re-query result, counts, a diff, or a URL. Do not write vague or fabricated evidence.`,
		`- If you could not finish or can't prove it, call task_update { id: "${cardId}", status: "blocked", error: <one line why> }.`,
		"Never claim done without evidence — the system will refuse it.",
	].join("\n");
	return `${preamble}\n\n---\n\n${prompt}`;
}

/**
 * Prepare a cron run for the board: upsert its durable card (→ `working`), make
 * the on-demand `tasks` skill reachable for the cron session so the agent can
 * call `task_update`/`task_get`, and return the turn with the card-context
 * preamble. Fail-open: if the card can't be created, run with the bare prompt
 * (no preamble, no skill change) — the run still happens.
 */
export function prepareCronCardRun(deps: {
	db: Database;
	skillManager: SkillManager;
	jobId: string;
	jobName: string;
	sessionId: string;
	prompt: string;
	onError?: (err: unknown) => void;
}): string {
	const cardId = upsertCronCard(
		deps.db,
		{
			jobId: deps.jobId,
			jobName: deps.jobName,
			sessionId: deps.sessionId,
			prompt: deps.prompt,
		},
		deps.onError,
	);
	if (!cardId) return deps.prompt;
	deps.skillManager.activateSkill(deps.sessionId, "tasks");
	return cronCardTurn(cardId, deps.prompt);
}
