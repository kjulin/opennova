import type { AgentJsonInput } from "../schemas.js";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  MAX_INSTRUCTIONS_LENGTH,
  ResponsibilitySchema,
} from "../schemas.js";
import { MODELS } from "../models.js";
import { agentStore } from "./singleton.js";
import { triggerStore } from "../triggers/singleton.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

export function createAgentManagementMcpServer(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "agent-management",
    tools: [
      tool(
        "list_agents",
        "List all agents with their configuration",
        {},
        async () => {
          const agents: { id: string; config: unknown }[] = [];
          for (const [id, config] of agentStore.list()) {
            agents.push({ id, config });
          }
          return ok(JSON.stringify(agents, null, 2));
        },
      ),

      tool(
        "read_agent",
        "Read a single agent's full configuration",
        {
          id: z.string().describe("Agent identifier (directory name)"),
        },
        async (args) => {
          const config = agentStore.get(args.id);
          if (!config) return err(`Agent not found: ${args.id}`);
          return ok(JSON.stringify({ id: args.id, config }, null, 2));
        },
      ),

      tool(
        "create_agent",
        "Create a new agent. Use identity for who the agent is, and instructions for how they operate. Cannot set the security field — security levels are managed by the user via CLI only.",
        {
          id: z.string().describe("Agent identifier (lowercase alphanumeric with hyphens)"),
          name: z.string().describe("Display name"),
          description: z.string().optional().describe("Short description of what this agent does — shown to other agents for delegation discovery"),
          identity: z.string().describe("Who the agent is — expertise, personality, methodology"),
          instructions: z.string().optional().describe("How the agent operates — files, rhythm, focus, constraints"),
          directories: z.array(z.string()).optional().describe("Directories the agent can access (optional)"),
          capabilities: z.array(z.string()).optional().describe("System capabilities to enable (e.g. memory, history, tasks, notes, web-search, agent-management)"),
          model: z.enum(MODELS).optional().describe("Model to use. Defaults to 'sonnet'."),
        },
        async (args) => {
          try {
            agentStore.create(args.id, {
              name: args.name,
              identity: args.identity,
              model: args.model ?? "sonnet",
              ...(args.description && { description: args.description }),
              ...(args.instructions && { instructions: args.instructions }),
              ...(args.directories && args.directories.length > 0 && { directories: args.directories }),
              ...(args.capabilities && args.capabilities.length > 0 && { capabilities: args.capabilities }),
            });
            return ok(`Created agent "${args.id}"`);
          } catch (e) {
            return err((e as Error).message);
          }
        },
      ),

      tool(
        "update_agent",
        "Update an existing agent's configuration. Cannot set the trust field — trust levels are managed by the user via CLI only.",
        {
          id: z.string().describe("Agent identifier"),
          name: z.string().optional().describe("New display name"),
          description: z.string().optional().describe("New short description"),
          identity: z.string().optional().describe("New identity — who the agent is"),
          instructions: z.string().optional().describe("New instructions — how the agent operates"),
          directories: z.array(z.string()).optional().describe("New list of directories (replaces existing list)"),
        },
        async (args) => {
          const partial: Partial<AgentJsonInput> = {};
          if (args.name !== undefined) partial.name = args.name;
          if (args.description !== undefined) partial.description = args.description;
          if (args.identity !== undefined) partial.identity = args.identity;
          if (args.instructions !== undefined) partial.instructions = args.instructions;
          if (args.directories !== undefined) partial.directories = args.directories;

          try {
            agentStore.update(args.id, partial);
            return ok(`Updated agent "${args.id}"`);
          } catch (e) {
            return err((e as Error).message);
          }
        },
      ),

      tool(
        "delete_agent",
        "Delete an agent and all its data (threads, memories, triggers).",
        {
          id: z.string().describe("Agent identifier to delete"),
        },
        async (args) => {
          if (!agentStore.get(args.id)) return err(`Agent not found: ${args.id}`);
          agentStore.delete(args.id);
          return ok(`Deleted agent "${args.id}" and all its data`);
        },
      ),

      tool(
        "read_triggers",
        "Read an agent's triggers",
        {
          id: z.string().describe("Agent identifier"),
        },
        async (args) => {
          const triggers = triggerStore.list(args.id);
          return ok(JSON.stringify(triggers, null, 2));
        },
      ),

      tool(
        "write_triggers",
        "Write an agent's triggers. Validates cron expressions. Cannot target system agents.",
        {
          id: z.string().describe("Agent identifier"),
          triggers: z.string().describe("Full triggers content as a JSON string"),
        },
        async (args) => {
          if (!agentStore.get(args.id)) return err(`Agent not found: ${args.id}`);

          let parsed: unknown;
          try {
            parsed = JSON.parse(args.triggers);
          } catch {
            return err("Invalid JSON");
          }

          if (!Array.isArray(parsed)) return err("Triggers must be a JSON array");

          // Clear existing triggers and create new ones
          triggerStore.deleteAllForAgent(args.id);

          try {
            for (const trigger of parsed) {
              if (!trigger || typeof trigger !== "object") {
                return err("Each trigger must be an object");
              }
              const t = trigger as Record<string, unknown>;
              const input: { cron: string; prompt: string; tz?: string } = {
                cron: t.cron as string,
                prompt: t.prompt as string,
              };
              if (t.tz) input.tz = t.tz as string;
              triggerStore.create(args.id, input);
            }
          } catch (e) {
            return err((e as Error).message);
          }

          const created = triggerStore.list(args.id);
          return ok(`Wrote ${created.length} trigger(s) for agent "${args.id}"`);
        },
      ),
    ],
  });
}

