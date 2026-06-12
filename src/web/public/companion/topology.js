/**
 * CompanionTopology — multi-agent beam attribution.
 *
 * A skill beam routes to the *acting* node: if an op was attributed to a spawned
 * sub-agent (by agentName), the beam targets that agent's orb; otherwise it
 * targets the orchestrator (the avatar). Spawned agents keep a persistent faint
 * orchestrator link; ops-feed chips carry an agent badge when a sub-agent ran
 * the op.
 */
(() => {
	/**
	 * @param {{agentName?:string|null}} op
	 * @param {Array<{id,name}>} agents
	 * @returns {{kind:'agent', id:string} | {kind:'avatar'}}
	 */
	function beamTarget(op, agents) {
		const name = op && op.agentName;
		if (name && agents) {
			for (let i = 0; i < agents.length; i++) {
				if (agents[i].name === name || agents[i].id === name) {
					return { kind: "agent", id: agents[i].id };
				}
			}
		}
		return { kind: "avatar" };
	}

	window.CompanionTopology = { beamTarget };
})();
