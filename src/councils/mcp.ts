import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  loadCouncil,
  saveCouncil,
  loadMessages,
  readMemo,
  writeMemo,
} from "./storage.js";
import type { CouncilMessage } from "./types.js";

function formatTranscript(messages: CouncilMessage[]): string {
  if (messages.length === 0) return "No messages yet.";

  return messages
    .map((m) => `[${m.index}] ${m.agentName}: ${m.text}`)
    .join("\n");
}

function readMessagesHandler(councilId: string, agentId: string) {
  return async (args: { since_last_turn: boolean | undefined; last_n: number | undefined }) => {
    const sinceLast = args.since_last_turn ?? true;

    if (args.last_n !== undefined) {
      // Override: return last N messages
      const all = loadMessages(councilId);
      const sliced = all.slice(-args.last_n);
      return {
        content: [{ type: "text" as const, text: formatTranscript(sliced) }],
      };
    }

    if (sinceLast) {
      // Return messages since this agent's last seen index
      const manifest = loadCouncil(councilId);
      const lastSeen = manifest?.participantState[agentId]?.lastSeenIndex ?? -1;
      const messages = loadMessages(councilId, lastSeen);
      return {
        content: [{ type: "text" as const, text: formatTranscript(messages) }],
      };
    }

    // Return all messages
    const all = loadMessages(councilId);
    return {
      content: [{ type: "text" as const, text: formatTranscript(all) }],
    };
  };
}

function readMemoHandler(councilId: string) {
  return async () => {
    const content = readMemo(councilId);
    return {
      content: [{
        type: "text" as const,
        text: content || "No memo yet.",
      }],
    };
  };
}

// --- Coordinator MCP Server ---

export function createCouncilCoordinatorMcpServer(
  councilId: string,
  onClose?: () => void,
  onMemoUpdate?: (content: string) => void,
): McpSdkServerConfigWithInstance {
  // Use coordinator from manifest as agentId for message reading
  const manifest = loadCouncil(councilId);
  const coordinatorId = manifest?.coordinator ?? "unknown";

  return createSdkMcpServer({
    name: "council",
    tools: [
      tool(
        "update_memo",
        "Update the council memo. Call this as the discussion evolves to capture decisions and key points.",
        {
          content: z.string().describe("Full memo content (markdown)"),
        },
        async (args) => {
          writeMemo(councilId, args.content);
          onMemoUpdate?.(args.content);
          return {
            content: [{ type: "text" as const, text: "Memo updated." }],
          };
        },
      ),

      tool(
        "close_council",
        "Signal that the council discussion is complete.",
        {},
        async () => {
          const current = loadCouncil(councilId);
          if (current) {
            current.status = "closed";
            current.updatedAt = new Date().toISOString();
            saveCouncil(current);
          }
          onClose?.();
          return {
            content: [{ type: "text" as const, text: "Council closed." }],
          };
        },
      ),

      tool(
        "read_council_memo",
        "Read the current council memo.",
        {},
        readMemoHandler(councilId),
      ),

      tool(
        "read_council_messages",
        "Read the council transcript. By default returns messages since your last turn.",
        {
          since_last_turn: z.boolean().optional().describe("If true, return messages since your last turn (default: true)"),
          last_n: z.number().optional().describe("Override: return last N messages instead"),
        },
        readMessagesHandler(councilId, coordinatorId),
      ),
    ],
  });
}

// --- Participant MCP Server ---

export function createCouncilParticipantMcpServer(
  councilId: string,
  agentId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "council",
    tools: [
      tool(
        "read_council_memo",
        "Read the current council memo.",
        {},
        readMemoHandler(councilId),
      ),

      tool(
        "read_council_messages",
        "Read the council transcript. By default returns messages since your last turn.",
        {
          since_last_turn: z.boolean().optional().describe("If true, return messages since your last turn (default: true)"),
          last_n: z.number().optional().describe("Override: return last N messages instead"),
        },
        readMessagesHandler(councilId, agentId),
      ),
    ],
  });
}
