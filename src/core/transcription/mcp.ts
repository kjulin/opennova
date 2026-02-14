import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { transcribe, checkDependencies } from "./index.js";

const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".opus", ".flac", ".aac"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"];

function isTranscribable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

function isPathAllowed(filePath: string, allowedDirs: string[]): boolean {
  const resolved = path.resolve(filePath);
  return allowedDirs.some((dir) => resolved.startsWith(path.resolve(dir)));
}

export function createTranscriptionMcpServer(
  agentDir: string,
  allowedDirectories: string[],
): McpSdkServerConfigWithInstance {
  // Always allow agent's own directory
  const allAllowedDirs = [agentDir, ...allowedDirectories];

  return createSdkMcpServer({
    name: "transcription",
    tools: [
      tool(
        "transcribe",
        "Transcribe speech from an audio or video file to text. Supports mp3, ogg, wav, m4a, opus, flac, aac, mp4, mov, avi, webm, mkv. Use this when the user sends you an audio/video file and you need to understand what is said.",
        {
          path: z.string().describe("Absolute path to the audio or video file to transcribe"),
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

          // Check file type
          if (!isTranscribable(filePath)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Unsupported file type. Supported: ${[...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].join(", ")}`,
                },
              ],
              isError: true,
            };
          }

          // Check dependencies
          const deps = await checkDependencies();
          if (!deps.ffmpeg) {
            return {
              content: [
                { type: "text" as const, text: "Error: ffmpeg is not installed. Required for transcription." },
              ],
              isError: true,
            };
          }
          if (!deps.whisper) {
            return {
              content: [
                { type: "text" as const, text: "Error: whisper-cpp is not installed. Required for transcription." },
              ],
              isError: true,
            };
          }
          if (!deps.model) {
            return {
              content: [
                { type: "text" as const, text: "Error: Whisper model not found. Run 'nova transcription setup' first." },
              ],
              isError: true,
            };
          }

          try {
            const result = await transcribe(filePath);
            const fileName = path.basename(filePath);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Transcription of ${fileName} (${result.duration.toFixed(1)}s, ${result.language}):\n\n${result.text}`,
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                { type: "text" as const, text: `Error transcribing file: ${(err as Error).message}` },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
