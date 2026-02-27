import type { Logger } from "../types/plugin.js";
import type { AgentDefinition } from "./types.js";

export class AgentRegistry {
	private agents = new Map<string, AgentDefinition>();
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	register(agent: AgentDefinition): void {
		if (this.agents.has(agent.name)) {
			this.logger.warn("Overwriting existing agent definition", {
				name: agent.name,
			});
		}
		this.agents.set(agent.name, agent);
		this.logger.info("Agent registered", { name: agent.name });
	}

	get(name: string): AgentDefinition | undefined {
		return this.agents.get(name);
	}

	list(): AgentDefinition[] {
		return Array.from(this.agents.values());
	}

	has(name: string): boolean {
		return this.agents.has(name);
	}

	remove(name: string): boolean {
		const existed = this.agents.delete(name);
		if (existed) {
			this.logger.info("Agent removed", { name });
		}
		return existed;
	}

	/** Load agent definitions from config. */
	loadFromConfig(agents: Record<string, Omit<AgentDefinition, "name">>): void {
		for (const [name, def] of Object.entries(agents)) {
			this.register({ name, ...def });
		}
	}

	/** Get agent names for use in tool enum. */
	get agentNames(): string[] {
		return Array.from(this.agents.keys());
	}

	get size(): number {
		return this.agents.size;
	}
}
