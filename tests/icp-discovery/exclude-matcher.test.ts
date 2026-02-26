import { describe, expect, test } from "bun:test";
import { isExcluded } from "../../plugins/icp-discovery/lib/exclude-matcher";

describe("isExcluded", () => {
	test("exact match", () => {
		expect(isExcluded("Wingstop", ["Wingstop"])).toBe(true);
	});

	test("case-insensitive exact match", () => {
		expect(isExcluded("wingstop", ["Wingstop"])).toBe(true);
		expect(isExcluded("WINGSTOP", ["wingstop"])).toBe(true);
	});

	test("brand name contains exclude entry (exclude is substring of brand)", () => {
		expect(isExcluded("Jersey Mike's Subs", ["Jersey Mike's"])).toBe(true);
		expect(isExcluded("Wingstop Restaurants", ["Wingstop"])).toBe(true);
	});

	test("exclude entry contains brand name (brand is substring of exclude)", () => {
		expect(isExcluded("Jersey Mike's", ["Jersey Mike's Subs"])).toBe(true);
		expect(isExcluded("Wingstop", ["Wingstop Restaurants Inc."])).toBe(true);
	});

	test("no match returns false", () => {
		expect(isExcluded("Chick-fil-A", ["Wingstop", "Jersey Mike's"])).toBe(
			false,
		);
	});

	test("empty exclude list returns false", () => {
		expect(isExcluded("Wingstop", [])).toBe(false);
	});

	test("whitespace is trimmed", () => {
		expect(isExcluded("  Wingstop  ", ["Wingstop"])).toBe(true);
		expect(isExcluded("Wingstop", ["  Wingstop  "])).toBe(true);
	});

	test("empty exclude entries are skipped", () => {
		expect(isExcluded("Wingstop", ["", "  ", "Wingstop"])).toBe(true);
		expect(isExcluded("Chick-fil-A", ["", "  "])).toBe(false);
	});

	test("multiple exclude entries — matches any", () => {
		const excludes = ["McDonald's", "Subway", "Wingstop"];
		expect(isExcluded("Wingstop Restaurants", excludes)).toBe(true);
		expect(isExcluded("Subway Franchise", excludes)).toBe(true);
		expect(isExcluded("Chick-fil-A", excludes)).toBe(false);
	});
});
