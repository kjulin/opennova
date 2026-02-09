import { z } from "zod/v4";
import crypto from "crypto";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";

export interface EditSuggestion {
  id: string;
  file: string;
  oldString: string;
  newString: string;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

export type SuggestEditCallback = (suggestion: EditSuggestion) => void;

const SUGGESTION_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function createSuggestEditMcpServer(
  onSuggestEdit: SuggestEditCallback,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "suggest-edit",
    tools: [
      tool(
        "suggest_edit",
        "Suggest an edit to a file. The user will see a diff preview and can apply or reject it. Only one suggestion can be pending at a time - new suggestions replace previous ones.",
        {
          file: z.string().describe("Relative path to the file to edit"),
          oldString: z
            .string()
            .describe("The exact text to find and replace (must match exactly)"),
          newString: z.string().describe("The replacement text"),
          reason: z
            .string()
            .describe("Brief explanation of why this edit is suggested"),
        },
        async (args) => {
          const now = Date.now();
          const suggestion: EditSuggestion = {
            id: crypto.randomUUID(),
            file: args.file,
            oldString: args.oldString,
            newString: args.newString,
            reason: args.reason,
            createdAt: now,
            expiresAt: now + SUGGESTION_TTL_MS,
          };

          onSuggestEdit(suggestion);

          return {
            content: [
              {
                type: "text" as const,
                text: `Edit suggestion created for ${args.file}. The user will see a diff preview with [y] Apply / [n] Reject options.`,
              },
            ],
          };
        },
      ),
    ],
  });
}
