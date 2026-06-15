import { describe, expect, test } from "bun:test";
import type { ApprovedUser } from "../../src/security/access-control.js";
import {
	AccessPage,
	type AccessPageProps,
	type PendingPairing,
	accessScript,
	recognizedIds,
} from "../../src/web/views/access-page.js";

function render(overrides: Partial<AccessPageProps> = {}): string {
	const base: AccessPageProps = {
		enabled: true,
		pending: [],
		approved: [],
		persistedIds: [],
		ownerIds: [],
		open: false,
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

	test("a non-owner approved user gets a 'Make owner' button", () => {
		const html = render({ approved: [approvedUser], ownerIds: [] });
		expect(html).toContain("acOwner(this.dataset.id, true)");
		expect(html).toContain("Make owner");
	});

	test("an owner shows the 'owner' badge, not a 'Make owner' button", () => {
		const html = render({ approved: [approvedUser], ownerIds: ["U07XYZ"] });
		expect(html).toContain("★ owner");
		expect(html).not.toContain("acOwner(this.dataset.id, true)");
	});

	test("renders a prominent OFF banner when access control is open", () => {
		const html = render({ open: true });
		expect(html).toContain("Access control is OFF");
		expect(html).toContain("security.allowUnapprovedExternal");
	});

	test("no OFF banner when access control is enforcing", () => {
		expect(render({ open: false })).not.toContain("Access control is OFF");
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

describe("recognizedIds — robust to a PARTIAL live security config", () => {
	// Regression: liveConfig().security is a shallow override merge, so on prod
	// (config.json has `security: { requireApproval: true }`) allowedUsers/
	// ownerUserIds are undefined. Spreading them directly 500'd GET /access.
	test("partial security (only requireApproval) → [] instead of throwing", () => {
		expect(() =>
			recognizedIds({ requireApproval: true } as never),
		).not.toThrow();
		expect(recognizedIds({ requireApproval: true } as never)).toEqual([]);
	});

	test("undefined / null security → []", () => {
		expect(recognizedIds(undefined)).toEqual([]);
		expect(recognizedIds(null)).toEqual([]);
	});

	test("merges + dedupes allowedUsers and ownerUserIds", () => {
		expect(
			recognizedIds({
				allowedUsers: ["U_A", "U_B"],
				ownerUserIds: ["U_B", "U_OWNER"],
			}).sort(),
		).toEqual(["U_A", "U_B", "U_OWNER"]);
	});
});

describe("access page — config-recognized ids (Owners visible without a DB row)", () => {
	test("an owner with no approved_users row renders in the 'Recognized from config' section", () => {
		// The prod symptom: env/config owner after a DB reset was invisible.
		const html = render({
			approved: [],
			persistedIds: ["U_OWNER"],
			ownerIds: ["U_OWNER"],
		});
		expect(html).toContain("Recognized from config");
		expect(html).toContain("U_OWNER");
		expect(html).toContain("★ owner");
	});

	test("an env-sourced owner is read-only ('from env'), no Remove-owner button", () => {
		const html = render({
			persistedIds: ["U_ENV"],
			ownerIds: ["U_ENV"],
			envIds: ["U_ENV"],
		});
		// the read-only badge (unique title) — not the bare words that also appear
		// in the help text.
		expect(html).toContain("Sourced from PAW_SECURITY_OWNER_USER_IDS");
		expect(html).not.toContain("acOwner(this.dataset.id, false)");
	});

	test("a config (non-env) owner offers a Remove-owner toggle", () => {
		const html = render({
			persistedIds: ["U_OWNER"],
			ownerIds: ["U_OWNER"],
			envIds: [],
		});
		expect(html).toContain("acOwner(this.dataset.id, false)");
		expect(html).not.toContain("Sourced from PAW_SECURITY_OWNER_USER_IDS");
	});

	test("ids that already have an approved row are NOT duplicated into the config section", () => {
		const html = render({
			approved: [approvedUser],
			persistedIds: ["U07XYZ"],
			ownerIds: ["U07XYZ"],
		});
		// U07XYZ shows in the Approved card; the config section is empty → not shown.
		expect(html).not.toContain("Recognized from config");
	});
});

describe("access page — inline script (template-trap guard)", () => {
	const script = accessScript();

	test("cooked script parses without a SyntaxError", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("exposes acApprove + acRevoke + acPersist + acOwner, no backslash escapes / regex", () => {
		expect(script).toContain("acApprove");
		expect(script).toContain("acRevoke");
		expect(script).toContain("acPersist");
		expect(script).toContain("acOwner");
		expect(script).toContain("/api/access/approve");
		expect(script).toContain("/api/access/revoke");
		expect(script).toContain("/api/access/persist");
		expect(script).toContain("/api/access/owner");
		expect(script).not.toContain("\\");
	});
});
