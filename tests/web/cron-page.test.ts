import { describe, expect, test } from "bun:test";
import { CronPage, cronScript } from "../../src/web/views/cron-page.js";
import { CRON_ALLOWED_EVENTS } from "../../src/cron/scheduler.js";

const TOOLS = [
	{
		name: "check_system_health",
		plugin: "kernel",
		description: "Report kernel/system health",
	},
	{ name: "send_email", plugin: "mail", description: "Send an email" },
];

describe("cron page — type-aware action fields", () => {
	test("renders a tool option per registered tool with a 'name — plugin' label", () => {
		const html = String(CronPage({ jobs: [], tools: TOOLS }));
		// The user no longer has to guess a tool name — it is a real option.
		expect(html).toContain('value="check_system_health"');
		expect(html).toContain("check_system_health — kernel");
		expect(html).toContain('value="send_email"');
		expect(html).toContain("send_email — mail");
		// description surfaces as the option tooltip
		expect(html).toContain('title="Report kernel/system health"');
	});

	test("event dropdown shows exactly the allowlist — no more, no less", () => {
		const html = String(CronPage({ jobs: [], tools: TOOLS }));
		const allowed = [...CRON_ALLOWED_EVENTS];
		for (const event of allowed) {
			expect(html).toContain(`value="${event}"`);
		}
		// Count rendered option values inside the event field group.
		const eventGroup = html.slice(html.indexOf('data-cron-field="event"'));
		const optionCount = (eventGroup.match(/<option/g) ?? []).length;
		expect(optionCount).toBe(allowed.length);
	});

	test("each action type has its own field group + the type selector wires the script", () => {
		const html = String(CronPage({ jobs: [], tools: TOOLS }));
		expect(html).toContain('data-cron-field="prompt"');
		expect(html).toContain('data-cron-field="tool"');
		expect(html).toContain('data-cron-field="event"');
		expect(html).toContain('id="cron-action-type"');
		expect(html).toContain("pawCronSync()");
		// optional tool args field
		expect(html).toContain('name="toolArgs"');
	});
});

describe("cron page — inline script (template-trap guard)", () => {
	const script = cronScript();

	test("cooked script parses without a SyntaxError", () => {
		expect(() => new Function(script)).not.toThrow();
	});

	test("exposes pawCronSync and toggles by data-cron-field", () => {
		expect(script).toContain("pawCronSync");
		expect(script).toContain("data-cron-field");
		// no backslash escapes / regex literals snuck in
		expect(script).not.toContain("\\");
	});
});