export function createSelfManagementMcpServer(
  agentId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "self",
    tools: [
      tool(
        "update_my_instructions",
        "Update how you operate. Use when you discover better approaches, user preferences about your workflow, or patterns that work well. Takes effect next conversation.",
        {
          content: z.string()
            .min(1, "Instructions cannot be empty")
            .max(MAX_INSTRUCTIONS_LENGTH, `Instructions cannot exceed ${MAX_INSTRUCTIONS_LENGTH} characters`)
            .describe("Your new instructions — how you operate"),
        },
        async (args) => {
          try {
            agentStore.update(agentId, { instructions: args.content });
            return ok(`Updated instructions (${args.content.length} chars)`);
          } catch (e) {
            return err(`Failed to update: ${(e as Error).message}`);
          }
        },
      ),

      tool(
        "read_my_instructions",
        "Read your current instructions before updating.",
        {},
        async () => {
          const config = agentStore.get(agentId);
          if (!config) return err("Agent configuration not found");
          return ok(config.instructions ?? "(no instructions set)");
        },
      ),

      tool(
        "list_responsibilities",
        "List your current responsibilities — what you are responsible for doing.",
        {},
        async () => {
          const config = agentStore.get(agentId);
          if (!config) return err("Agent configuration not found");
          const responsibilities = config.responsibilities ?? [];
          if (responsibilities.length === 0) return ok("No responsibilities defined.");
          return ok(JSON.stringify(responsibilities, null, 2));
        },
      ),

      tool(
        "add_responsibility",
        "Add a new responsibility — a specific duty or area you are responsible for. Use when you take on a new role or the user assigns you something.",
        {
          title: z.string().min(1).describe("Short label for this responsibility (e.g., 'Agent routing', 'Product onboarding')"),
          content: z.string().min(1).describe("Instruction text — goals, behavior, context for this responsibility"),
        },
        async (args) => {
          const config = agentStore.get(agentId);
          if (!config) return err("Agent configuration not found");
          const responsibilities = config.responsibilities ?? [];
          if (responsibilities.some((r: { title: string }) => r.title === args.title)) {
            return err(`Responsibility "${args.title}" already exists. Use update_responsibility to modify it.`);
          }
          responsibilities.push({ title: args.title, content: args.content });
          try {
            agentStore.update(agentId, { responsibilities });
            return ok(`Added responsibility "${args.title}"`);
          } catch (e) {
            return err(`Failed to add: ${(e as Error).message}`);
          }
        },
      ),

      tool(
        "update_responsibility",
        "Update an existing responsibility's content. Use to refine goals or adjust scope.",
        {
          title: z.string().min(1).describe("Title of the responsibility to update"),
          content: z.string().min(1).describe("New instruction text for this responsibility"),
        },
        async (args) => {
          const config = agentStore.get(agentId);
          if (!config) return err("Agent configuration not found");
          const responsibilities = config.responsibilities ?? [];
          const idx = responsibilities.findIndex((r: { title: string }) => r.title === args.title);
          if (idx === -1) return err(`Responsibility "${args.title}" not found.`);
          responsibilities[idx]!.content = args.content;
          try {
            agentStore.update(agentId, { responsibilities });
            return ok(`Updated responsibility "${args.title}"`);
          } catch (e) {
            return err(`Failed to update: ${(e as Error).message}`);
          }
        },
      ),

      tool(
        "remove_responsibility",
        "Remove a responsibility when it is complete or no longer relevant. This is how you shed duties that are done.",
        {
          title: z.string().min(1).describe("Title of the responsibility to remove"),
        },
        async (args) => {
          const config = agentStore.get(agentId);
          if (!config) return err("Agent configuration not found");
          const responsibilities = config.responsibilities ?? [];
          const idx = responsibilities.findIndex((r: { title: string }) => r.title === args.title);
          if (idx === -1) return err(`Responsibility "${args.title}" not found.`);
          responsibilities.splice(idx, 1);
          try {
            agentStore.update(agentId, { responsibilities: responsibilities.length > 0 ? responsibilities : undefined });
            return ok(`Removed responsibility "${args.title}"`);
          } catch (e) {
            return err(`Failed to remove: ${(e as Error).message}`);
          }
        },
      ),
    ],
  });
}
