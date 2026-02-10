import fs from "fs";
import path from "path";
import { Config } from "../config.js";
import { log } from "../logger.js";
import { convertToWav, getAudioDuration, checkFfmpeg } from "./convert.js";
import { runWhisper, checkWhisper, getDefaultModelPath, MODEL_URLS, MODEL_SIZES } from "./whisper.js";

export interface TranscriptionConfig {
  model: string;
  language: string;
  modelPath?: string;
  vocabulary?: string[];
}

export interface TranscriptionResult {
  text: string;
  duration: number;
  language: string;
}

export interface TranscriptionOptions {
  language?: string;
  model?: string;
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  model: "large-v3",
  language: "en",
};

/**
 * Load transcription config from ~/.nova/transcription/config.json
 */
export function loadTranscriptionConfig(): TranscriptionConfig {
  const configPath = path.join(Config.workspaceDir, "transcription", "config.json");

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return { ...DEFAULT_CONFIG, ...data };
    } catch (err) {
      log.warn("transcription", `failed to load config: ${(err as Error).message}`);
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Save transcription config.
 */
export function saveTranscriptionConfig(config: TranscriptionConfig): void {
  const configDir = path.join(Config.workspaceDir, "transcription");
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = path.join(configDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Transcribe an audio file to text.
 * Supports OGG, MP3, WAV, M4A, and other ffmpeg-compatible formats.
 */
export async function transcribe(
  audioPath: string,
  options?: TranscriptionOptions
): Promise<TranscriptionResult> {
  const config = loadTranscriptionConfig();
  const language = options?.language ?? config.language;
  const model = options?.model ?? config.model;

  // Get model path
  const modelPath = config.modelPath ?? getDefaultModelPath(Config.workspaceDir, model);

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `Whisper model not found at ${modelPath}. Run 'nova transcription setup' first.`
    );
  }

  // Get audio duration before conversion
  const duration = await getAudioDuration(audioPath);

  // Convert to WAV if needed
  let wavPath = audioPath;
  const ext = path.extname(audioPath).toLowerCase();

  if (ext !== ".wav") {
    wavPath = await convertToWav(audioPath);
  }

  try {
    // Run Whisper
    const result = await runWhisper(wavPath, {
      modelPath,
      language,
    });

    return {
      text: result.text,
      duration,
      language: result.language,
    };
  } finally {
    // Cleanup temp WAV if we created one
    if (wavPath !== audioPath) {
      try { fs.unlinkSync(wavPath); } catch {}
    }
  }
}

/**
 * Check if transcription dependencies are available.
 */
export async function checkDependencies(): Promise<{
  ffmpeg: boolean;
  whisper: boolean;
  model: boolean;
  modelPath: string;
}> {
  const config = loadTranscriptionConfig();
  const modelPath = config.modelPath ?? getDefaultModelPath(Config.workspaceDir, config.model);

  const [ffmpeg, whisper] = await Promise.all([
    checkFfmpeg(),
    checkWhisper(),
  ]);

  return {
    ffmpeg,
    whisper,
    model: fs.existsSync(modelPath),
    modelPath,
  };
}

/**
 * Download a Whisper model.
 */
export async function downloadModel(
  model: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const url = MODEL_URLS[model];
  if (!url) {
    throw new Error(`Unknown model: ${model}. Available: ${Object.keys(MODEL_URLS).join(", ")}`);
  }

  const modelPath = getDefaultModelPath(Config.workspaceDir, model);
  const modelDir = path.dirname(modelPath);
  fs.mkdirSync(modelDir, { recursive: true });

  log.info("transcription", `downloading ${model} model (${MODEL_SIZES[model]})...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get("content-length") ?? "0");
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Failed to read response body");
  }

  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedLength += value.length;

    if (contentLength > 0 && onProgress) {
      onProgress(Math.round((receivedLength / contentLength) * 100));
    }
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(modelPath, buffer);

  log.info("transcription", `model saved to ${modelPath}`);
  return modelPath;
}

// Re-export utilities
export { MODEL_URLS, MODEL_SIZES } from "./whisper.js";
export { checkFfmpeg } from "./convert.js";
export { checkWhisper } from "./whisper.js";
