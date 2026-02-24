import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { readPidFile, isRunning } from "./utils.js";

export function run() {
  const pidInfo = readPidFile();
  if (!pidInfo || !isRunning(pidInfo.pid)) {
    console.log("Daemon is not running.");
    process.exit(0);
  }

  try {
    if (process.platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "dev.opennova.daemon.plist");
      execFileSync("launchctl", ["unload", plistPath]);
    } else {
      execFileSync("systemctl", ["stop", "opennova-daemon"]);
    }
  } catch (err) {
    console.log("Failed to stop daemon.");
    process.exit(1);
  }

  console.log("Daemon stopped.");
}
