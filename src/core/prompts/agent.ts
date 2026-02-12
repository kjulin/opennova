import type { AgentConfig } from "../agents.js";
import type { SecurityLevel } from "../schemas.js";
import type { ChannelType } from "../threads.js";

import { SECURITY_INSTRUCTIONS } from "./security.js";
import { STORAGE_INSTRUCTIONS, buildMemoryPrompt } from "./memory.js";
import { getFormattingInstructions } from "./formatting.js";
import { buildContextBlock } from "./context.js";
import { buildDirectoriesBlock } from "./directories.js";

const COMMUNICATION_INSTRUCTIONS = `
<Communication>
When asking questions, ask one thing at a time. Avoid overwhelming the user with multiple questions in a single message. Wait for their response before asking follow-up questions.
</Communication>`;

function buildRoleBlock(agent: AgentConfig): string {
  // New format: identity + working_arrangement
  if (agent.identity) {
    const parts: string[] = [`<Identity>\n${agent.identity}\n</Identity>`];
    if (agent.working_arrangement) {
      parts.push(`<WorkingArrangement>\n${agent.working_arrangement}\n</WorkingArrangement>`);
    }
    return parts.join("\n\n");
  }

  // Legacy format: role
  return `<Role>\n${agent.role}\n</Role>`;
}

export function buildSystemPrompt(
  agent: AgentConfig,
  channel: ChannelType,
  security: SecurityLevel,
  cwd: string,
  directories: string[]
): string {
  const memories = buildMemoryPrompt();
  const dirBlock = buildDirectoriesBlock(cwd, directories, security);
  const formatting = getFormattingInstructions(channel);
  const storageInstructions = security !== "sandbox" ? STORAGE_INSTRUCTIONS : "";

  return `${buildRoleBlock(agent)}\n${SECURITY_INSTRUCTIONS[security]}${dirBlock}${storageInstructions}\n${formatting}${COMMUNICATION_INSTRUCTIONS}${buildContextBlock()}${memories}`;
}
