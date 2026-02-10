import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../logger.js";

export interface TTSOptions {
  voice?: string;  // macOS voice name (e.g., "Samantha", "Daniel")
  rate?: number;   // Speech rate (words per minute, default ~175)
}

export interface TTSResult {
  audioPath: string;
  duration: number;
}

/**
 * Convert text to speech using macOS `say` command.
 * Returns path to OGG file suitable for Telegram.
 */
export async function textToSpeech(
  text: string,
  options?: TTSOptions
): Promise<TTSResult> {
  const { voice = "Samantha", rate } = options ?? {};

  // Generate unique temp file paths
  const timestamp = Date.now();
  const aiffPath = path.join(os.tmpdir(), `nova-tts-${timestamp}.aiff`);
  const oggPath = path.join(os.tmpdir(), `nova-tts-${timestamp}.ogg`);

  log.info("tts", `generating speech (${text.length} chars, voice: ${voice})`);

  // Step 1: Generate AIFF using macOS say
  await runSay(text, aiffPath, voice, rate);

  // Step 2: Convert to OGG (Opus) for Telegram
  await convertToOgg(aiffPath, oggPath);

  // Cleanup AIFF
  try { fs.unlinkSync(aiffPath); } catch {}

  // Get duration
  const duration = await getAudioDuration(oggPath);

  log.info("tts", `generated ${duration}s audio`);

  return { audioPath: oggPath, duration };
}

async function runSay(
  text: string,
  outputPath: string,
  voice: string,
  rate?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-v", voice, "-o", outputPath];
    if (rate) {
      args.push("-r", String(rate));
    }

    const proc = spawn("say", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Send text via stdin to handle special characters
    proc.stdin.write(text);
    proc.stdin.end();

    let stderr = "";
    proc.stderr.on("data", (d) => stderr += d.toString());

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`say failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`say command not found: ${err.message}`));
    });
  });
}

async function convertToOgg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputPath,
      "-c:a", "libopus",
      "-b:a", "64k",
      "-y",
      outputPath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => stderr += d.toString());

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-200)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`ffmpeg not found: ${err.message}`));
    });
  });
}

async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
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
        resolve(isNaN(duration) ? 0 : Math.round(duration));
      } else {
        resolve(0);
      }
    });

    proc.on("error", () => resolve(0));
  });
}

/**
 * List available macOS voices.
 */
export async function listVoices(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn("say", ["-v", "?"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (d) => stdout += d.toString());

    proc.on("close", () => {
      const voices = stdout
        .split("\n")
        .map((line) => line.split(/\s+/)[0])
        .filter((v): v is string => Boolean(v));
      resolve(voices);
    });

    proc.on("error", () => resolve([]));
  });
}

/**
 * Check if TTS is available (macOS only).
 */
export async function checkTTS(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("say", ["--version"], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
