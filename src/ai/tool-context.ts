/**
 * Tools that need the originating `sessionId` injected into their input. The
 * provider tool-call loop adds `input.__sessionId = sessionId` for these so the
 * handler can resolve per-turn context at execution time:
 *   - spawn_agent / execute_code — thread the session into sub-runs.
 *   - the gated GitHub actions — record which channel an approval came from
 *     (originFromSessionId), so it can be delivered back to that surface.
 * Keep this list in sync when a new tool needs session/channel context.
 */
const SESSION_AWARE_TOOLS = new Set<string>([
	"spawn_agent",
	"execute_code",
	"github_merge_pr",
	"github_delete_branch",
	"github_close_issue",
	"github_dispatch_workflow",
]);

export function needsSessionId(toolName: string): boolean {
	return SESSION_AWARE_TOOLS.has(toolName);
}
