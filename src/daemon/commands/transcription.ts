import {
  checkTranscriptionDependencies,
  downloadModel,
  loadTranscriptionConfig,
  saveTranscriptionConfig,
  MODEL_SIZES,
  MODEL_URLS,
} from "#core/index.js";

export async function transcriptionSetup(model?: string) {
  console.log("Setting up local transcription...\n");

  const config = loadTranscriptionConfig();
  const targetModel = model ?? config.model ?? "large-v3";

  // Check ffmpeg
  const deps = await checkTranscriptionDependencies();

  if (deps.ffmpeg) {
    console.log("✓ ffmpeg installed");
  } else {
    console.log("✗ ffmpeg not found");
    console.log("  Install with: brew install ffmpeg\n");
    return;
  }

  // Check whisper-cpp
  if (deps.whisper) {
    console.log("✓ whisper-cpp installed");
  } else {
    console.log("✗ whisper-cpp not found");
    console.log("  Install with: brew install whisper-cpp\n");
    return;
  }

  // Check/download model
  if (deps.model) {
    console.log(`✓ Model ready (${targetModel})`);
  } else {
    console.log(`\nDownloading Whisper ${targetModel} model (${MODEL_SIZES[targetModel]})...`);

    let lastPercent = 0;
    await downloadModel(targetModel, (percent) => {
      if (percent >= lastPercent + 10) {
        process.stdout.write(`  ${percent}%`);
        lastPercent = percent;
      }
    });
    console.log(" done\n");
    console.log(`✓ Model downloaded`);
  }

  // Save config
  saveTranscriptionConfig({
    ...config,
    model: targetModel,
  });

  console.log(`\n✅ Transcription setup complete!`);
  console.log(`   Model: ${targetModel}`);
  console.log(`   Language: ${config.language}`);
  console.log(`\nYou can now send voice messages to your agents via Telegram.`);
}

export async function transcriptionStatus() {
  const config = loadTranscriptionConfig();
  const deps = await checkTranscriptionDependencies();

  console.log("Transcription Status\n");

  console.log(`Model: ${config.model}`);
  console.log(`Language: ${config.language}`);
  console.log("");

  console.log("Dependencies:");
  console.log(`  ffmpeg:      ${deps.ffmpeg ? "✓" : "✗"}`);
  console.log(`  whisper-cpp: ${deps.whisper ? "✓" : "✗"}`);
  console.log(`  model:       ${deps.model ? "✓" : "✗"} (${deps.modelPath})`);

  if (!deps.ffmpeg || !deps.whisper || !deps.model) {
    console.log("\nRun 'nova transcription setup' to install missing components.");
  }
}

export function transcriptionModels() {
  console.log("Available Whisper Models\n");

  for (const [name, size] of Object.entries(MODEL_SIZES)) {
    console.log(`  ${name.padEnd(12)} ${size}`);
  }

  console.log("\nUse 'nova transcription setup <model>' to install a specific model.");
  console.log("Recommended: large-v3 for best quality, small for faster processing.");
}
