import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { transcribe, checkDependencies } from "../transcription/index.js";
import { generateSpeech } from "./tts.js";

const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".opus", ".flac", ".aac"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"];

function isPathAllowed(filePath: string, allowedDirs: string[]): boolean {
  const resolved = path.resolve(filePath);
  return allowedDirs.some((dir) => resolved.startsWith(path.resolve(dir)));
}

function isTranscribable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Create an "audio" MCP server with transcribe and text_to_speech tools.
 */
export function createAudioMcpServer(
  agentDir: string,
  allowedDirectories: string[],
): McpSdkServerConfigWithInstance {
  // Always allow agent's own directory
  const allAllowedDirs = [agentDir, ...allowedDirectories];

  return createSdkMcpServer({
    name: "audio",
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

      tool(
        "text_to_speech",
        "Convert text or a file to speech audio. Provide either text directly or a file path (notes, reports, specs — any readable text file). Long content is automatically chunked and concatenated into a single audio file. Returns the path to the generated audio file. Use send_file to deliver it to the user.",
        {
          text: z.string()
            .optional()
            .describe("Text to convert to speech. Use this for short inline content."),
          file: z.string()
            .optional()
            .describe("Absolute path to a text file to read aloud. The tool reads the file and converts its full contents to audio. Supports any text file (notes, specs, reports, markdown, etc)."),
          voice: z.enum(["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"])
            .optional()
            .default("nova")
            .describe("Voice to use. 'nova' is warm and clear, good default for reports."),
          format: z.enum(["mp3", "opus", "aac", "flac", "wav"])
            .optional()
            .default("mp3")
            .describe("Audio format. mp3 is universally compatible. opus for smaller files."),
          name: z.string()
            .optional()
            .describe("Output file name without extension. Defaults to tts-{timestamp}."),
        },
        async (args) => {
          // Resolve input: exactly one of text or file must be provided
          let inputText: string;

          if (args.text && args.file) {
            return {
              content: [
                { type: "text" as const, text: "Error: Provide either 'text' or 'file', not both." },
              ],
              isError: true,
            };
          }

          if (args.file) {
            const filePath = path.resolve(args.file);

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

            if (!fs.existsSync(filePath)) {
              return {
                content: [
                  { type: "text" as const, text: `Error: File not found: ${filePath}` },
                ],
                isError: true,
              };
            }

            try {
              inputText = fs.readFileSync(filePath, "utf-8");
            } catch (err) {
              return {
                content: [
                  { type: "text" as const, text: `Error reading file: ${(err as Error).message}` },
                ],
                isError: true,
              };
            }
          } else if (args.text) {
            inputText = args.text;
          } else {
            return {
              content: [
                { type: "text" as const, text: "Error: Provide either 'text' or 'file'." },
              ],
              isError: true,
            };
          }

          // Validate total text length
          if (inputText.length > 100_000) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: Text too long (${inputText.length} chars). Maximum: 100,000 characters.`,
                },
              ],
              isError: true,
            };
          }

          try {
            const ttsDir = path.join(agentDir, "tts");
            const outputPath = await generateSpeech(inputText, {
              voice: args.voice,
              format: args.format,
              outputDir: ttsDir,
              name: args.name,
            });

            return {
              content: [
                { type: "text" as const, text: outputPath },
              ],
            };
          } catch (err) {
            const message = (err as Error).message;
            // Surface friendly message for missing API key
            if (message.includes("openai-api-key")) {
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
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error generating speech: ${message}`,
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
