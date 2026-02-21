import type { AgentConfig } from "../agents.js";
import type { TrustLevel } from "../schemas.js";
import type { ChannelType } from "../threads.js";

import { TRUST_INSTRUCTIONS } from "./security.js";
import { STORAGE_INSTRUCTIONS, buildMemoryPrompt } from "./memory.js";
import { getFormattingInstructions } from "./formatting.js";
import { buildContextBlock } from "./context.js";
import { buildDirectoriesBlock } from "./directories.js";

const COMMUNICATION_INSTRUCTIONS = `
<Communication>
When asking questions, ask one thing at a time. Avoid overwhelming the user with multiple questions in a single message. Wait for their response before asking follow-up questions.
</Communication>`;

function buildRoleBlock(agent: AgentConfig): string {
  // New format: identity + instructions
  if (agent.identity) {
    const parts: string[] = [`<Identity>\n${agent.identity}\n</Identity>`];
    if (agent.instructions) {
      parts.push(`<Instructions>\n${agent.instructions}\n</Instructions>`);
    }
    return parts.join("\n\n");
  }

  // Legacy format: role
  return `<Role>\n${agent.role}\n</Role>`;
}

export function buildSystemPrompt(
  agent: AgentConfig,
  channel: ChannelType,
  trust: TrustLevel,
  cwd: string,
  directories: string[]
): string {
  const memories = buildMemoryPrompt();
  const dirBlock = buildDirectoriesBlock(cwd, directories, trust);
  const formatting = getFormattingInstructions(channel);
  const storageInstructions = trust !== "sandbox" ? STORAGE_INSTRUCTIONS : "";

  return `${buildRoleBlock(agent)}\n${TRUST_INSTRUCTIONS[trust]}${dirBlock}${storageInstructions}\n${formatting}${COMMUNICATION_INSTRUCTIONS}${buildContextBlock()}${memories}`;
}
