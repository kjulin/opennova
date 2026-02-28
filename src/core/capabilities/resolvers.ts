import { CapabilityRegistry } from "./registry.js";
import { createMemoryMcpServer } from "../memory.js";
import { createHistoryMcpServer } from "../episodic/index.js";
import { createTasksMcpServer } from "#tasks/index.js";
import { createNotesMcpServer } from "#notes/index.js";
import { createSelfManagementMcpServer, createAgentManagementMcpServer } from "../agents/management.js";
import { createFileSendMcpServer } from "../file-send.js";
import { createAudioMcpServer } from "../audio/index.js";
import { createSecretsMcpServer } from "../secrets.js";
import { createAgentsMcpServer } from "../agents/ask-agent.js";
import { createTriggerMcpServer } from "../triggers/index.js";

/**
 * Create a CapabilityRegistry with all built-in capabilities registered.
 */
export function createRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();

  registry.register(
    "memory",
    (ctx, config) => createMemoryMcpServer(config.tools),
    [
      { name: "save_memory", description: "Save a short global fact" },
      { name: "list_memories", description: "List saved global memories" },
      { name: "delete_memory", description: "Delete a memory by exact text" },
    ],
  );

  registry.register(
    "history",
    (ctx, config) => createHistoryMcpServer(ctx.agentId, ctx.threadId, config.tools),
    [
      { name: "search_threads", description: "Search past conversation history" },
    ],
  );

  registry.register(
    "tasks",
    (ctx, config) => createTasksMcpServer(ctx.agentId, ctx.workspaceDir, config.tools),
    [
      { name: "create_task", description: "Create a new task" },
      { name: "list_tasks", description: "List active tasks" },
      { name: "list_history", description: "List completed/canceled tasks" },
      { name: "get_task", description: "Get full task details" },
      { name: "update_task", description: "Update a task" },
      { name: "update_steps", description: "Replace task steps" },
      { name: "complete_task", description: "Mark task as done" },
      { name: "create_subtask", description: "Create a linked subtask" },
      { name: "add_resource", description: "Add a resource to a task" },
      { name: "remove_resource", description: "Remove a resource from a task" },
      { name: "cancel_task", description: "Cancel a task" },
    ],
  );

  registry.register(
    "notes",
    (ctx, config) =>
      createNotesMcpServer(ctx.agentDir, ctx.callbacks.onShareNote, ctx.callbacks.onPinChange, config.tools),
    [
      { name: "save_note", description: "Create or overwrite a note" },
      { name: "list_notes", description: "List all notes" },
      { name: "read_note", description: "Read a note by title" },
      { name: "update_note", description: "Update an existing note" },
      { name: "delete_note", description: "Delete a note" },
      { name: "share_note", description: "Share a note with the user" },
      { name: "pin_note", description: "Pin a note" },
      { name: "unpin_note", description: "Unpin a note" },
      { name: "list_pinned_notes", description: "List pinned notes" },
    ],
  );

  registry.register(
    "self",
    (ctx, config) => createSelfManagementMcpServer(ctx.agentId, config.tools),
    [
      { name: "update_my_instructions", description: "Update your operating instructions" },
      { name: "read_my_instructions", description: "Read your current instructions" },
      { name: "list_responsibilities", description: "List your responsibilities" },
      { name: "add_responsibility", description: "Add a responsibility" },
      { name: "update_responsibility", description: "Update a responsibility" },
      { name: "remove_responsibility", description: "Remove a responsibility" },
    ],
  );

  registry.register(
    "media",
    (ctx, config) =>
      createFileSendMcpServer(
        ctx.agentDir,
        ctx.directories,
        ctx.callbacks.onFileSend ?? (() => {}),
        config.tools,
      ),
    [
      { name: "send_file", description: "Send a file to the user" },
    ],
  );

  registry.register(
    "audio",
    (ctx, config) => createAudioMcpServer(ctx.agentDir, ctx.directories, config.tools),
    [
      { name: "transcribe", description: "Transcribe speech from audio/video" },
      { name: "text_to_speech", description: "Convert text to speech audio" },
    ],
  );

  registry.register(
    "secrets",
    (ctx, config) => createSecretsMcpServer(ctx.workspaceDir, config.tools),
    [
      { name: "get_secret", description: "Retrieve a secret value" },
      { name: "list_secrets", description: "List available secret names" },
      { name: "update_secret", description: "Update an existing secret" },
    ],
  );

  registry.register(
    "agents",
    (ctx, config) => {
      if (!ctx.runAgentFn) return null;
      return createAgentsMcpServer(ctx.agent, ctx.askAgentDepth ?? 0, ctx.runAgentFn, config.tools);
    },
    [
      { name: "list_available_agents", description: "List agents you can delegate to" },
      { name: "ask_agent", description: "Send a message to another agent" },
    ],
  );

  registry.register(
    "agent-management",
    (_ctx, config) => createAgentManagementMcpServer(config.tools),
    [
      { name: "list_agents", description: "List all agents" },
      { name: "read_agent", description: "Read agent configuration" },
      { name: "create_agent", description: "Create a new agent" },
      { name: "update_agent", description: "Update an agent" },
      { name: "delete_agent", description: "Delete an agent" },
      { name: "read_triggers", description: "Read agent triggers" },
      { name: "write_triggers", description: "Write agent triggers" },
    ],
  );

  registry.register(
    "triggers",
    (ctx, config) => createTriggerMcpServer(ctx.agentId, config.tools),
    [
      { name: "list_triggers", description: "List cron triggers" },
      { name: "create_trigger", description: "Create a cron trigger" },
      { name: "update_trigger", description: "Update a trigger" },
      { name: "remove_trigger", description: "Remove a trigger" },
    ],
  );

  registry.register(
    "browser",
    () => ({
      type: "stdio" as const,
      command: "npx",
      args: ["@playwright/mcp@latest"],
    }),
    [],
  );

  return registry;
}
