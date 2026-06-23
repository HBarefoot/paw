import type { Database } from "bun:sqlite";
import type { SkillManager } from "../ai/skills.js";
import { getCronCard, upsertCronCard } from "../store/agent-work.js";

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
export function cronCardTurn(
	cardId: string,
	prompt: string,
	operatorNote?: string | null,
): string {
	const preamble = [
		`This run is tracked as board card ${cardId}. When you finish, you MUST record the outcome with the task_update tool:`,
		`- If you completed the work, call task_update { id: "${cardId}", status: "done", evidence: <proof> } where evidence is real proof it landed — a re-query result, counts, a diff, or a URL. Do not write vague or fabricated evidence.`,
		`- If you could not finish or can't prove it, call task_update { id: "${cardId}", status: "blocked", error: <one line why>, block_kind: <needs_feedback | needs_access | needs_capability> }. Pick needs_feedback if operator feedback or a decision would unblock you, needs_access if you're missing a credential or permission, needs_capability if a required tool/feature doesn't exist.`,
		"Never claim done without evidence — the system will refuse it.",
	].join("\n");
	// Operator feedback (the help-leash) leads the prompt so a re-fired cron run
	// retries knowing what it was missing. Sits after the preamble `---`.
	const note = operatorNote?.trim();
	const body = note ? `Operator feedback: ${note}\n\n${prompt}` : prompt;
	return `${preamble}\n\n---\n\n${body}`;
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
	// `upsertCronCard` preserves operator_note across a re-fire, so the card now
	// carries any feedback the operator left when they resumed it. Fold it in.
	const card = getCronCard(deps.db, deps.jobId);
	return cronCardTurn(cardId, deps.prompt, card?.operator_note);
}
