import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../logger.js";

/**
 * Convert audio file to WAV format suitable for Whisper (16kHz mono PCM).
 * Returns path to the converted WAV file in temp directory.
 */
export async function convertToWav(inputPath: string): Promise<string> {
  const basename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(os.tmpdir(), `nova-${basename}-${Date.now()}.wav`);

  log.debug("transcription", `converting ${inputPath} to ${outputPath}`);

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputPath,
      "-ar", "16000",      // 16kHz sample rate (Whisper requirement)
      "-ac", "1",          // Mono
      "-c:a", "pcm_s16le", // 16-bit PCM
      "-y",                // Overwrite output
      outputPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => stderr += d.toString());

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        log.debug("transcription", `converted successfully`);
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not found: ${err.message}. Install with: brew install ffmpeg`));
    });
  });
}

/**
 * Get audio duration in seconds using ffprobe.
 */
export async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (d) => stdout += d.toString());

    proc.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(stdout.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        resolve(0); // Fallback if ffprobe fails
      }
    });

    proc.on("error", () => resolve(0));
  });
}

/**
 * Check if ffmpeg is available.
 */
export async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
