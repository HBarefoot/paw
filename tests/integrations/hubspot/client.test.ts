import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SkillManager } from "../../../src/ai/skills.js";
import { ToolRegistry } from "../../../src/ai/tools.js";
import {
	HubSpotClient,
	HubSpotError,
} from "../../../src/integrations/hubspot/client.js";
import { createHubSpotTools } from "../../../src/integrations/hubspot/tools.js";

const TOKEN = "pat-test-123";

interface Captured {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

let calls: Captured[];
let originalFetch: typeof globalThis.fetch;

function mockFetch(status: number, payload: unknown) {
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const u =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		calls.push({
			url: u,
			method: init?.method,
			headers: init?.headers as Record<string, string> | undefined,
			body: init?.body as string | undefined,
		});
		return new Response(
			typeof payload === "string" ? payload : JSON.stringify(payload),
			{ status, headers: { "Content-Type": "application/json" } },
		);
	}) as typeof globalThis.fetch;
}

beforeEach(() => {
	calls = [];
	originalFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const makeClient = () => new HubSpotClient({ token: TOKEN });

describe("HubSpotClient", () => {
	test("existing createContact path is unchanged", async () => {
		mockFetch(201, { id: "c1" });
		const res = await makeClient().createContact({
			email: "a@b.c",
			firstname: "Ada",
		});
		expect(res).toEqual({ id: "c1" });
		expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
		expect(calls[0].method).toBe("POST");
		expect(calls[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
		expect(JSON.parse(calls[0].body ?? "")).toEqual({
			properties: { email: "a@b.c", firstname: "Ada" },
		});
	});

	test("createDeal posts to the deals object", async () => {
		mockFetch(201, { id: "d1" });
		const res = await makeClient().createDeal({
			dealname: "Big one",
			amount: 1000,
		});
		expect(res.id).toBe("d1");
		expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/deals");
		// numbers are coerced to strings for HubSpot properties
		expect(JSON.parse(calls[0].body ?? "").properties.amount).toBe("1000");
	});

	test("searchContacts posts query + filterGroups", async () => {
		mockFetch(200, { total: 1, results: [{ id: "c1" }] });
		const res = await makeClient().searchContacts({
			query: "ada",
			filters: [{ propertyName: "email", operator: "EQ", value: "a@b.c" }],
			limit: 5,
		});
		expect(res.results[0].id).toBe("c1");
		expect(calls[0].url).toBe(
			"https://api.hubapi.com/crm/v3/objects/contacts/search",
		);
		const body = JSON.parse(calls[0].body ?? "");
		expect(body.query).toBe("ada");
		expect(body.filterGroups).toEqual([
			{ filters: [{ propertyName: "email", operator: "EQ", value: "a@b.c" }] },
		]);
		expect(body.limit).toBe(5);
	});

	test("getContact GETs with selected properties", async () => {
		mockFetch(200, { id: "c1", properties: { email: "a@b.c" } });
		await makeClient().getContact("c1", ["email", "firstname"]);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].url).toBe(
			"https://api.hubapi.com/crm/v3/objects/contacts/c1?properties=email,firstname",
		);
	});

	test("updateDeal PATCHes the deal by id", async () => {
		mockFetch(200, { id: "d1" });
		await makeClient().updateDeal("d1", { dealstage: "closedwon" });
		expect(calls[0].method).toBe("PATCH");
		expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/deals/d1");
		expect(JSON.parse(calls[0].body ?? "").properties).toEqual({
			dealstage: "closedwon",
		});
	});

	test("associate PUTs the v4 default association", async () => {
		mockFetch(200, {});
		await makeClient().associate("contacts", "c1", "companies", "co1");
		expect(calls[0].method).toBe("PUT");
		expect(calls[0].url).toBe(
			"https://api.hubapi.com/crm/v4/objects/contacts/c1/associations/default/companies/co1",
		);
	});

	test("createNote creates the note then associates it", async () => {
		mockFetch(201, { id: "n1" });
		await makeClient().createNote({
			body: "Called the lead",
			associateTo: { type: "contacts", id: "c1" },
			timestamp: "2026-01-01T00:00:00Z",
		});
		expect(calls).toHaveLength(2);
		expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/notes");
		expect(JSON.parse(calls[0].body ?? "").properties).toEqual({
			hs_note_body: "Called the lead",
			hs_timestamp: "2026-01-01T00:00:00Z",
		});
		expect(calls[1].url).toBe(
			"https://api.hubapi.com/crm/v4/objects/notes/n1/associations/default/contacts/c1",
		);
	});

	test("non-2xx throws a typed HubSpotError", async () => {
		mockFetch(401, "unauthorized");
		await expect(
			makeClient().searchContacts({ query: "x" }),
		).rejects.toBeInstanceOf(HubSpotError);
	});
});

describe("hubspot skill registration", () => {
	test("tools form a single on-demand skill with the full CRM surface", () => {
		const registry = new ToolRegistry();
		registry.register(createHubSpotTools(makeClient()));
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		const skill = skills.getSkill("hubspot");
		expect(skill).toBeDefined();
		expect(skill?.alwaysActive).toBe(false);
		expect(skill?.toolNames).toContain("hubspot_create_contact");
		expect(skill?.toolNames).toContain("hubspot_create_deal");
		expect(skill?.toolNames).toContain("hubspot_associate");
		expect(skill?.toolNames.length).toBe(13);
	});

	test("config absent → no hubspot skill, zero behavior change", () => {
		const registry = new ToolRegistry();
		const skills = new SkillManager();
		skills.buildFromRegistry(registry);
		expect(skills.getSkill("hubspot")).toBeUndefined();
	});
});
