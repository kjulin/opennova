import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { searchThreads } from "./search.js";
import { isModelAvailable } from "./embeddings.js";
import { logSearch } from "./analytics.js";

/**
 * Create an MCP server that exposes episodic memory search to agents.
 */
export function createHistoryMcpServer(
  agentDir: string,
  agentId: string,
  threadId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "history",
    tools: [
      tool(
        "search_threads",
        "Search your past conversation history using natural language. Returns relevant messages from previous threads with surrounding context.",
        {
          query: z.string().describe("Natural language search query"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .default(5)
            .describe("Maximum number of results (default 5)"),
        },
        async (args) => {
          if (!isModelAvailable()) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Episodic memory is not available. The embedding model has not been downloaded. Run 'nova init' to set up.",
                },
              ],
              isError: true,
            };
          }

          try {
            const results = await searchThreads(agentDir, args.query, args.limit);

            // Log analytics
            const topScore = results.length > 0 ? results[0]!.score : 0;
            logSearch({
              timestamp: new Date().toISOString(),
              agentId,
              threadId,
              query: args.query,
              resultCount: results.length,
              topScore,
            });

            if (results.length === 0) {
              return {
                content: [
                  { type: "text" as const, text: "No relevant past conversations found." },
                ],
              };
            }

            return {
              content: [
                { type: "text" as const, text: JSON.stringify(results, null, 2) },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Search failed: ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
