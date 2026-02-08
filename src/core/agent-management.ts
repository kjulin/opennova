import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import { CronExpressionParser } from "cron-parser";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { Config } from "./config.js";

const PROTECTED_AGENTS = new Set(["nova", "agent-builder"]);

function generateTriggerId(): string {
  return crypto.randomBytes(6).toString("hex");
}
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;

function agentsDir(): string {
  return path.join(Config.workspaceDir, "agents");
}

function agentDir(id: string): string {
  return path.join(agentsDir(), id);
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

interface AgentJson {
  name: string;
  description?: string;
  role?: string; // Legacy - kept for backwards compatibility
  identity?: string; // Who: expertise, personality, methodology
  working_arrangement?: string; // How: files, rhythm, focus, constraints
  directories?: string[];
  allowedAgents?: string[];
  [key: string]: unknown;
}

function readAgentJson(id: string): AgentJson | null {
  const configPath = path.join(agentDir(id), "agent.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeAgentJson(id: string, data: AgentJson): void {
  const dir = agentDir(id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent.json"), JSON.stringify(data, null, 2) + "\n");
}

export function createAgentManagementMcpServer(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "agents",
    tools: [
      tool(
        "list_agents",
        "List all agents with their configuration",
        {},
        async () => {
          const dir = agentsDir();
          if (!fs.existsSync(dir)) return ok("[]");

          const agents: { id: string; config: AgentJson }[] = [];
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const config = readAgentJson(entry.name);
            if (config) agents.push({ id: entry.name, config });
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
          const config = readAgentJson(args.id);
          if (!config) return err(`Agent not found: ${args.id}`);
          return ok(JSON.stringify({ id: args.id, config }, null, 2));
        },
      ),

      tool(
        "create_agent",
        "Create a new agent. Use identity for who the agent is, and working_arrangement for how they operate. Cannot set the security field — security levels are managed by the user via CLI only.",
        {
          id: z.string().describe("Agent identifier (lowercase alphanumeric with hyphens)"),
          name: z.string().describe("Display name"),
          description: z.string().optional().describe("Short description of what this agent does — shown to other agents for delegation discovery"),
          identity: z.string().describe("Who the agent is — expertise, personality, methodology"),
          working_arrangement: z.string().optional().describe("How the agent operates — files, rhythm, focus, constraints"),
          directories: z.array(z.string()).optional().describe("Directories the agent can access (optional)"),
          allowedAgents: z.array(z.string()).optional().describe("Agent IDs this agent can call via ask_agent (use [\"*\"] for any)"),
        },
        async (args) => {
          if (!VALID_AGENT_ID.test(args.id)) {
            return err(`Invalid agent ID: "${args.id}". Use lowercase letters, numbers, and hyphens.`);
          }
          if (PROTECTED_AGENTS.has(args.id)) {
            return err(`Cannot create agent with reserved ID: ${args.id}`);
          }
          if (readAgentJson(args.id)) {
            return err(`Agent "${args.id}" already exists. Use update_agent to modify it.`);
          }

          const data: AgentJson = { name: args.name, identity: args.identity };
          if (args.description) data.description = args.description;
          if (args.working_arrangement) data.working_arrangement = args.working_arrangement;
          if (args.directories && args.directories.length > 0) data.directories = args.directories;
          if (args.allowedAgents && args.allowedAgents.length > 0) data.allowedAgents = args.allowedAgents;
          writeAgentJson(args.id, data);
          return ok(`Created agent "${args.id}"`);
        },
      ),

      tool(
        "update_agent",
        "Update an existing agent's configuration. Cannot modify system agents (nova, agent-builder). Cannot set the security field.",
        {
          id: z.string().describe("Agent identifier"),
          name: z.string().optional().describe("New display name"),
          description: z.string().optional().describe("New short description"),
          identity: z.string().optional().describe("New identity — who the agent is"),
          working_arrangement: z.string().optional().describe("New working arrangement — how the agent operates"),
          directories: z.array(z.string()).optional().describe("New list of directories (replaces existing list)"),
          allowedAgents: z.array(z.string()).optional().describe("Agent IDs this agent can call via ask_agent (use [\"*\"] for any)"),
        },
        async (args) => {
          if (PROTECTED_AGENTS.has(args.id)) {
            return err(`Cannot modify system agent: ${args.id}`);
          }
          const config = readAgentJson(args.id);
          if (!config) return err(`Agent not found: ${args.id}`);

          if (args.name !== undefined) config.name = args.name;
          if (args.description !== undefined) config.description = args.description;
          if (args.identity !== undefined) config.identity = args.identity;
          if (args.working_arrangement !== undefined) config.working_arrangement = args.working_arrangement;
          if (args.directories !== undefined) config.directories = args.directories;
          if (args.allowedAgents !== undefined) config.allowedAgents = args.allowedAgents;

          writeAgentJson(args.id, config);
          return ok(`Updated agent "${args.id}"`);
        },
      ),

      tool(
        "delete_agent",
        "Delete an agent and all its data (threads, memories, triggers). Cannot delete system agents.",
        {
          id: z.string().describe("Agent identifier to delete"),
        },
        async (args) => {
          if (PROTECTED_AGENTS.has(args.id)) {
            return err(`Cannot delete system agent: ${args.id}`);
          }
          const dir = agentDir(args.id);
          if (!fs.existsSync(dir)) return err(`Agent not found: ${args.id}`);

          fs.rmSync(dir, { recursive: true });
          return ok(`Deleted agent "${args.id}" and all its data`);
        },
      ),

      tool(
        "rename_agent",
        "Rename an agent's ID (directory name) and optionally its display name. Preserves all data (threads, memories, triggers). Cannot rename system agents.",
        {
          id: z.string().describe("Current agent identifier"),
          newId: z.string().describe("New agent identifier (lowercase alphanumeric with hyphens)"),
          newName: z.string().optional().describe("New display name (optional — if omitted, keeps current name)"),
        },
        async (args) => {
          if (PROTECTED_AGENTS.has(args.id)) {
            return err(`Cannot rename system agent: ${args.id}`);
          }
          if (!VALID_AGENT_ID.test(args.newId)) {
            return err(`Invalid agent ID: "${args.newId}". Use lowercase letters, numbers, and hyphens.`);
          }
          if (PROTECTED_AGENTS.has(args.newId)) {
            return err(`Cannot rename to reserved ID: ${args.newId}`);
          }
          const oldDir = agentDir(args.id);
          if (!fs.existsSync(oldDir)) return err(`Agent not found: ${args.id}`);
          if (args.newId !== args.id && fs.existsSync(agentDir(args.newId))) {
            return err(`Agent "${args.newId}" already exists`);
          }

          // Update display name in config if requested
          if (args.newName) {
            const config = readAgentJson(args.id);
            if (config) {
              config.name = args.newName;
              writeAgentJson(args.id, config);
            }
          }

          // Rename directory if ID changed
          if (args.newId !== args.id) {
            fs.renameSync(oldDir, agentDir(args.newId));
          }

          const parts: string[] = [];
          if (args.newId !== args.id) parts.push(`ID: ${args.id} → ${args.newId}`);
          if (args.newName) parts.push(`name: "${args.newName}"`);
          return ok(`Renamed agent. ${parts.join(", ")}`);
        },
      ),

      tool(
        "read_triggers",
        "Read an agent's triggers",
        {
          id: z.string().describe("Agent identifier"),
        },
        async (args) => {
          const triggersPath = path.join(agentDir(args.id), "triggers.json");
          if (!fs.existsSync(triggersPath)) return ok("[]");
          try {
            const data = fs.readFileSync(triggersPath, "utf-8");
            return ok(data);
          } catch {
            return err(`Failed to read triggers for agent: ${args.id}`);
          }
        },
      ),

      tool(
        "write_triggers",
        "Write an agent's triggers.json. Validates cron expressions. Cannot target system agents.",
        {
          id: z.string().describe("Agent identifier"),
          triggers: z.string().describe("Full triggers.json content as a JSON string"),
        },
        async (args) => {
          if (PROTECTED_AGENTS.has(args.id)) {
            return err(`Cannot modify triggers for system agent: ${args.id}`);
          }
          const dir = agentDir(args.id);
          if (!fs.existsSync(dir)) return err(`Agent not found: ${args.id}`);

          let parsed: unknown;
          try {
            parsed = JSON.parse(args.triggers);
          } catch {
            return err("Invalid JSON");
          }

          if (!Array.isArray(parsed)) return err("Triggers must be a JSON array");

          // Validate and normalize each trigger
          const normalized = [];
          for (const trigger of parsed) {
            if (!trigger || typeof trigger !== "object") {
              return err("Each trigger must be an object");
            }

            const t = trigger as Record<string, unknown>;

            // Validate cron expression
            if ("cron" in t) {
              try {
                CronExpressionParser.parse(t.cron as string);
              } catch {
                return err(`Invalid cron expression: ${t.cron}`);
              }
            }

            // Auto-fill missing fields (lastRunAt always set to now on creation)
            normalized.push({
              id: t.id ?? generateTriggerId(),
              channel: t.channel ?? "telegram",
              cron: t.cron,
              prompt: t.prompt,
              enabled: t.enabled ?? true,
              lastRunAt: new Date().toISOString(),
            });
          }

          fs.writeFileSync(
            path.join(dir, "triggers.json"),
            JSON.stringify(normalized, null, 2) + "\n",
          );
          return ok(`Wrote ${normalized.length} trigger(s) for agent "${args.id}"`);
        },
      ),
    ],
  });
}

const MAX_WORKING_ARRANGEMENT_LENGTH = 10000;

export function createSelfManagementMcpServer(
  agentDir: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "self",
    tools: [
      tool(
        "update_my_working_arrangement",
        "Update how you operate. Use when you discover better approaches, user preferences about your workflow, or patterns that work well. Takes effect next conversation.",
        {
          content: z.string()
            .min(1, "Working arrangement cannot be empty")
            .max(MAX_WORKING_ARRANGEMENT_LENGTH, `Working arrangement cannot exceed ${MAX_WORKING_ARRANGEMENT_LENGTH} characters`)
            .describe("Your new working arrangement — how you operate"),
        },
        async (args) => {
          const configPath = path.join(agentDir, "agent.json");
          if (!fs.existsSync(configPath)) {
            return err("Agent configuration not found");
          }
          try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            config.working_arrangement = args.content;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
            return ok(`Updated working arrangement (${args.content.length} chars)`);
          } catch (e) {
            return err(`Failed to update: ${(e as Error).message}`);
          }
        },
      ),

      tool(
        "read_my_working_arrangement",
        "Read your current working arrangement before updating.",
        {},
        async () => {
          const configPath = path.join(agentDir, "agent.json");
          if (!fs.existsSync(configPath)) {
            return err("Agent configuration not found");
          }
          try {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            return ok(config.working_arrangement ?? "(no working arrangement set)");
          } catch (e) {
            return err(`Failed to read: ${(e as Error).message}`);
          }
        },
      ),
    ],
  });
}
