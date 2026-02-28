import fs from "fs";
import { getSecret } from "../secrets.js";

export interface TranscriptionResult {
  text: string;
  duration: number;
  language: string;
}

/**
 * Transcribe an audio file to text using the OpenAI Whisper API.
 * Supports mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg, flac.
 */
export async function transcribe(audioPath: string): Promise<TranscriptionResult> {
  const apiKey = getSecret("openai-api-key");

  const fileBuffer = fs.readFileSync(audioPath);
  const fileName = audioPath.split("/").pop() ?? "audio.ogg";

  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), fileName);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Whisper API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { text: string; duration: number; language: string };

  return {
    text: data.text,
    duration: data.duration,
    language: data.language,
  };
}
