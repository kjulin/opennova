export {
  loadAgents,
  getAgentCwd,
  getAgentDirectories,
  type AgentConfig,
  type AgentJson,
  type AgentJsonInput,
} from "./agents.js";

export {
  agentsDir,
  agentDir,
  validateAgentId,
} from "./io.js";

export { agentStore } from "./singleton.js";
export type { AgentStore } from "./store.js";

export {
  createAgentManagementMcpServer,
  createSelfManagementMcpServer,
} from "./management.js";

export {
  createAgentsMcpServer,
  type RunAgentFn,
} from "./ask-agent.js";
