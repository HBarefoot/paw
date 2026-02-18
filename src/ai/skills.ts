import type { ToolDefinition } from "../types/message.js";
import type { ToolRegistry } from "./tools.js";

export interface SkillEntry {
  name: string;
  description: string;
  toolNames: string[];
  alwaysActive: boolean;
}

export class SkillManager {
  private skills = new Map<string, SkillEntry>();
  private activeSkills = new Map<string, Set<string>>();

  buildFromRegistry(registry: ToolRegistry): void {
    this.skills.clear();

    const groups = new Map<string, { tools: string[]; alwaysActive: boolean }>();

    for (const tool of registry.allTools()) {
      const skillName = this.deriveSkillName(tool);
      const isAlwaysOn = skillName === "memory";

      if (!groups.has(skillName)) {
        groups.set(skillName, { tools: [], alwaysActive: isAlwaysOn });
      }
      groups.get(skillName)!.tools.push(tool.name);
    }

    for (const [name, group] of groups) {
      this.skills.set(name, {
        name,
        description: this.deriveDescription(name),
        toolNames: group.tools,
        alwaysActive: group.alwaysActive,
      });
    }
  }

  private deriveSkillName(tool: ToolDefinition): string {
    if (tool.plugin === "kernel") {
      return tool.name.startsWith("memory_") ? "memory" : "files";
    }
    return tool.plugin;
  }

  private deriveDescription(skillName: string): string {
    const descriptions: Record<string, string> = {
      memory: "Store, recall, and forget information across conversations.",
      files: "Read, write, and list files; run shell commands in the workspace.",
      slack: "Post messages and add reactions in Slack.",
      "web-pilot": "Browse the web: navigate, click, fill forms, take screenshots.",
    };
    if (descriptions[skillName]) return descriptions[skillName];
    if (skillName.startsWith("mcp:")) {
      return `Tools from MCP server "${skillName.slice(4)}".`;
    }
    return `Tools from the ${skillName} plugin.`;
  }

  getCatalogPrompt(): string {
    const deferred = Array.from(this.skills.values()).filter((s) => !s.alwaysActive);
    if (deferred.length === 0) return "";

    const lines = deferred.map(
      (s) => `- **${s.name}** (${s.toolNames.length} tools): ${s.description}`,
    );
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
        for (const t of skill.toolNames) names.add(t);
      }
    }

    const active = this.activeSkills.get(sessionId);
    if (active) {
      for (const skillName of active) {
        const skill = this.skills.get(skillName);
        if (skill) {
          for (const t of skill.toolNames) names.add(t);
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

  applyOverrides(overrides: Record<string, { description?: string; alwaysActive?: boolean }>): void {
    for (const [name, override] of Object.entries(overrides)) {
      const skill = this.skills.get(name);
      if (!skill) continue;
      if (override.description !== undefined) skill.description = override.description;
      if (override.alwaysActive !== undefined) skill.alwaysActive = override.alwaysActive;
    }
  }

  toOverrides(): Record<string, { description?: string; alwaysActive?: boolean }> {
    const result: Record<string, { description?: string; alwaysActive?: boolean }> = {};
    for (const skill of this.skills.values()) {
      const defaultDesc = this.deriveDescription(skill.name);
      const defaultAlwaysActive = skill.name === "memory";
      const hasDescOverride = skill.description !== defaultDesc;
      const hasActiveOverride = skill.alwaysActive !== defaultAlwaysActive;
      if (hasDescOverride || hasActiveOverride) {
        result[skill.name] = {};
        if (hasDescOverride) result[skill.name].description = skill.description;
        if (hasActiveOverride) result[skill.name].alwaysActive = skill.alwaysActive;
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
