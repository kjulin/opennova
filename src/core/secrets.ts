import fs from "fs";
import path from "path";
import { Entry } from "@napi-rs/keyring";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { filterTools } from "./capabilities/tool-filter.js";

const SERVICE = "nova";

// ── Keyring operations ──────────────────────────────────────────────────────

export function getSecret(name: string): string {
  const value = new Entry(SERVICE, name).getPassword();
  if (value === null) throw new Error(`Secret not found: ${name}`);
  return value;
}

export function setSecret(name: string, value: string): void {
  new Entry(SERVICE, name).setPassword(value);
}

export function deleteSecret(name: string): void {
  new Entry(SERVICE, name).deletePassword();
}

// ── Index operations (secrets.json — name list only, never values) ──────────

function indexPath(workspaceDir: string): string {
  return path.join(workspaceDir, "secrets.json");
}

export function listSecretNames(workspaceDir: string): string[] {
  const p = indexPath(workspaceDir);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveIndex(workspaceDir: string, names: string[]): void {
  fs.writeFileSync(indexPath(workspaceDir), JSON.stringify(names, null, 2));
}

export function addSecretName(workspaceDir: string, name: string): void {
  const names = listSecretNames(workspaceDir);
  if (!names.includes(name)) {
    names.push(name);
    saveIndex(workspaceDir, names);
  }
}

export function removeSecretName(workspaceDir: string, name: string): void {
  const names = listSecretNames(workspaceDir);
  const idx = names.indexOf(name);
  if (idx !== -1) {
    names.splice(idx, 1);
    saveIndex(workspaceDir, names);
  }
}

// ── MCP server ──────────────────────────────────────────────────────────────

export function createSecretsMcpServer(workspaceDir: string, allowedTools?: string[]): McpSdkServerConfigWithInstance {
  const allTools = [
      tool(
        "get_secret",
        "Retrieve a secret value by name",
        {
          name: z.string(),
        },
        async (args) => {
          try {
            const value = getSecret(args.name);
            return {
              content: [{ type: "text" as const, text: value }],
            };
          } catch {
            return {
              content: [{ type: "text" as const, text: `Secret not found: ${args.name}` }],
              isError: true,
            };
          }
        },
      ),
      tool(
        "list_secrets",
        "List available secret names (not values)",
        {},
        async () => {
          const names = listSecretNames(workspaceDir);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(names, null, 2) }],
          };
        },
      ),
      tool(
        "update_secret",
        "Update an existing secret value. Cannot create new secrets — only update existing ones.",
        {
          name: z.string(),
          value: z.string(),
        },
        async (args) => {
          const names = listSecretNames(workspaceDir);
          if (!names.includes(args.name)) {
            return {
              content: [{ type: "text" as const, text: `Secret not found: ${args.name}. Only existing secrets can be updated.` }],
              isError: true,
            };
          }
          setSecret(args.name, args.value);
          return {
            content: [{ type: "text" as const, text: `Updated secret: ${args.name}` }],
          };
        },
      ),
  ];

  return createSdkMcpServer({
    name: "secrets",
    tools: filterTools(allTools, "secrets", allowedTools),
  });
}
