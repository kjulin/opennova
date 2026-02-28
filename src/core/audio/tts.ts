import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { getSecret } from "../secrets.js";

/**
 * Split text into chunks at sentence boundaries, each under maxLen chars.
 * Splits on ". ", "? ", "! ", "\n\n". Falls back to hard cut at maxLen.
 */
export function chunkText(text: string, maxLen = 4096): string[] {
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
 */
export async function concatAudioFiles(inputPaths: string[], outputPath: string): Promise<void> {
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

export interface SpeechOptions {
  voice?: "alloy" | "ash" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer" | undefined;
  format?: "mp3" | "opus" | "aac" | "flac" | "wav" | undefined;
  outputDir: string;
  name?: string | undefined;
}

/**
 * Generate speech audio from text using OpenAI TTS API.
 * Handles chunking for long text and concatenation of multiple audio segments.
 * Returns absolute path to the generated audio file.
 */
export async function generateSpeech(text: string, options: SpeechOptions): Promise<string> {
  const voice = options.voice ?? "nova";
  const format = options.format ?? "mp3";

  // Read OpenAI API key from secrets
  const apiKey = getSecret("openai-api-key");

  // Chunk text at sentence boundaries
  const chunks = chunkText(text);

  // Generate audio for each chunk
  fs.mkdirSync(options.outputDir, { recursive: true });

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
        voice,
        response_format: format,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS API returned ${response.status}: ${errorText}`);
    }

    audioBuffers.push(Buffer.from(await response.arrayBuffer()));
  }

  const timestamp = Date.now();
  const baseName = options.name ?? `tts-${timestamp}`;
  const outputFileName = `${baseName}.${format}`;
  const outputPath = path.join(options.outputDir, outputFileName);

  if (audioBuffers.length === 1) {
    // Single chunk: write directly
    fs.writeFileSync(outputPath, audioBuffers[0]!);
  } else {
    // Multiple chunks: write temp files, concatenate with ffmpeg
    const tempPaths: string[] = [];
    try {
      for (let i = 0; i < audioBuffers.length; i++) {
        const tempPath = path.join(os.tmpdir(), `nova-tts-${timestamp}-${i}.${format}`);
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

  return outputPath;
}
