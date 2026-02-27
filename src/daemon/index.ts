import fs from "fs";
import path from "path";
import { init } from "./init.js";
import { loadChannels, getCurrentShutdown } from "./channels.js";
import { startTriggerScheduler } from "./triggers.js";
import { startServer } from "./https.js";
import { detectAuth } from "./auth.js";
import { Config } from "#core/index.js";
import { startTaskScheduler } from "#tasks/index.js";
import { startEpisodicBackfillScheduler } from "./episodic-backfill.js";
import { log } from "./logger.js";

export function start() {
  init();

  log.info("daemon", `workspace: ${Config.workspaceDir}`);
  log.info("daemon", `node: ${process.version}, platform: ${process.platform}`);

  // Detect authentication (daemon starts regardless of auth state)
  const auth = detectAuth();
  if (auth.method === "none") {
    log.warn("daemon", "no authentication found — agents will not work until auth is configured");
  } else {
    log.info("daemon", `auth: ${auth.detail}`);
  }

  const { channels, shutdown } = loadChannels();

  if (channels.length === 0) {
    log.warn("daemon", "no channels configured — run 'nova init' to set up Telegram");
  } else {
    for (const ch of channels) {
      log.info("daemon", `channel: ${ch.name} (${ch.detail})`);
    }
  }

  // Start server (skipped in cloud mode)
  const server = startServer(Config.workspaceDir);
  if (server) {
    log.info("daemon", `server: http://${server.hostname}:${server.port}`);
  }

  // Write PID file
  const pidFile = path.join(Config.workspaceDir, "daemon.pid");
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: server?.port ?? 0 }) + "\n");

  const triggerInterval = startTriggerScheduler();
  const taskScheduler = startTaskScheduler();
  const episodicBackfillScheduler = startEpisodicBackfillScheduler();
  log.info("daemon", "nova daemon started");

  function handleSignal(signal: string) {
    log.info("daemon", `received ${signal}, shutting down…`);
    clearInterval(triggerInterval);
    taskScheduler.stop();
    episodicBackfillScheduler.stop();
    server?.shutdown();
    const channelShutdown = getCurrentShutdown();
    if (channelShutdown) channelShutdown();
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
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
