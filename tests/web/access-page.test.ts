import { describe, expect, test } from "bun:test";
import type { ApprovedUser } from "../../src/security/access-control.js";
import {
	AccessPage,
	type AccessPageProps,
	type PendingPairing,
	accessScript,
} from "../../src/web/views/access-page.js";

function render(overrides: Partial<AccessPageProps> = {}): string {
	const base: AccessPageProps = {
		enabled: true,
		pending: [],
		approved: [],
		persistedIds: [],
	};
	return String(AccessPage({ ...base, ...overrides }));
}

const approvedUser: ApprovedUser = {
	userId: "U07XYZ",
	channel: "all",
	approvedAt: "2026-06-14",
	approvedBy: "web:1",
};

const future = new Date(Date.now() + 5 * 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

describe("access page", () => {
	test("pending rows render the user id, expiry, and an Approve button", () => {
		const pending: PendingPairing[] = [
			{ userId: "U07ABC", expiresAt: future, createdAt: future },
		];
		const html = render({ pending });
		expect(html).toContain("U07ABC");
		expect(html).toContain("expires in");
		expect(html).toContain("acApprove(this.dataset.id)");
		expect(html).toContain("Approve");
	});

	test("an expired pending code is labelled expired", () => {
		const html = render({
			pending: [{ userId: "U07OLD", expiresAt: past, createdAt: past }],
		});
		expect(html).toContain("expired");
	});

	test("approved rows render approver and a Revoke button", () => {
		const html = render({ approved: [approvedUser] });
		expect(html).toContain("U07XYZ");
		expect(html).toContain("web:1");
		expect(html).toContain("acRevoke(this.dataset.id)");
		expect(html).toContain("Revoke");
	});

	test("a non-persisted approved user gets a Persist button", () => {
		const html = render({ approved: [approvedUser], persistedIds: [] });
		expect(html).toContain("acPersist(this.dataset.id)");
		expect(html).toContain("Persist");
	});

	test("a persisted user shows the 'survives redeploys' pill, not a Persist button", () => {
		const html = render({
			approved: [approvedUser],
			persistedIds: ["U07XYZ"],
		});
		expect(html).toContain("survives redeploys");
		expect(html).not.toContain("acPersist(this.dataset.id)");
	});

	test("the note no longer tells the operator to hand-edit config to survive a redeploy", () => {
		const html = render();
		// old misleading wording is gone; the durable path is now one-click Persist + ownerUserIds
		expect(html).not.toContain("add the user to");
		expect(html).toContain("security.ownerUserIds");
	});

	test("empty states when nothing is pending or approved", () => {
		const html = render();
		expect(html).toContain("Nobody is waiting for approval");
		expect(html).toContain("No approved users yet");
	});

	test("warns when access control is not active", () => {
		expect(render({ enabled: false })).toContain(
			"Access control is not active",
		);
	});
});

describe("access page — inline script (template-trap guard)", () => {
	const script = accessScript();

	test("cooked script parses without a SyntaxError", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("exposes acApprove + acRevoke + acPersist, no backslash escapes / regex", () => {
		expect(script).toContain("acApprove");
		expect(script).toContain("acRevoke");
		expect(script).toContain("acPersist");
		expect(script).toContain("/api/access/approve");
		expect(script).toContain("/api/access/revoke");
		expect(script).toContain("/api/access/persist");
		expect(script).not.toContain("\\");
	});
});
