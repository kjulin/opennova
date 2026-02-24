import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { resolveWorkspace } from "../workspace.js";
import { readPidFile, isRunning, waitForHealth } from "./utils.js";

export async function run() {
  let workspaceDir: string;
  try {
    workspaceDir = resolveWorkspace();
  } catch {
    console.log("Workspace not found. Run 'nova init' first.");
    process.exit(1);
  }

  if (!fs.existsSync(workspaceDir)) {
    console.log("Workspace not found. Run 'nova init' first.");
    process.exit(1);
  }

  // Check if already running
  const pidInfo = readPidFile();
  if (pidInfo && isRunning(pidInfo.pid)) {
    console.log(`Daemon is already running (pid ${pidInfo.pid}, port ${pidInfo.port}).`);
    process.exit(0);
  }

  // Start via platform service manager
  try {
    if (process.platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "dev.opennova.daemon.plist");
      execFileSync("launchctl", ["load", plistPath]);
    } else {
      execFileSync("systemctl", ["start", "opennova-daemon"]);
    }
  } catch (err) {
    console.log("Failed to start daemon. Is the service installed? Run 'nova init' first.");
    process.exit(1);
  }

  // Wait for health check
  const newPid = readPidFile();
  const port = newPid?.port ?? 3838;

  const healthy = await waitForHealth(port);
  if (healthy) {
    const info = readPidFile();
    console.log(`Daemon started (pid ${info?.pid ?? "unknown"}, port ${info?.port ?? port}).`);
  } else {
    console.log(`Daemon failed to start. Check logs at ${workspaceDir}/logs/daemon.log`);
    process.exit(1);
  }
}
