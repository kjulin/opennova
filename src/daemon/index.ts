import fs from "fs";
import path from "path";
import { init } from "./init.js";
import { loadChannels } from "./channels.js";
import { startTriggerScheduler } from "./triggers.js";
import { startHttpsServer, type HttpsServer } from "./https.js";
import { ensureAuth } from "./auth.js";
import { Config, loadSettings } from "#core/index.js";
import { syncSharedSkills } from "#core/skills.js";
import { log } from "./logger.js";

export function start() {
  init();
  syncSharedSkills(Config.workspaceDir);

  log.info("daemon", `workspace: ${Config.workspaceDir}`);
  log.info("daemon", `node: ${process.version}, platform: ${process.platform}`);

  const settingsPath = path.join(Config.workspaceDir, "settings.json");
  if (!fs.existsSync(settingsPath)) {
    log.warn("security", "no settings.json found — defaulting to \"standard\"");
    log.warn("security", "run 'nova init' to configure your security level");
  }

  const settings = loadSettings();
  log.info("daemon", `security: ${settings.defaultSecurity} (default)`);

  // Verify authentication before starting
  const auth = ensureAuth(Config.workspaceDir);
  log.info("daemon", `auth: ${auth.detail}`);

  const { channels, shutdown } = loadChannels();

  if (channels.length === 0) {
    log.warn("daemon", "no channels configured — run 'nova init' to set up Telegram");
  } else {
    for (const ch of channels) {
      log.info("daemon", `channel: ${ch.name} (${ch.detail})`);
    }
  }

  // Start HTTPS server (optional - only if Tailscale certs exist)
  const httpsServer = startHttpsServer(Config.workspaceDir);
  if (httpsServer) {
    log.info("daemon", `https: https://${httpsServer.hostname}:${httpsServer.port}`);
  }

  const triggerInterval = startTriggerScheduler();
  log.info("daemon", "nova daemon started");

  function handleSignal(signal: string) {
    log.info("daemon", `received ${signal}, shutting down…`);
    clearInterval(triggerInterval);
    httpsServer?.shutdown();
    shutdown();
    log.info("daemon", "nova daemon stopped");
    log.close();
    process.exit(0);
  }

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("unhandledRejection", (err) => {
    log.error("daemon", "unhandled rejection:", err);
  });
}
