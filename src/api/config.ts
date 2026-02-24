// Config API — serves the config management view in the Console
import { Hono } from "hono";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { detectAuth } from "#daemon/auth.js";
import { listSecretNames, setSecret, addSecretName } from "#core/secrets.js";
import { safeParseJsonFile } from "#core/schemas.js";
import { startPairing, getPairingStatus } from "#daemon/pairing-manager.js";
import { reloadChannels } from "#daemon/channels.js";

function readSettings(workspaceDir: string): Record<string, unknown> {
  const p = path.join(workspaceDir, "settings.json");
  if (!fs.existsSync(p)) return {};
  const raw = safeParseJsonFile(p, "settings.json");
  return (raw as Record<string, unknown>) ?? {};
}

function writeSettings(workspaceDir: string, patch: Record<string, unknown>): void {
  const current = readSettings(workspaceDir);
  Object.assign(current, patch);
  fs.writeFileSync(path.join(workspaceDir, "settings.json"), JSON.stringify(current, null, 2) + "\n");
}

function displayPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

interface TelegramJson {
  token?: string;
  chatId?: string;
  chatName?: string;
  activeAgentId?: string;
  activeThreadId?: string;
  agentBots?: Record<string, unknown>;
}

function readTelegram(workspaceDir: string): TelegramJson | null {
  const p = path.join(workspaceDir, "telegram.json");
  if (!fs.existsSync(p)) return null;
  const raw = safeParseJsonFile(p, "telegram.json");
  return (raw as TelegramJson) ?? null;
}

function writeTelegram(workspaceDir: string, data: TelegramJson): void {
  fs.writeFileSync(
    path.join(workspaceDir, "telegram.json"),
    JSON.stringify(data, null, 2) + "\n",
    { mode: 0o600 },
  );
}

interface TailscaleInfo {
  installed: boolean;
  connected: boolean;
  hostname: string | null;
  certsReady: boolean;
}

function checkTailscale(): TailscaleInfo {
  const certDir = path.join(os.homedir(), ".nova", "certs");

  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, ["tailscale"], { stdio: "ignore" });
  } catch {
    return { installed: false, connected: false, hostname: null, certsReady: false };
  }

  let hostname: string | null = null;
  try {
    const out = execFileSync("tailscale", ["status", "--json"], { encoding: "utf-8" });
    const status = JSON.parse(out) as { Self?: { DNSName?: string } };
    const dns = status.Self?.DNSName;
    if (dns) {
      hostname = dns.replace(/\.$/, "");
    }
  } catch {
    return { installed: true, connected: false, hostname: null, certsReady: false };
  }

  if (!hostname) {
    return { installed: true, connected: false, hostname: null, certsReady: false };
  }

  const certsReady = fs.existsSync(certDir) &&
    fs.readdirSync(certDir).some((f) => f.endsWith(".crt"));

  return { installed: true, connected: true, hostname, certsReady };
}

export function createConfigRouter(workspaceDir: string): Hono {
  const app = new Hono();

  // GET / — full config state
  app.get("/", (c) => {
    const settings = readSettings(workspaceDir);
    const auth = detectAuth(workspaceDir);
    const telegram = readTelegram(workspaceDir);
    const secrets = listSecretNames(workspaceDir);
    const ts = checkTailscale();
    const openaiConfigured = secrets.includes("openai-api-key");

    // Telegram section
    const telegramSection: Record<string, unknown> = { configured: false };
    if (telegram?.token) {
      telegramSection.configured = true;
      telegramSection.token = maskToken(telegram.token);
      if (telegram.chatId) telegramSection.chatId = telegram.chatId;
      if (telegram.activeAgentId) telegramSection.activeAgentId = telegram.activeAgentId;
    }

    // Tailscale section
    const tailscaleSection: Record<string, unknown> = {
      installed: ts.installed,
      connected: ts.connected,
      hostname: ts.hostname,
      certsReady: ts.certsReady,
    };
    if (ts.certsReady && ts.hostname) {
      tailscaleSection.url = `https://${ts.hostname}:3838`;
    }

    // Daemon version from package.json
    const pkgPath = path.resolve(import.meta.dirname, "..", "..", "package.json");
    let version = "unknown";
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
      version = pkg.version ?? "unknown";
    } catch { /* ignore */ }

    return c.json({
      workspace: { path: displayPath(workspaceDir) },
      auth: { method: auth.method, ...(auth.detail ? { detail: auth.detail } : {}) },
      telegram: telegramSection,
      tailscale: tailscaleSection,
      audio: {
        transcription: {
          modelAvailable: (() => {
            const dir = path.join(workspaceDir, "transcription", "models");
            return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".bin"));
          })(),
        },
        tts: {
          openaiKeyConfigured: openaiConfigured,
        },
      },
      daemon: {
        version,
        uptime: Math.floor(process.uptime()),
        autoStart: settings.autoStart !== false,
      },
    });
  });

  // GET /daemon — daemon status
  app.get("/daemon", (c) => {
    const settings = readSettings(workspaceDir);
    const pkgPath = path.resolve(import.meta.dirname, "..", "..", "package.json");
    let version = "unknown";
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
      version = pkg.version ?? "unknown";
    } catch { /* ignore */ }

    return c.json({
      version,
      uptime: Math.floor(process.uptime()),
      autoStart: settings.autoStart !== false,
    });
  });

  // POST /daemon — toggle auto-start
  app.post("/daemon", async (c) => {
    const body = await c.req.json();
    const { autoStart } = body;

    if (typeof autoStart !== "boolean") {
      return c.json({ error: "autoStart must be a boolean" }, 400);
    }

    writeSettings(workspaceDir, { autoStart });
    return c.json({ ok: true, autoStart });
  });

  // POST /telegram/pair — re-pair Telegram
  app.post("/telegram/pair", (c) => {
    const telegram = readTelegram(workspaceDir);
    if (!telegram?.token) {
      return c.json({ error: "telegram not configured" }, 400);
    }

    const { chatId: _removed, chatName: _removedName, ...rest } = telegram;
    writeTelegram(workspaceDir, rest);

    // Start pairing session
    startPairing(telegram.token, workspaceDir, () => reloadChannels());

    return c.json({ ok: true });
  });

  // GET /telegram/pair/status — pairing session status
  app.get("/telegram/pair/status", (c) => {
    const pairing = getPairingStatus();
    return c.json(pairing);
  });

  // POST /audio/tts — update TTS settings (OpenAI key)
  app.post("/audio/tts", async (c) => {
    const body = await c.req.json();
    const { openaiKey } = body;

    if (!openaiKey || typeof openaiKey !== "string") {
      return c.json({ error: "openaiKey must be a non-empty string" }, 400);
    }

    setSecret("openai-api-key", openaiKey);
    addSecretName(workspaceDir, "openai-api-key");
    return c.json({ ok: true });
  });

  return app;
}
