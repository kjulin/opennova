import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { resolveWorkspace } from "../workspace.js";

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

  const logFile = path.join(workspaceDir, "logs", "daemon.log");
  if (!fs.existsSync(logFile)) {
    console.log(`No log file found at ${logFile}`);
    process.exit(1);
  }

  // Parse --lines flag (default: 50)
  let lines = "50";
  const args = process.argv.slice(3);
  const linesIdx = args.indexOf("--lines");
  const linesArg = linesIdx !== -1 ? args[linesIdx + 1] : undefined;
  if (linesArg) {
    const n = parseInt(linesArg, 10);
    if (!isNaN(n) && n > 0) {
      lines = String(n);
    }
  }

  const tail = spawn("tail", ["-n", lines, "-f", logFile], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  // Clean exit on Ctrl+C
  const cleanup = () => {
    tail.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  tail.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
