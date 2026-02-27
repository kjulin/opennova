import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline/promises";
import { execFileSync } from "child_process";
import { detectAuth } from "../auth.js";
import { Config } from "#core/config.js";
import { downloadEmbeddingModel, isModelAvailable } from "#core/episodic/index.js";
import { setConfigValue, getWorkspaceId } from "../workspace.js";
import { waitForHealth } from "./utils.js";

const platform = process.platform;
const DEFAULT_PORT = 3838;

function parsePort(): number {
  const idx = process.argv.indexOf("--port");
  if (idx === -1 || idx + 1 >= process.argv.length) return DEFAULT_PORT;
  const val = parseInt(process.argv[idx + 1]!, 10);
  if (isNaN(val) || val < 1 || val > 65535) {
    console.error(`Invalid port: ${process.argv[idx + 1]}`);
    process.exit(1);
  }
  return val;
}

function box(lines: string[]): string {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const top = `\u250c${"\u2500".repeat(width)}\u2510`;
  const bot = `\u2514${"\u2500".repeat(width)}\u2518`;
  const rows = lines.map((l) => `\u2502  ${l.padEnd(width - 2)}\u2502`);
  return [top, ...rows, bot].join("\n");
}

function resolveNovaBin(): string {
  const cmd = process.platform === "win32" ? "where" : "which";
  return execFileSync(cmd, ["nova"], { encoding: "utf-8" }).trim();
}

function installDaemonMacOS(novaBin: string, workspace: string, port: number): void {
  const PLIST_LABEL = "dev.opennova.daemon";
  const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
  const logPath = path.join(workspace, "logs", "daemon.log");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${novaBin}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NOVA_WORKSPACE</key>
    <string>${workspace}</string>
    <key>NOVA_PORT</key>
    <string>${port}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

  // Unload existing service if present
  if (fs.existsSync(PLIST_PATH)) {
    try {
      execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
    } catch { /* may not be loaded */ }
  }

  // Write plist and load
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, plist);
  execFileSync("launchctl", ["load", PLIST_PATH]);
  console.log("  Daemon installed as LaunchAgent.");
}

function installDaemonLinux(novaBin: string, workspace: string, port: number): void {
  const servicePath = "/etc/systemd/system/opennova-daemon.service";
  const logPath = path.join(workspace, "logs", "daemon.log");

  const unit = `[Unit]
Description=OpenNova Daemon
After=network.target

[Service]
Type=simple
ExecStart=${novaBin} daemon
Environment=NOVA_WORKSPACE=${workspace}
Environment=NOVA_PORT=${port}
Environment=PATH=${process.env.PATH}
Restart=always
RestartSec=5
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=multi-user.target
`;

  // Stop existing service (ignore errors if not present)
  try {
    execFileSync("systemctl", ["stop", "opennova-daemon"], { stdio: "ignore" });
  } catch { /* may not exist yet */ }

  // Write service file, reload, enable, start
  fs.writeFileSync(servicePath, unit);
  execFileSync("systemctl", ["daemon-reload"]);
  execFileSync("systemctl", ["enable", "opennova-daemon"], { stdio: "ignore" });
  execFileSync("systemctl", ["start", "opennova-daemon"]);
  console.log("  Daemon installed as systemd service.");
}


export async function run() {
  const port = parsePort();

  console.log("\nWelcome to Nova!\n");

  // 1. Check Claude Code auth
  const auth = detectAuth();
  if (auth.method === "none") {
    console.log(box([
      "Claude Code not detected.",
      "",
      "Nova requires Claude Code to be installed and",
      "logged in.",
      "",
      "Install:  npm install -g @anthropic-ai/claude-code",
      "Login:    claude login",
      "",
      "Then run 'nova init' again.",
    ]));
    console.log();
    process.exit(1);
  }

  console.log(`Claude Code detected (${auth.method === "claude-code" ? "subscription" : "API key"}).\n`);

  // 2. Select workspace path
  const defaultWorkspace = path.join(os.homedir(), ".nova");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Workspace path [${defaultWorkspace}]: `)).trim();
  rl.close();

  const workspace = answer || defaultWorkspace;

  // 3. Set up workspace
  const workspaceExists = fs.existsSync(workspace);
  if (!workspaceExists) {
    const templateDir = path.resolve(import.meta.dirname, "..", "..", "..", "workspace-template");
    fs.cpSync(templateDir, workspace, { recursive: true });
    console.log(`\nCreated workspace at ${workspace}`);
  } else {
    console.log(`\nUsing existing workspace at ${workspace}`);
  }

  // Ensure logs directory exists
  fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });

  // 4. Console access mode
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("Console access mode:");
  console.log("  1) Local — localhost only (default)");
  console.log("  2) Network — accessible from LAN");
  console.log("  3) Cloud — relay via Supabase");
  const accessAnswer = (await rl2.question("Choose [1]: ")).trim();
  rl2.close();

  const accessMode = accessAnswer === "2" ? "network" : accessAnswer === "3" ? "cloud" : "local";
  setConfigValue(workspace, "settings.consoleAccess", accessMode);

  // Generate workspace ID (persists across restarts, used for cloud relay channel)
  getWorkspaceId(workspace);

  // Download embeddings model if needed
  Config.workspaceDir = workspace;
  if (!isModelAvailable()) {
    console.log("Downloading embedding model (all-MiniLM-L6-v2, ~80MB)...");
    try {
      let lastPercent = 0;
      await downloadEmbeddingModel((file, percent) => {
        if (percent >= lastPercent + 10) {
          process.stdout.write(`  ${file}: ${percent}%\r`);
          lastPercent = percent;
        }
      });
      console.log("  Embedding model downloaded.         ");
    } catch (err) {
      console.log(`  Warning: could not download embedding model: ${(err as Error).message}`);
    }
  }

  // 4. Install & start daemon
  console.log("\nSetting up daemon...");

  let novaBin: string;
  try {
    novaBin = resolveNovaBin();
  } catch {
    console.log("  Could not find 'nova' on PATH. Start the daemon manually with 'nova daemon'.");
    process.exit(1);
  }

  if (platform === "darwin") {
    installDaemonMacOS(novaBin, workspace, port);
  } else {
    installDaemonLinux(novaBin, workspace, port);
  }

  // Wait for health
  process.stdout.write("  Starting...");
  const healthy = await waitForHealth(port);
  if (healthy) {
    console.log(" ready.");
  } else {
    console.log(" timed out. Check logs at " + path.join(workspace, "logs", "daemon.log"));
  }

  // 5. Show Admin UI URL
  if (healthy) {
    const consoleUrl = accessMode === "cloud"
      ? "https://my.outernova.cloud"
      : `http://localhost:${port}/`;
    const lines: string[] = [
      "Nova is running!", "",
      `Console:  ${consoleUrl}`,
      "", "Or pair Telegram via CLI:", "  nova telegram pair",
    ];

    console.log("\n" + box(lines));
  }

  console.log("\nNova init completed!\n");
}
