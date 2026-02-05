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
  role: string;
  cwd?: string;
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
        "Create a new agent. Cannot set the security field — security levels are managed by the user via CLI only.",
        {
          id: z.string().describe("Agent identifier (lowercase alphanumeric with hyphens)"),
          name: z.string().describe("Display name"),
          role: z.string().describe("System prompt / role"),
          cwd: z.string().optional().describe("Primary working directory (optional)"),
          directories: z.array(z.string()).optional().describe("Additional directories the agent can access (optional)"),
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

          const data: AgentJson = { name: args.name, role: args.role };
          if (args.cwd) data.cwd = args.cwd;
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
          role: z.string().optional().describe("New system prompt / role"),
          cwd: z.string().optional().describe("New primary working directory"),
          directories: z.array(z.string()).optional().describe("New list of additional directories (replaces existing list)"),
          allowedAgents: z.array(z.string()).optional().describe("Agent IDs this agent can call via ask_agent (use [\"*\"] for any)"),
        },
        async (args) => {
          if (PROTECTED_AGENTS.has(args.id)) {
            return err(`Cannot modify system agent: ${args.id}`);
          }
          const config = readAgentJson(args.id);
          if (!config) return err(`Agent not found: ${args.id}`);

          if (args.name !== undefined) config.name = args.name;
          if (args.role !== undefined) config.role = args.role;
          if (args.cwd !== undefined) config.cwd = args.cwd;
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

          // Validate each trigger's cron expression
          for (const trigger of parsed) {
            if (trigger && typeof trigger === "object" && "cron" in trigger) {
              try {
                CronExpressionParser.parse(trigger.cron as string);
              } catch {
                return err(`Invalid cron expression: ${trigger.cron}`);
              }
            }
          }

          fs.writeFileSync(
            path.join(dir, "triggers.json"),
            JSON.stringify(parsed, null, 2) + "\n",
          );
          return ok(`Wrote triggers for agent "${args.id}"`);
        },
      ),
    ],
  });
}
