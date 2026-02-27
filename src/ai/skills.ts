import type { ToolDefinition } from "../types/message.js";
import type { ToolRegistry } from "./tools.js";

export interface SkillEntry {
	name: string;
	description: string;
	toolNames: string[];
	toolDescriptions: Record<string, string>;
	alwaysActive: boolean;
	disabledTools: string[];
}

export class SkillManager {
	private skills = new Map<string, SkillEntry>();
	private activeSkills = new Map<string, Set<string>>();

	buildFromRegistry(registry: ToolRegistry): void {
		this.skills.clear();

		const groups = new Map<
			string,
			{
				tools: string[];
				descriptions: Record<string, string>;
				alwaysActive: boolean;
			}
		>();

		for (const tool of registry.allTools()) {
			const skillName = this.deriveSkillName(tool);
			const isAlwaysOn = skillName === "memory" || skillName === "core";

			if (!groups.has(skillName)) {
				groups.set(skillName, {
					tools: [],
					descriptions: {},
					alwaysActive: isAlwaysOn,
				});
			}
			const group = groups.get(skillName)!;
			group.tools.push(tool.name);
			group.descriptions[tool.name] = tool.description;
		}

		for (const [name, group] of groups) {
			this.skills.set(name, {
				name,
				description: this.deriveDescription(name),
				toolNames: group.tools,
				toolDescriptions: group.descriptions,
				alwaysActive: group.alwaysActive,
				disabledTools: [],
			});
		}
	}

	private deriveSkillName(tool: ToolDefinition): string {
		if (tool.plugin === "kernel") {
			if (tool.name.startsWith("memory_")) return "memory";
			if (tool.name === "spawn_agent" || tool.name === "activate_skill")
				return "core";
			return "files";
		}
		return tool.plugin;
	}

	private deriveDescription(skillName: string): string {
		const descriptions: Record<string, string> = {
			core: "Spawn sub-agents and activate skills.",
			memory: "Store, recall, and forget information across conversations.",
			files:
				"Read, write, and list files; run shell commands in the workspace.",
			slack: "Post messages and add reactions in Slack.",
			"web-pilot":
				"Browse the web: navigate, click, fill forms, take screenshots.",
		};
		if (descriptions[skillName]) return descriptions[skillName];
		if (skillName.startsWith("mcp:")) {
			return `Tools from MCP server "${skillName.slice(4)}".`;
		}
		return `Tools from the ${skillName} plugin.`;
	}

	getCatalogPrompt(): string {
		const deferred = Array.from(this.skills.values()).filter(
			(s) => !s.alwaysActive,
		);
		if (deferred.length === 0) return "";

		const lines = deferred.map((s) => {
			const enabled = s.toolNames.length - s.disabledTools.length;
			const total = s.toolNames.length;
			const count =
				enabled < total ? `${enabled}/${total} tools` : `${total} tools`;
			return `- **${s.name}** (${count}): ${s.description}`;
		});
		return [
			"\n## Available Skills",
			"You can activate additional tool sets by calling the `activate_skill` tool. Available skills:",
			...lines,
			"\nOnly activate a skill when you need its tools for the current task.",
		].join("\n");
	}

	activateSkill(sessionId: string, skillName: string): SkillEntry | null {
		const skill = this.skills.get(skillName);
		if (!skill) return null;

		if (!this.activeSkills.has(sessionId)) {
			this.activeSkills.set(sessionId, new Set());
		}
		this.activeSkills.get(sessionId)!.add(skillName);
		return skill;
	}

	getActiveToolNames(sessionId: string): Set<string> {
		const names = new Set<string>();

		for (const skill of this.skills.values()) {
			if (skill.alwaysActive) {
				for (const t of skill.toolNames) {
					if (!skill.disabledTools.includes(t)) names.add(t);
				}
			}
		}

		const active = this.activeSkills.get(sessionId);
		if (active) {
			for (const skillName of active) {
				const skill = this.skills.get(skillName);
				if (skill) {
					for (const t of skill.toolNames) {
						if (!skill.disabledTools.includes(t)) names.add(t);
					}
				}
			}
		}

		return names;
	}

	clearSession(sessionId: string): void {
		this.activeSkills.delete(sessionId);
	}

	get skillNames(): string[] {
		return Array.from(this.skills.keys());
	}

	getAllSkills(): SkillEntry[] {
		return Array.from(this.skills.values());
	}

	getSkill(name: string): SkillEntry | undefined {
		return this.skills.get(name);
	}

	setAlwaysActive(name: string, value: boolean): void {
		const skill = this.skills.get(name);
		if (skill) skill.alwaysActive = value;
	}

	setDescription(name: string, value: string): void {
		const skill = this.skills.get(name);
		if (skill) skill.description = value;
	}

	setToolEnabled(skillName: string, toolName: string, enabled: boolean): void {
		const skill = this.skills.get(skillName);
		if (!skill) return;
		if (enabled) {
			skill.disabledTools = skill.disabledTools.filter((t) => t !== toolName);
		} else {
			if (!skill.disabledTools.includes(toolName)) {
				skill.disabledTools.push(toolName);
			}
		}
	}

	applyOverrides(
		overrides: Record<
			string,
			{ description?: string; alwaysActive?: boolean; disabledTools?: string[] }
		>,
	): void {
		for (const [name, override] of Object.entries(overrides)) {
			const skill = this.skills.get(name);
			if (!skill) continue;
			if (override.description !== undefined)
				skill.description = override.description;
			if (override.alwaysActive !== undefined)
				skill.alwaysActive = override.alwaysActive;
			if (override.disabledTools !== undefined)
				skill.disabledTools = override.disabledTools;
		}
	}

	toOverrides(): Record<
		string,
		{ description?: string; alwaysActive?: boolean; disabledTools?: string[] }
	> {
		const result: Record<
			string,
			{ description?: string; alwaysActive?: boolean; disabledTools?: string[] }
		> = {};
		for (const skill of this.skills.values()) {
			const defaultDesc = this.deriveDescription(skill.name);
			const defaultAlwaysActive =
				skill.name === "memory" || skill.name === "core";
			const hasDescOverride = skill.description !== defaultDesc;
			const hasActiveOverride = skill.alwaysActive !== defaultAlwaysActive;
			const hasDisabledTools = skill.disabledTools.length > 0;
			if (hasDescOverride || hasActiveOverride || hasDisabledTools) {
				result[skill.name] = {};
				if (hasDescOverride) result[skill.name].description = skill.description;
				if (hasActiveOverride)
					result[skill.name].alwaysActive = skill.alwaysActive;
				if (hasDisabledTools)
					result[skill.name].disabledTools = skill.disabledTools;
			}
		}
		return result;
	}

	createActivateSkillTool(): ToolDefinition {
		const catalog = Array.from(this.skills.values())
			.filter((s) => !s.alwaysActive)
			.map((s) => s.name);

		return {
			name: "activate_skill",
			description:
				"Load a skill to gain access to its tools. Available skills: " +
				catalog.join(", ") +
				". Call this before using tools from a skill that isn't yet active.",
			input_schema: {
				type: "object",
				properties: {
					skill: {
						type: "string",
						description: "Name of the skill to activate",
						enum: catalog,
					},
				},
				required: ["skill"],
			},
			plugin: "kernel",
			handler: async () => {
				return { content: "Skill activation is handled by the runtime." };
			},
		};
	}
}
