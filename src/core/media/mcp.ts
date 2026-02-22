import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { transcribe, checkDependencies } from "../transcription/index.js";
import { getSecret } from "../secrets.js";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".opus", ".flac", ".aac"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"];

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

function isTranscribable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

export type FileType = "document" | "photo" | "audio" | "video";

export type OnFileSendCallback = (
  filePath: string,
  caption: string | undefined,
  fileType: FileType,
) => void;

/**
 * Create a unified "media" MCP server combining file-send and transcription tools.
 */
export function createMediaMcpServer(
  agentDir: string,
  allowedDirectories: string[],
  onFileSend: OnFileSendCallback,
): McpSdkServerConfigWithInstance {
  // Always allow agent's own directory
  const allAllowedDirs = [agentDir, ...allowedDirectories];

  return createSdkMcpServer({
    name: "media",
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

      tool(
        "text_to_speech",
        "Convert text to speech audio. Returns the path to the generated audio file. Use send_file to deliver it to the user.",
        {
          text: z.string().describe("The text to convert to speech. Max ~4000 characters."),
          voice: z.enum(["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"])
            .optional()
            .default("nova")
            .describe("Voice to use. 'nova' is warm and clear, good default for reports."),
          format: z.enum(["mp3", "opus", "aac", "flac", "wav"])
            .optional()
            .default("mp3")
            .describe("Audio format. mp3 is universally compatible. opus for smaller files."),
        },
        async (args) => {
          // 1. Read OpenAI API key from secrets
          let apiKey: string;
          try {
            apiKey = getSecret("openai-api-key");
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: OpenAI API key not configured. Run: nova secrets set openai-api-key",
                },
              ],
              isError: true,
            };
          }

          // 2. Validate text length
          if (args.text.length > 4096) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Text too long (${args.text.length} chars). Maximum: 4096 characters.`,
                },
              ],
              isError: true,
            };
          }

          // 3. POST to OpenAI TTS API
          try {
            const response = await fetch("https://api.openai.com/v1/audio/speech", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "tts-1",
                input: args.text,
                voice: args.voice,
                response_format: args.format,
              }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Error: OpenAI TTS API returned ${response.status}: ${errorText}`,
                  },
                ],
                isError: true,
              };
            }

            // 4. Create tts directory if needed
            const ttsDir = path.join(agentDir, "tts");
            fs.mkdirSync(ttsDir, { recursive: true });

            // 5. Write audio file
            const buffer = Buffer.from(await response.arrayBuffer());
            const fileName = `tts-${Date.now()}.${args.format}`;
            const filePath = path.join(ttsDir, fileName);
            fs.writeFileSync(filePath, buffer);

            // 6. Return file path
            return {
              content: [
                {
                  type: "text" as const,
                  text: filePath,
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error generating speech: ${(err as Error).message}`,
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
