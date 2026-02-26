// Config API — serves the config management view in the Console
import { Hono } from "hono";
import fs from "fs";
import path from "path";
import os from "os";
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

export function createConfigRouter(workspaceDir: string): Hono {
  const app = new Hono();

  // GET / — full config state
  app.get("/", (c) => {
    const settings = readSettings(workspaceDir);
    const auth = detectAuth();
    const telegram = readTelegram(workspaceDir);
    const secrets = listSecretNames(workspaceDir);
    const openaiConfigured = secrets.includes("openai-api-key");

    // Telegram section
    const telegramSection: Record<string, unknown> = { configured: false };
    if (telegram?.token) {
      telegramSection.configured = true;
      telegramSection.token = maskToken(telegram.token);
      if (telegram.chatId) telegramSection.chatId = telegram.chatId;
      if (telegram.chatName) telegramSection.chatName = telegram.chatName;
      if (telegram.activeAgentId) telegramSection.activeAgentId = telegram.activeAgentId;
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
