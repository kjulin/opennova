import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";

export function createNotifyUserMcpServer(
  onNotify: (message: string) => void,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "notify-user",
    tools: [
      tool(
        "notify_user",
        "Send a message to the user. Use this when you have important updates, questions, or completed work to share. The message will be delivered to their chat.",
        {
          message: z.string().describe("The message to send to the user"),
        },
        async (args) => {
          onNotify(args.message);
          return {
            content: [{
              type: "text" as const,
              text: "Message sent to user.",
            }],
          };
        },
      ),
    ],
  });
}
