import type { ToolDefinition, ToolResult } from "../../types/message.js";
import type { HubSpotClient, HubSpotSearchFilter } from "./client.js";

export interface HubSpotToolDeps {
	/** Records a security-audit entry for write actions (action, details). */
	audit?: (action: string, details: Record<string, unknown>) => void;
}

/**
 * HubSpot CRM tools (contacts, companies, deals, notes, associations). Grouped
 * under the on-demand `hubspot` skill via `plugin: "hubspot"`. The existing
 * canvas form-receiver path (client.createContact) is untouched. Reads
 * (search/get) are ungated; mutations are audited.
 */
export function createHubSpotTools(
	client: HubSpotClient,
	deps: HubSpotToolDeps = {},
): ToolDefinition[] {
	const audit = deps.audit ?? (() => {});

	async function audited<T>(
		action: string,
		details: Record<string, unknown>,
		fn: () => Promise<T>,
	): Promise<T> {
		try {
			const result = await fn();
			audit(`${action}.ok`, details);
			return result;
		} catch (err) {
			audit(`${action}.fail`, {
				...details,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	const errResult = (err: unknown): ToolResult => ({
		content: `HubSpot error: ${err instanceof Error ? err.message : String(err)}`,
		is_error: true,
	});

	const propsField = {
		type: "object",
		description: "Flat map of HubSpot property names → values.",
	};
	const searchSchema = {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Free-text search across default searchable properties.",
			},
			filters: {
				type: "array",
				description: "Property filters combined with AND.",
				items: {
					type: "object",
					properties: {
						propertyName: {
							type: "string",
							description: "Property to filter.",
						},
						operator: {
							type: "string",
							description:
								"HubSpot operator: EQ, NEQ, GT, LT, CONTAINS_TOKEN, HAS_PROPERTY, …",
						},
						value: { type: "string", description: "Comparison value." },
					},
					required: ["propertyName", "operator"],
				},
			},
			properties: {
				type: "array",
				items: { type: "string" },
				description: "Properties to return on each result.",
			},
			limit: { type: "number", description: "Max results." },
		},
	} as const;

	const searchOpts = (input: Record<string, unknown>) => ({
		query: input.query as string | undefined,
		filters: input.filters as HubSpotSearchFilter[] | undefined,
		properties: input.properties as string[] | undefined,
		limit: input.limit as number | undefined,
	});

	// --- Contacts ---

	const createContact: ToolDefinition = {
		name: "hubspot_create_contact",
		description:
			"Create a HubSpot contact from a flat property map (e.g. email, firstname, lastname, phone, company).",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: { properties: propsField },
			required: ["properties"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await audited("hubspot.create_contact", {}, () =>
					client.createObject(
						"contacts",
						input.properties as Record<string, unknown>,
					),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const searchContacts: ToolDefinition = {
		name: "hubspot_search_contacts",
		description:
			"Search HubSpot contacts by free-text query and/or property filters.",
		plugin: "hubspot",
		input_schema: searchSchema,
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await client.searchContacts(searchOpts(input));
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const getContact: ToolDefinition = {
		name: "hubspot_get_contact",
		description:
			"Fetch a HubSpot contact by id, optionally selecting properties.",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Contact id." },
				properties: {
					type: "array",
					items: { type: "string" },
					description: "Properties to return.",
				},
			},
			required: ["id"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await client.getContact(
					input.id as string,
					input.properties as string[] | undefined,
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const updateContact: ToolDefinition = {
		name: "hubspot_update_contact",
		description: "Update a HubSpot contact's properties by id.",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Contact id." },
				properties: propsField,
			},
			required: ["id", "properties"],
		},
		handler: async (input): Promise<ToolResult> => {
			const id = input.id as string;
			try {
				const res = await audited("hubspot.update_contact", { id }, () =>
					client.updateContact(id, input.properties as Record<string, unknown>),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	// --- Companies ---

	const createCompany: ToolDefinition = {
		name: "hubspot_create_company",
		description:
			"Create a HubSpot company from a flat property map (e.g. name, domain, industry).",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: { properties: propsField },
			required: ["properties"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await audited("hubspot.create_company", {}, () =>
					client.createCompany(input.properties as Record<string, unknown>),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const searchCompanies: ToolDefinition = {
		name: "hubspot_search_companies",
		description:
			"Search HubSpot companies by free-text query and/or property filters.",
		plugin: "hubspot",
		input_schema: searchSchema,
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await client.searchCompanies(searchOpts(input));
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const getCompany: ToolDefinition = {
		name: "hubspot_get_company",
		description:
			"Fetch a HubSpot company by id, optionally selecting properties.",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Company id." },
				properties: {
					type: "array",
					items: { type: "string" },
					description: "Properties to return.",
				},
			},
			required: ["id"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await client.getCompany(
					input.id as string,
					input.properties as string[] | undefined,
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const updateCompany: ToolDefinition = {
		name: "hubspot_update_company",
		description: "Update a HubSpot company's properties by id.",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Company id." },
				properties: propsField,
			},
			required: ["id", "properties"],
		},
		handler: async (input): Promise<ToolResult> => {
			const id = input.id as string;
			try {
				const res = await audited("hubspot.update_company", { id }, () =>
					client.updateCompany(id, input.properties as Record<string, unknown>),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	// --- Deals ---

	const createDeal: ToolDefinition = {
		name: "hubspot_create_deal",
		description:
			"Create a HubSpot deal from a flat property map (e.g. dealname, amount, dealstage, pipeline).",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: { properties: propsField },
			required: ["properties"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await audited("hubspot.create_deal", {}, () =>
					client.createDeal(input.properties as Record<string, unknown>),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const getDeal: ToolDefinition = {
		name: "hubspot_get_deal",
		description: "Fetch a HubSpot deal by id, optionally selecting properties.",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Deal id." },
				properties: {
					type: "array",
					items: { type: "string" },
					description: "Properties to return.",
				},
			},
			required: ["id"],
		},
		handler: async (input): Promise<ToolResult> => {
			try {
				const res = await client.getDeal(
					input.id as string,
					input.properties as string[] | undefined,
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const updateDeal: ToolDefinition = {
		name: "hubspot_update_deal",
		description:
			"Update a HubSpot deal's properties by id (e.g. move stage via dealstage).",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Deal id." },
				properties: propsField,
			},
			required: ["id", "properties"],
		},
		handler: async (input): Promise<ToolResult> => {
			const id = input.id as string;
			try {
				const res = await audited("hubspot.update_deal", { id }, () =>
					client.updateDeal(id, input.properties as Record<string, unknown>),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	// --- Notes + associations ---

	const createNote: ToolDefinition = {
		name: "hubspot_create_note",
		description:
			"Create a note, optionally associated to a contact, company, or deal.",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				body: { type: "string", description: "Note body text." },
				associateToType: {
					type: "string",
					description:
						"Object type to associate (e.g. contacts, companies, deals).",
				},
				associateToId: {
					type: "string",
					description: "Id of the object to associate the note with.",
				},
			},
			required: ["body"],
		},
		handler: async (input): Promise<ToolResult> => {
			const type = input.associateToType as string | undefined;
			const id = input.associateToId as string | undefined;
			try {
				const res = await audited(
					"hubspot.create_note",
					{ associateToType: type, associateToId: id },
					() =>
						client.createNote({
							body: input.body as string,
							associateTo: type && id ? { type, id } : undefined,
						}),
				);
				return { content: JSON.stringify(res) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	const associate: ToolDefinition = {
		name: "hubspot_associate",
		description:
			"Associate two HubSpot records using the default association (e.g. link a contact to a company, or a deal to a contact).",
		plugin: "hubspot",
		input_schema: {
			type: "object",
			properties: {
				fromType: { type: "string", description: "Source object type." },
				fromId: { type: "string", description: "Source object id." },
				toType: { type: "string", description: "Target object type." },
				toId: { type: "string", description: "Target object id." },
			},
			required: ["fromType", "fromId", "toType", "toId"],
		},
		handler: async (input): Promise<ToolResult> => {
			const details = {
				fromType: input.fromType,
				fromId: input.fromId,
				toType: input.toType,
				toId: input.toId,
			};
			try {
				await audited("hubspot.associate", details, () =>
					client.associate(
						input.fromType as string,
						input.fromId as string,
						input.toType as string,
						input.toId as string,
					),
				);
				return { content: JSON.stringify({ associated: true, ...details }) };
			} catch (err) {
				return errResult(err);
			}
		},
	};

	return [
		createContact,
		searchContacts,
		getContact,
		updateContact,
		createCompany,
		searchCompanies,
		getCompany,
		updateCompany,
		createDeal,
		getDeal,
		updateDeal,
		createNote,
		associate,
	];
}
