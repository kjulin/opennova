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
import { spawn } from "child_process";
import os from "os";

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

/**
 * Split text into chunks at sentence boundaries, each under maxLen chars.
 * Splits on ". ", "? ", "! ", "\n\n". Falls back to hard cut at maxLen.
 */
function chunkText(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find the last sentence boundary within maxLen
    let cutPoint = -1;
    const delimiters = [". ", "? ", "! ", "\n\n"];
    for (const delim of delimiters) {
      const idx = remaining.lastIndexOf(delim, maxLen);
      if (idx > 0 && idx + delim.length > cutPoint) {
        cutPoint = idx + delim.length;
      }
    }

    // If no sentence boundary found, hard cut at maxLen
    if (cutPoint <= 0) {
      cutPoint = maxLen;
    }

    chunks.push(remaining.slice(0, cutPoint));
    remaining = remaining.slice(cutPoint);
  }

  return chunks;
}

/**
 * Concatenate multiple audio files using ffmpeg's concat demuxer.
 * Returns path to the concatenated output file.
 */
async function concatAudioFiles(inputPaths: string[], outputPath: string): Promise<void> {
  const listContent = inputPaths.map((p) => `file '${p}'`).join("\n");
  const listPath = path.join(os.tmpdir(), `nova-tts-concat-${Date.now()}.txt`);
  fs.writeFileSync(listPath, listContent);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", [
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-c", "copy",
        "-y",
        outputPath,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => stderr += d.toString());

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg concat failed (code ${code}): ${stderr.slice(-500)}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`ffmpeg not found: ${err.message}`));
      });
    });
  } finally {
    // Clean up list file
    try { fs.unlinkSync(listPath); } catch {}
  }
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
          // 1. Resolve input: exactly one of text or file must be provided
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

            // Security: same check as send_file
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

          // 2. Read OpenAI API key from secrets
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

          // 3. Validate total text length
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

          // 4. Chunk text at sentence boundaries
          const chunks = chunkText(inputText);

          // 5. Generate audio for each chunk
          const ttsDir = path.join(agentDir, "tts");
          fs.mkdirSync(ttsDir, { recursive: true });

          try {
            const audioBuffers: Buffer[] = [];

            for (const chunk of chunks) {
              const response = await fetch("https://api.openai.com/v1/audio/speech", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "tts-1",
                  input: chunk,
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

              audioBuffers.push(Buffer.from(await response.arrayBuffer()));
            }

            const timestamp = Date.now();
            const baseName = args.name ?? `tts-${timestamp}`;
            const outputFileName = `${baseName}.${args.format}`;
            const outputPath = path.join(ttsDir, outputFileName);

            if (audioBuffers.length === 1) {
              // Single chunk: write directly
              fs.writeFileSync(outputPath, audioBuffers[0]!);
            } else {
              // Multiple chunks: write temp files, concatenate with ffmpeg
              const tempPaths: string[] = [];
              try {
                for (let i = 0; i < audioBuffers.length; i++) {
                  const tempPath = path.join(os.tmpdir(), `nova-tts-${timestamp}-${i}.${args.format}`);
                  fs.writeFileSync(tempPath, audioBuffers[i]!);
                  tempPaths.push(tempPath);
                }

                await concatAudioFiles(tempPaths, outputPath);
              } finally {
                // Clean up temp files
                for (const tempPath of tempPaths) {
                  try { fs.unlinkSync(tempPath); } catch {}
                }
              }
            }

            return {
              content: [
                { type: "text" as const, text: outputPath },
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
