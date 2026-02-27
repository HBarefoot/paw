import { describe, expect, test } from "bun:test";
import { parseLocationCount } from "../../plugins/icp-discovery/tools/discover-franchises";

describe("parseLocationCount", () => {
	test("plain integer", () => {
		expect(parseLocationCount("1500")).toBe(1500);
	});

	test("integer with commas", () => {
		expect(parseLocationCount("1,500")).toBe(1500);
		expect(parseLocationCount("14,000")).toBe(14000);
	});

	test("k suffix", () => {
		expect(parseLocationCount("1.2k")).toBe(1200);
		expect(parseLocationCount("20.5k")).toBe(20500);
		expect(parseLocationCount("1k")).toBe(1000);
	});

	test("m suffix", () => {
		expect(parseLocationCount("1.5m")).toBe(1500000);
		expect(parseLocationCount("2m")).toBe(2000000);
	});

	test("K suffix uppercase (lowercased internally)", () => {
		expect(parseLocationCount("1.2K")).toBe(1200);
	});

	test("with surrounding text", () => {
		expect(parseLocationCount("about 1,500 locations")).toBe(1500);
		expect(parseLocationCount("approximately 3.5k")).toBe(3500);
	});

	test("returns 0 for no number", () => {
		expect(parseLocationCount("")).toBe(0);
		expect(parseLocationCount("unknown")).toBe(0);
		expect(parseLocationCount("N/A")).toBe(0);
	});

	test("returns 0 for zero", () => {
		expect(parseLocationCount("0")).toBe(0);
	});

	test("decimal without suffix rounds", () => {
		expect(parseLocationCount("1500.7")).toBe(1501);
	});
});
