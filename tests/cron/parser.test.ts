import { describe, expect, test } from "bun:test";
import { parseCron, nextRun, isValidCron } from "../../src/cron/parser.js";

describe("cron parser", () => {
	test("isValidCron accepts standard expressions", () => {
		expect(isValidCron("* * * * *")).toBe(true);
		expect(isValidCron("0 12 * * *")).toBe(true);
		expect(isValidCron("*/5 * * * *")).toBe(true);
		expect(isValidCron("0 9 1,15 * *")).toBe(true);
		expect(isValidCron("0 0 * * 1-5")).toBe(true);
	});

	test("isValidCron rejects invalid expressions", () => {
		expect(isValidCron("")).toBe(false);
		expect(isValidCron("* * *")).toBe(false);
		expect(isValidCron("60 * * * *")).toBe(false);
		expect(isValidCron("* 25 * * *")).toBe(false);
		expect(isValidCron("* * 32 * *")).toBe(false);
		expect(isValidCron("* * * 13 *")).toBe(false);
		expect(isValidCron("* * * * 8")).toBe(false);
	});

	test("parseCron parses every-minute", () => {
		const schedule = parseCron("* * * * *");
		expect(schedule.minutes).toEqual(Array.from({ length: 60 }, (_, i) => i));
		expect(schedule.hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
	});

	test("parseCron parses specific values", () => {
		const schedule = parseCron("30 9 * * *");
		expect(schedule.minutes).toEqual([30]);
		expect(schedule.hours).toEqual([9]);
	});

	test("parseCron parses step values", () => {
		const schedule = parseCron("*/15 * * * *");
		expect(schedule.minutes).toEqual([0, 15, 30, 45]);
	});

	test("parseCron parses ranges", () => {
		const schedule = parseCron("0 9-17 * * *");
		expect(schedule.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
	});

	test("parseCron parses comma-separated values", () => {
		const schedule = parseCron("0 9,12,18 * * *");
		expect(schedule.hours).toEqual([9, 12, 18]);
	});

	test("nextRun calculates next occurrence", () => {
		const schedule = parseCron("0 12 * * *");
		const after = new Date("2025-06-15T10:00:00Z");
		const next = nextRun(schedule, after);
		expect(next.getUTCHours()).toBe(12);
		expect(next.getUTCMinutes()).toBe(0);
		expect(next.getTime()).toBeGreaterThan(after.getTime());
	});

	test("nextRun wraps to next day if past time", () => {
		const schedule = parseCron("0 8 * * *");
		const after = new Date("2025-06-15T10:00:00Z");
		const next = nextRun(schedule, after);
		expect(next.getUTCDate()).toBe(16);
		expect(next.getUTCHours()).toBe(8);
	});
});
