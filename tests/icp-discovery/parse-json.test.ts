import { describe, expect, test } from "bun:test";
import { stripCodeFences } from "../../plugins/icp-discovery/lib/parse-json";

describe("stripCodeFences", () => {
	test("extracts JSON from markdown code fence", () => {
		const input = '```json\n{"key": "value"}\n```';
		expect(stripCodeFences(input)).toBe('{"key": "value"}');
	});

	test("returns object as-is when no fence", () => {
		const input = '{"key": "value"}';
		expect(stripCodeFences(input)).toBe('{"key": "value"}');
	});

	test("returns array as-is when no fence", () => {
		const input = '[{"brandName": "Subway"}]';
		expect(stripCodeFences(input)).toBe('[{"brandName": "Subway"}]');
	});

	test("extracts array from markdown code fence", () => {
		const input = '```json\n[{"brandName": "Subway"}]\n```';
		expect(stripCodeFences(input)).toBe('[{"brandName": "Subway"}]');
	});

	test("extracts array from narrative text", () => {
		const input =
			'Here are the brands I found:\n[{"brandName": "Subway"}, {"brandName": "Wingstop"}]\nThose are the results.';
		const result = stripCodeFences(input);
		const parsed = JSON.parse(result);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(2);
		expect(parsed[0].brandName).toBe("Subway");
	});

	test("extracts object from narrative text", () => {
		const input = 'The result is: {"companyName": "Subway", "hq": "Miami"}';
		const result = stripCodeFences(input);
		expect(JSON.parse(result)).toEqual({
			companyName: "Subway",
			hq: "Miami",
		});
	});

	test("prefers array when it appears before object in text", () => {
		const input = 'Results: [{"a": 1}] and also {"b": 2}';
		const result = stripCodeFences(input);
		expect(JSON.parse(result)).toEqual([{ a: 1 }]);
	});

	test("prefers object when it appears before array in text", () => {
		const input = 'Results: {"b": 2} and also [{"a": 1}]';
		const result = stripCodeFences(input);
		expect(JSON.parse(result)).toEqual({ b: 2 });
	});

	test("handles nested brackets in arrays", () => {
		const input = '[{"brands": [{"name": "A"}, {"name": "B"}]}]';
		const result = stripCodeFences(input);
		const parsed = JSON.parse(result);
		expect(parsed[0].brands).toHaveLength(2);
	});

	test("returns original text when no JSON found", () => {
		const input = "No JSON here at all";
		expect(stripCodeFences(input)).toBe("No JSON here at all");
	});
});
