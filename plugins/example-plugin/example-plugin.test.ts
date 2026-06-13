import { describe, expect, test } from "bun:test";
import { createTools } from "./tools.js";

describe("example-plugin plugin tools", () => {
	test("registers its tools", () => {
		const names = createTools().map((t) => t.name);
		expect(names).toContain("fetch_data");
		expect(names).toContain("cache_result");
	});

	test("stubs return 'not implemented' until you fill them in", async () => {
		const tool = createTools().find((t) => t.name === "fetch_data");
		const res = await tool?.handler({});
		expect(res?.content).toContain("not implemented");
	});
});
