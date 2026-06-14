import { describe, expect, test } from "bun:test";
import { needsSessionId } from "../../src/ai/tool-context.js";

describe("needsSessionId", () => {
	test("session-aware tools get the sessionId injected", () => {
		for (const name of [
			"spawn_agent",
			"execute_code",
			"github_merge_pr",
			"github_delete_branch",
			"github_close_issue",
			"github_dispatch_workflow",
		]) {
			expect(needsSessionId(name)).toBe(true);
		}
	});

	test("ordinary tools do not", () => {
		for (const name of [
			"file_read",
			"canvas_write",
			"github_get_pr",
			"github_list_prs",
			"memory_recall",
			"",
		]) {
			expect(needsSessionId(name)).toBe(false);
		}
	});
});
