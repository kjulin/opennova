import fs from "fs";
import path from "path";
import { resolveWorkspace } from "../workspace.js";

interface PidInfo {
  pid: number;
  port: number;
}

function readPidFile(): PidInfo | null {
  const pidPath = path.join(resolveWorkspace(), "daemon.pid");
  if (!fs.existsSync(pidPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pidPath, "utf-8"));
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function run() {
  const subcommand = process.argv[3];

  if (subcommand === "stop") {
    const info = readPidFile();
    if (!info || !isRunning(info.pid)) {
      console.log("Daemon is not running.");
      return;
    }
    process.kill(info.pid, "SIGTERM");
    console.log(`Daemon (pid ${info.pid}, port ${info.port}) stopped.`);
    return;
  }

  if (subcommand === "status") {
    const info = readPidFile();
    if (!info) {
      console.log("Daemon is not running (no PID file).");
      return;
    }
    if (!isRunning(info.pid)) {
      console.log(`Daemon is not running (stale PID file, pid ${info.pid}).`);
      return;
    }
    console.log(`Daemon is running (pid ${info.pid}, port ${info.port}).`);
    return;
  }

  const { start } = await import("../index.js");
  start();
}
