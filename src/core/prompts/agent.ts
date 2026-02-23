import type { AgentConfig } from "../agents.js";
import type { ChannelType } from "../threads.js";
import type { Task } from "#tasks/types.js";

import { STORAGE_INSTRUCTIONS, buildMemoryPrompt } from "./memory.js";
import { getFormattingInstructions } from "./formatting.js";
import { buildContextBlock } from "./context.js";
import { buildDirectoriesBlock } from "./directories.js";

function buildIdentityBlock(agent: AgentConfig): string {
  const parts: string[] = [];
  if (agent.identity) {
    parts.push(`<Identity>\n${agent.identity}\n</Identity>`);
  }
  if (agent.instructions) {
    parts.push(`<Instructions>\n${agent.instructions}\n</Instructions>`);
  }
  return parts.join("\n\n");
}

export interface BuildSystemPromptOptions {
  task?: Task | undefined;
  background?: boolean | undefined;
}

export function buildSystemPrompt(
  agent: AgentConfig,
  channel: ChannelType,
  cwd: string,
  directories: string[],
  options?: BuildSystemPromptOptions,
): string {
  const memories = buildMemoryPrompt();
  const dirBlock = buildDirectoriesBlock(cwd, directories);
  const formatting = getFormattingInstructions(channel);

  let prompt = `${buildIdentityBlock(agent)}${dirBlock}${STORAGE_INSTRUCTIONS}\n${formatting}${buildContextBlock()}${memories}`;

  if (options?.task) {
    prompt += `\n\n${buildTaskContext(options.task)}`;
  }

  if (options?.background) {
    prompt += `\n\n<Background>
You are running in the background (scheduled task). Your responses will NOT be sent to the user automatically.
If you need to notify the user about something important (questions, updates, completed work), use the notify_user tool.
</Background>`;
  }

  return prompt;
}

function buildTaskContext(task: Task): string {
  const stepsText = task.steps.length > 0
    ? task.steps.map((s, i) => {
        const marker = s.done ? "✓" : (i === task.steps.findIndex(st => !st.done) ? "→" : "○");
        const subtask = s.taskId ? ` (#${s.taskId})` : "";
        return `${i + 1}. ${marker} ${s.title}${subtask}`;
      }).join("\n")
    : "(no steps defined)";

  return `<Task>
You are working on task #${task.id}. Focus solely on progressing this task. Do not work on anything else.

Title: ${task.title}
Description: ${task.description}
Status: ${task.status}
Owner: ${task.owner}
Steps:
${stepsText}
</Task>`;
}
