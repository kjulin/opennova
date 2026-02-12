import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".opus"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv"];

function detectFileType(filePath: string): "photo" | "audio" | "video" | "document" {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return "photo";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  return "document";
}

function isPathAllowed(filePath: string, allowedDirs: string[]): boolean {
  const resolved = path.resolve(filePath);
  return allowedDirs.some((dir) => resolved.startsWith(path.resolve(dir)));
}

export type FileType = "document" | "photo" | "audio" | "video";

export type OnFileSendCallback = (
  filePath: string,
  caption: string | undefined,
  fileType: FileType,
) => void;

export function createFileSendMcpServer(
  agentDir: string,
  allowedDirectories: string[],
  onFileSend: OnFileSendCallback,
): McpSdkServerConfigWithInstance {
  // Always allow agent's own directory
  const allAllowedDirs = [agentDir, ...allowedDirectories];

  return createSdkMcpServer({
    name: "file-send",
    tools: [
      tool(
        "send_file",
        "Send a file to the user over the current channel (e.g., Telegram). Use this when the user asks you to share a file, image, document, or any other media. The file must exist within your allowed directories.",
        {
          path: z.string().describe("Absolute path to the file to send"),
          caption: z
            .string()
            .optional()
            .describe("Optional caption/message to accompany the file"),
          type: z
            .enum(["auto", "document", "photo", "audio", "video"])
            .optional()
            .default("auto")
            .describe(
              "How to send the file. 'auto' detects from extension. Use 'document' to force file attachment.",
            ),
        },
        async (args) => {
          const filePath = path.resolve(args.path);

          // Security: Check path is within allowed directories
          if (!isPathAllowed(filePath, allAllowedDirs)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: File path not allowed. Files must be within: ${allAllowedDirs.join(", ")}`,
                },
              ],
              isError: true,
            };
          }

          // Check file exists
          if (!fs.existsSync(filePath)) {
            return {
              content: [
                { type: "text" as const, text: `Error: File not found: ${filePath}` },
              ],
              isError: true,
            };
          }

          // Check file size (Telegram limit: 50MB for bots)
          const stats = fs.statSync(filePath);
          const MAX_SIZE = 50 * 1024 * 1024; // 50MB
          if (stats.size > MAX_SIZE) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum: 50MB`,
                },
              ],
              isError: true,
            };
          }

          const fileType = args.type === "auto" ? detectFileType(filePath) : args.type;

          // Emit via callback (will be wired to event bus)
          onFileSend(filePath, args.caption, fileType);

          return {
            content: [
              {
                type: "text" as const,
                text: `File queued for sending: ${path.basename(filePath)}`,
              },
            ],
          };
        },
      ),
    ],
  });
}
