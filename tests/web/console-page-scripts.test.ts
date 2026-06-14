import { describe, expect, test } from "bun:test";
import { cronScript as getCronScriptForTest } from "../../src/web/views/cron-page.js";
import { getHeartbeatScript } from "../../src/web/views/heartbeat-page.js";
import { getNotificationsScript } from "../../src/web/views/notifications-page.js";
import { getSettingsScript } from "../../src/web/views/settings-page.js";
import { getSubmissionsScript } from "../../src/web/views/submissions-page.js";

// Every page that ships an inline <script> as a template literal is subject to
// the inline-script-template-trap (a mis-cooked backslash blanks the page).
// Cooking each script and compiling it with `new Function` catches that without
// a browser — the same guard chat.tsx / prompts-page use.
describe("console page client scripts cook + parse (template-trap guard)", () => {
	const scripts: Record<string, string> = {
		notifications: getNotificationsScript(),
		cron: getCronScriptForTest(),
		submissions: getSubmissionsScript(),
		heartbeat: getHeartbeatScript(),
		settings: getSettingsScript(),
	};

	for (const [name, script] of Object.entries(scripts)) {
		test(`${name} script parses`, () => {
			expect(() => new Function(script)).not.toThrow();
		});
		test(`${name} script carries no raw backslash escapes`, () => {
			// The trap is specifically backslashes cooked away by the template
			// literal. None of these scripts need regex/escapes.
			expect(script.includes("\\")).toBe(false);
		});
	}

	test("notifications: unread filter + mark endpoints", () => {
		const s = scripts.notifications;
		expect(s).toContain("function notifOnlyUnread(");
		expect(s).toContain('"/api/notifications/read"');
	});

	test("cron: toggle/delete hit the real endpoints", () => {
		const s = scripts.cron;
		expect(s).toContain("/api/cron/jobs/");
		expect(s).toContain("function pawCronSync(");
	});

	test("submissions: client-side select + JSON export (no fake backend)", () => {
		const s = scripts.submissions;
		expect(s).toContain("function selectSub(");
		expect(s).toContain("function exportSub(");
		expect(s).toContain("application/json");
	});

	test("heartbeat: polls the real metrics endpoint", () => {
		const s = scripts.heartbeat;
		expect(s).toContain('"/api/heartbeat/metrics"');
		expect(s).toContain("function hbPoll(");
	});

	test("settings: set-nav switching + posts to /settings save handler", () => {
		const s = scripts.settings;
		expect(s).toContain("function settingsSelect(");
		expect(s).toContain("function pawToggle(");
		// brand + n8n + secrets functionality folded in
		expect(s).toContain("window.brandSave");
		expect(s).toContain("window.reconnectN8n");
		expect(s).toContain("window.rotateSecret");
		expect(s).toContain('getElementById("settings-form")');
	});
});
