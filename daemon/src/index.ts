import { init } from "./init.js";
import { loadChannels } from "./channels.js";
import { startTriggerScheduler } from "./triggers.js";
import { ensureAuth } from "./auth.js";
import { Config } from "./config.js";

export function start() {
  init();

  // Verify authentication before starting
  const auth = ensureAuth(Config.workspaceDir);
  console.log(`auth: ${auth.detail}`);

  const { channels, shutdown } = loadChannels();

  if (channels.length === 0) {
    console.warn("warning: no channels configured — run 'nova init' to set up Telegram or HTTP API");
  } else {
    for (const ch of channels) {
      console.log(`channel: ${ch.name} (${ch.detail})`);
    }
  }

  const triggerInterval = startTriggerScheduler();
  console.log("nova daemon started — press Ctrl+C to stop");

  function handleSignal(signal: string) {
    console.log(`received ${signal}, shutting down…`);
    clearInterval(triggerInterval);
    shutdown();
    console.log("nova daemon stopped");
    process.exit(0);
  }

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}
