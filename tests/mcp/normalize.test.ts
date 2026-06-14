import { describe, expect, test } from "bun:test";
import {
	dedupeMcpServers,
	normalizeMcpName,
	removeMcpServer,
	upsertMcpServer,
} from "../../src/mcp/normalize.js";

// Mirrors the MCP identifier check in client-manager (isSafeMcpIdentifier).
const MCP_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

describe("normalizeMcpName", () => {
	test("lowercases + trims, stays a valid MCP identifier", () => {
		expect(normalizeMcpName("  HubSpot ")).toBe("hubspot");
		expect(normalizeMcpName("Brave-Search")).toBe("brave-search");
		expect(MCP_NAME_RE.test(normalizeMcpName("HubSpot"))).toBe(true);
	});
});

describe("upsertMcpServer (Bug B — re-add of a different casing updates, never forks)", () => {
	test("adding HubSpot then hubspot yields a single canonical entry", () => {
		let map = upsertMcpServer({}, "HubSpot", { transport: "http", url: "a" });
		map = upsertMcpServer(map, "hubspot", { transport: "http", url: "b" });
		expect(Object.keys(map)).toEqual(["hubspot"]);
		expect((map.hubspot as { url: string }).url).toBe("b"); // updated, not forked
	});
});

describe("removeMcpServer", () => {
	test("drops every case-variant of the name", () => {
		const map = { HubSpot: {}, hubspot: {}, brave: {} };
		const next = removeMcpServer(map, "HUBSPOT");
		expect(Object.keys(next)).toEqual(["brave"]);
	});
});

describe("dedupeMcpServers (one-time cleanup)", () => {
	test("collapses the HubSpot/hubSpot/hubspot trio to one canonical key", () => {
		const { servers, changed } = dedupeMcpServers({
			HubSpot: { v: 1 },
			hubSpot: { v: 2 },
			hubspot: { v: 3 },
			brave: { v: 4 },
		});
		expect(changed).toBe(true);
		expect(Object.keys(servers).sort()).toEqual(["brave", "hubspot"]);
		expect((servers.hubspot as { v: number }).v).toBe(3); // last wins
	});

	test("no-op (changed=false) when already canonical", () => {
		const { servers, changed } = dedupeMcpServers({ hubspot: {}, brave: {} });
		expect(changed).toBe(false);
		expect(Object.keys(servers).sort()).toEqual(["brave", "hubspot"]);
	});
});
