import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "../logger.js";

export interface WhisperOptions {
  modelPath: string;
  language?: string;    // "en", "auto", etc.
  translate?: boolean;  // Translate to English
}

export interface WhisperResult {
  text: string;
  language: string;
}

/**
 * Run whisper.cpp on a WAV file.
 * The WAV must be 16kHz mono PCM (use convertToWav first).
 */
export async function runWhisper(
  wavPath: string,
  options: WhisperOptions
): Promise<WhisperResult> {
  const { modelPath, language = "en", translate = false } = options;

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${modelPath}`);
  }

  if (!fs.existsSync(wavPath)) {
    throw new Error(`Audio file not found: ${wavPath}`);
  }

  log.info("transcription", `running whisper on ${path.basename(wavPath)}`);

  // Output to temp file
  const outputBase = path.join(os.tmpdir(), `nova-whisper-${Date.now()}`);

  return new Promise((resolve, reject) => {
    const args = [
      "-m", modelPath,
      "-f", wavPath,
      "-l", language,
      "--no-timestamps",
      "-of", outputBase,    // Output file base (will create .txt)
      "-otxt",              // Output as plain text
    ];

    if (translate) {
      args.push("--translate");
    }

    log.debug("transcription", `whisper args: ${args.join(" ")}`);

    const proc = spawn("whisper-cpp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (d) => stderr += d.toString());

    proc.on("close", (code) => {
      const outputPath = `${outputBase}.txt`;

      if (code === 0 && fs.existsSync(outputPath)) {
        const text = fs.readFileSync(outputPath, "utf-8").trim();

        // Cleanup output file
        try { fs.unlinkSync(outputPath); } catch {}

        // Extract detected language from stderr if auto
        let detectedLang = language;
        const langMatch = stderr.match(/auto-detected language: (\w+)/);
        if (langMatch && langMatch[1]) {
          detectedLang = langMatch[1];
        }

        log.info("transcription", `transcribed ${text.length} chars (lang: ${detectedLang})`);
        resolve({ text, language: detectedLang });
      } else {
        reject(new Error(`whisper-cpp failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`whisper-cpp not found: ${err.message}. Install with: brew install whisper-cpp`));
    });
  });
}

/**
 * Check if whisper-cpp is available.
 */
export async function checkWhisper(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("whisper-cpp", ["--help"], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Get the default model path.
 */
export function getDefaultModelPath(workspaceDir: string, model = "large-v3"): string {
  return path.join(workspaceDir, "transcription", "models", `ggml-${model}.bin`);
}

/**
 * Model download URLs from Hugging Face.
 */
export const MODEL_URLS: Record<string, string> = {
  "tiny": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  "base": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  "small": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
  "medium": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
  "large-v3": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
};

/**
 * Model sizes for display.
 */
export const MODEL_SIZES: Record<string, string> = {
  "tiny": "75 MB",
  "base": "142 MB",
  "small": "466 MB",
  "medium": "1.5 GB",
  "large-v3": "3.1 GB",
};
