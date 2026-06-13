import { describe, expect, test } from "bun:test";
import {
	APPROVE_ACTION,
	DENY_ACTION,
	buildApprovalBlocks,
	parseSlackRef,
	resolvedText,
} from "../../plugins/slack/approvals.js";

describe("parseSlackRef", () => {
	test("valid JSON ref → channel + threadTs", () => {
		expect(
			parseSlackRef(JSON.stringify({ channel: "C1", threadTs: "1.2" })),
		).toEqual({ channel: "C1", threadTs: "1.2" });
	});
	test("missing / malformed → null", () => {
		expect(parseSlackRef(null)).toBeNull();
		expect(parseSlackRef("not json")).toBeNull();
		expect(parseSlackRef(JSON.stringify({ threadTs: "1.2" }))).toBeNull();
	});
});

describe("buildApprovalBlocks", () => {
	test("emits Approve + Deny buttons carrying the approval id", () => {
		const blocks = buildApprovalBlocks({
			id: "abc-123",
			summary: "Merge PR #42 in a/b",
			repo: "a/b",
			requestedBy: "slack-C1-1.2",
		}) as Array<{
			type: string;
			elements?: Array<{ action_id: string; value: string }>;
		}>;
		const actions = blocks.find((b) => b.type === "actions");
		expect(actions).toBeTruthy();
		const ids = actions?.elements?.map((e) => e.action_id);
		expect(ids).toContain(APPROVE_ACTION);
		expect(ids).toContain(DENY_ACTION);
		for (const e of actions?.elements ?? []) {
			expect(e.value).toBe("abc-123");
		}
	});
});

describe("resolvedText", () => {
	test("status → human text with the actor", () => {
		expect(resolvedText("executed", "U1", "Merge")).toContain("Approved");
		expect(resolvedText("executed", "U1", "Merge")).toContain("<@U1>");
		expect(resolvedText("rejected", "U1", "Merge")).toContain("Denied");
		expect(resolvedText("unauthorized", "U1", "Merge")).toContain(
			"isn't authorized",
		);
	});
});
