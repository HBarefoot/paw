/**
 * The run verdict — Phase 1 phantom-success detector (deterministic, NO LLM).
 *
 * After every completed run the harness cross-references what the agent *claimed*
 * (its final assistant text) against the actual trajectory (tool log) and the
 * ledger (#180 tasks), and flags runs that look like phantom success — e.g. "I
 * marked the lead seen" with zero successful mutating tool calls. It's advisory:
 * a `suspect` verdict surfaces a run for human review, it never fails or retries
 * the run (hard enforcement is the ledger gate's job, not the detector's).
 *
 * This module is intentionally free of DB/kernel imports so it's pure and
 * exhaustively unit-testable. The kernel adapts its real logs/stores into the
 * small input shapes below.
 */

export type Verdict = "ok" | "suspect" | "error";

/** Minimal tool-log shape the verdict needs (subset of ToolLogEntry). */
export interface VerdictToolEntry {
	tool_name: string;
	is_error: number;
	output_preview?: string | null;
}

/** Minimal task shape the verdict needs (subset of AgentWork). */
export interface VerdictTask {
	status: string;
	evidence?: string | null;
}

export interface VerdictInput {
	claimText: string;
	toolEntries: VerdictToolEntry[];
	sessionTasks: VerdictTask[];
}

export interface VerdictResult {
	verdict: Verdict;
	flags: string[];
	toolCalls: number;
	toolErrors: number;
}

// Past-tense action-COMPLETION verbs. Their presence means the claim asserts a
// mutation actually happened — that's what we cross-check against real writes.
// Word-boundary + case-insensitive so "created"/"Created" match but "creates"
// (present-tense intent, not a completion claim) does not.
const ACTION_CLAIM_RE =
	/\b(created|updated|deleted|sent|posted|marked|saved|scheduled|merged|queued|processed|upserted|inserted)\b/i;

// A *mutating* tool by name stem. Read verbs (find/get/list/read/search/query)
// are deliberately absent, so a run that only read things never counts as a write.
const MUTATING_TOOL_RE =
	/(create|update|delete|write|send|post|upsert|insert|merge|mark|move)/i;

const TERMINAL_TASK_STATUSES = new Set(["done", "failed"]);

function isBlank(s: string | null | undefined): boolean {
	return !s || s.trim().length === 0;
}

/** Does the claim assert an action was completed (vs. a purely informational reply)? */
export function claimAssertsCompletion(claimText: string): boolean {
	return ACTION_CLAIM_RE.test(claimText);
}

/**
 * Compute a deterministic verdict. Precedence: error > suspect > ok. Returns
 * EVERY flag that fired, not just the one that set the verdict.
 */
export function computeRunVerdict(input: VerdictInput): VerdictResult {
	const { claimText, toolEntries, sessionTasks } = input;
	const flags: string[] = [];

	const toolCalls = toolEntries.length;
	const toolErrors = toolEntries.filter((e) => e.is_error === 1).length;

	// --- error-class checks ---
	if (toolErrors > 0) flags.push("tool_error");
	// An error with no surfaced detail — the worst kind, silently swallowed.
	if (toolEntries.some((e) => e.is_error === 1 && isBlank(e.output_preview))) {
		flags.push("swallowed_error");
	}

	// --- suspect-class checks ---
	const assertsCompletion = claimAssertsCompletion(claimText);

	// The core phantom-success signal: the claim says an action completed, but
	// the run made zero SUCCESSFUL mutating tool calls. Compare claim sentiment
	// against real writes — never parse tool names out of the prose.
	if (assertsCompletion) {
		const successfulMutations = toolEntries.filter(
			(e) => e.is_error === 0 && MUTATING_TOOL_RE.test(e.tool_name),
		).length;
		if (successfulMutations === 0) flags.push("success_claim_no_write");
	}

	// Belt-and-suspenders vs the #180 ledger gate: a done task with no evidence.
	if (sessionTasks.some((t) => t.status === "done" && isBlank(t.evidence))) {
		flags.push("task_done_without_evidence");
	}

	// The claim asserts completion but a task from this run is still open.
	if (
		assertsCompletion &&
		sessionTasks.some((t) => !TERMINAL_TASK_STATUSES.has(t.status))
	) {
		flags.push("task_left_open");
	}

	const ERROR_FLAGS = new Set(["tool_error", "swallowed_error"]);
	let verdict: Verdict = "ok";
	if (flags.some((f) => ERROR_FLAGS.has(f))) verdict = "error";
	else if (flags.length > 0) verdict = "suspect";

	return { verdict, flags, toolCalls, toolErrors };
}

/** A run row ready to persist (mirrors the `runs` table columns). */
export interface RunRecord {
	id: string;
	session_id: string;
	channel: string | null;
	user_id: string | null;
	claim_preview: string;
	tool_calls: number;
	tool_errors: number;
	verdict: Verdict;
	flags: string; // JSON array string
	started_at: string | null;
	ended_at: string | null;
}

const CLAIM_PREVIEW_CAP = 2000;

export interface RecordRunVerdictDeps {
	input: VerdictInput;
	id: string;
	sessionId: string;
	channel: string | null;
	userId: string | null;
	startedAt: string | null;
	endedAt: string | null;
	/** Persist the row (kernel injects the real store fn). */
	recordRun: (row: RunRecord) => void;
	/** Surface a non-ok verdict (kernel injects notifications.add). */
	notify: (n: {
		kind: string;
		level: "warning";
		title: string;
		body: string;
		url: string;
	}) => void;
	/** Defaults to {@link computeRunVerdict}; overridable for tests. */
	compute?: (input: VerdictInput) => VerdictResult;
}

/**
 * Dependency-injected orchestrator: compute → record → (alert if non-ok),
 * entirely wrapped in try/catch so the verdict path can NEVER break or delay a
 * run that already succeeded for the user. Returns the result, or null on any
 * error. No DB/kernel imports — the kernel injects `recordRun`/`notify`.
 */
export function recordRunVerdict(
	deps: RecordRunVerdictDeps,
): VerdictResult | null {
	try {
		const compute = deps.compute ?? computeRunVerdict;
		const result = compute(deps.input);
		const row: RunRecord = {
			id: deps.id,
			session_id: deps.sessionId,
			channel: deps.channel,
			user_id: deps.userId,
			claim_preview: deps.input.claimText.slice(0, CLAIM_PREVIEW_CAP),
			tool_calls: result.toolCalls,
			tool_errors: result.toolErrors,
			verdict: result.verdict,
			flags: JSON.stringify(result.flags),
			started_at: deps.startedAt,
			ended_at: deps.endedAt,
		};
		deps.recordRun(row);
		if (result.verdict !== "ok") {
			deps.notify({
				kind: "observability",
				level: "warning",
				title: `Run looks suspect: ${result.verdict}`,
				body: result.flags.join(", ") || result.verdict,
				url: `/runs#${deps.id}`,
			});
		}
		return result;
	} catch {
		// Fail-open: the run already succeeded; never let scoring throw.
		return null;
	}
}
