// Config API — serves the config management view in the Console
import { Hono } from "hono";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { detectAuth } from "#daemon/auth.js";
import { listSecretNames, setSecret, addSecretName } from "#core/secrets.js";
import { safeParseJsonFile } from "#core/schemas.js";

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

const VALID_TRUST_LEVELS = ["sandbox", "controlled", "unrestricted"] as const;

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

    // Embeddings — check for .onnx model file
    const modelsDir = path.join(workspaceDir, "models");
    let modelAvailable = false;
    if (fs.existsSync(modelsDir)) {
      modelAvailable = fs.readdirSync(modelsDir).some((f) => f.endsWith(".onnx"));
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
      voice: {
        mode: (settings.voiceMode as string) ?? "off",
        openaiKeyConfigured: openaiConfigured,
      },
      embeddings: {
        mode: (settings.embeddingsMode as string) ?? "local",
        modelAvailable,
      },
      security: {
        defaultTrust: (settings.defaultTrust as string) ?? "controlled",
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
    if (!telegram) {
      return c.json({ error: "telegram not configured" }, 400);
    }

    const { chatId: _removed, ...rest } = telegram;
    writeTelegram(workspaceDir, rest);
    return c.json({ ok: true });
  });

  // POST /voice — update voice settings
  app.post("/voice", async (c) => {
    const body = await c.req.json();
    const { mode, openaiKey } = body;

    if (!mode || !["api", "local", "off"].includes(mode)) {
      return c.json({ error: "mode must be 'api', 'local', or 'off'" }, 400);
    }

    writeSettings(workspaceDir, { voiceMode: mode });

    if (openaiKey && typeof openaiKey === "string") {
      setSecret("openai-api-key", openaiKey);
      addSecretName(workspaceDir, "openai-api-key");
    }

    return c.json({ ok: true, mode });
  });

  // POST /embeddings — update embedding settings
  app.post("/embeddings", async (c) => {
    const body = await c.req.json();
    const { mode } = body;

    if (!mode || !["local", "api"].includes(mode)) {
      return c.json({ error: "mode must be 'local' or 'api'" }, 400);
    }

    writeSettings(workspaceDir, { embeddingsMode: mode });
    return c.json({ ok: true, mode });
  });

  // POST /security — update default trust level
  app.post("/security", async (c) => {
    const body = await c.req.json();
    const { defaultTrust } = body;

    if (!defaultTrust || !(VALID_TRUST_LEVELS as readonly string[]).includes(defaultTrust)) {
      return c.json({ error: "defaultTrust must be 'sandbox', 'controlled', or 'unrestricted'" }, 400);
    }

    writeSettings(workspaceDir, { defaultTrust });
    return c.json({ ok: true, defaultTrust });
  });

  return app;
}
