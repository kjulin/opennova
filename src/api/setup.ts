// Setup API — serves the onboarding wizard in the Console
import { Hono } from "hono";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { detectAuth } from "#daemon/auth.js";
import { listSecretNames, setSecret, addSecretName } from "#core/secrets.js";
import { safeParseJsonFile } from "#core/schemas.js";
import { loadAgents } from "#core/agents.js";

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

interface TailscaleStatus {
  installed: boolean;
  connected: boolean;
  hostname: string | null;
  certsReady: boolean;
}

function checkTailscale(): TailscaleStatus {
  const certDir = path.join(os.homedir(), ".nova", "certs");

  // Check if installed
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, ["tailscale"], { stdio: "ignore" });
  } catch {
    return { installed: false, connected: false, hostname: null, certsReady: false };
  }

  // Check if connected
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

  // Check certs
  const certsReady = fs.existsSync(certDir) &&
    fs.readdirSync(certDir).some((f) => f.endsWith(".crt"));

  return { installed: true, connected: true, hostname, certsReady };
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

export function createSetupRouter(workspaceDir: string): Hono {
  const app = new Hono();

  // GET /status — overall setup state
  app.get("/status", (c) => {
    const settings = readSettings(workspaceDir);
    const auth = detectAuth(workspaceDir);
    const telegram = readTelegram(workspaceDir);
    const secrets = listSecretNames(workspaceDir);
    const ts = checkTailscale();

    // Telegram status
    let telegramStatus: string;
    if (!telegram || !telegram.token) {
      telegramStatus = "not_configured";
    } else if (telegram.chatId) {
      telegramStatus = "paired";
    } else {
      telegramStatus = "token_saved";
    }

    // Tailscale status
    let tailscaleStatus: string;
    if (!ts.installed) {
      tailscaleStatus = "not_installed";
    } else if (!ts.connected) {
      tailscaleStatus = "not_connected";
    } else if (!ts.certsReady) {
      tailscaleStatus = "connected";
    } else {
      tailscaleStatus = "certs_ready";
    }

    const openaiDone = secrets.includes("openai-api-key");

    return c.json({
      complete: settings.setupComplete === true,
      steps: {
        workspace: { done: true, path: displayPath(workspaceDir) },
        auth: { done: auth.method !== "none", method: auth.method },
        telegram: { done: !!telegram?.chatId, status: telegramStatus },
        tailscale: {
          done: ts.certsReady,
          status: tailscaleStatus,
          skipped: settings.tailscaleSkipped === true,
        },
        openai: {
          done: openaiDone,
          skipped: settings.openaiSkipped === true,
        },
      },
    });
  });

  // GET /auth — auth detection
  app.get("/auth", (c) => {
    const auth = detectAuth(workspaceDir);
    return c.json(auth);
  });

  // POST /telegram — save token
  app.post("/telegram", async (c) => {
    const body = await c.req.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return c.json({ error: "token is required" }, 400);
    }

    const existing = readTelegram(workspaceDir) ?? {};

    // Ensure activeAgentId
    let agentId = existing.activeAgentId;
    if (!agentId) {
      const agents = loadAgents();
      const first = agents.keys().next();
      agentId = first.done ? undefined : first.value;
    }

    writeTelegram(workspaceDir, { ...existing, token, activeAgentId: agentId ?? "" });

    return c.json({ ok: true });
  });

  // GET /telegram/status — pairing status
  app.get("/telegram/status", (c) => {
    const telegram = readTelegram(workspaceDir);

    if (!telegram || !telegram.token) {
      return c.json({ status: "not_configured" });
    }

    if (telegram.chatId) {
      return c.json({
        status: "paired",
        chatId: telegram.chatId,
        ...(telegram.chatName ? { chatName: telegram.chatName } : {}),
      });
    }

    return c.json({ status: "waiting" });
  });

  // POST /tailscale — generate certs
  app.post("/tailscale", (c) => {
    const ts = checkTailscale();

    if (!ts.installed) {
      return c.json({ error: "tailscale is not installed" }, 400);
    }
    if (!ts.connected || !ts.hostname) {
      return c.json({ error: "tailscale is not connected" }, 400);
    }

    const certDir = path.join(os.homedir(), ".nova", "certs");
    fs.mkdirSync(certDir, { recursive: true });

    try {
      execFileSync("tailscale", [
        "cert",
        "--cert-file", path.join(certDir, `${ts.hostname}.crt`),
        "--key-file", path.join(certDir, `${ts.hostname}.key`),
      ], { encoding: "utf-8" });
    } catch (err) {
      return c.json({ error: `cert generation failed: ${(err as Error).message}` }, 500);
    }

    return c.json({ ok: true, hostname: ts.hostname });
  });

  // GET /tailscale/status — tailscale detection
  app.get("/tailscale/status", (c) => {
    const ts = checkTailscale();
    return c.json({
      installed: ts.installed,
      connected: ts.connected,
      hostname: ts.hostname,
      certsReady: ts.certsReady,
    });
  });

  // POST /openai — save OpenAI API key
  app.post("/openai", async (c) => {
    const body = await c.req.json();
    const { key } = body;

    if (!key || typeof key !== "string") {
      return c.json({ error: "key is required" }, 400);
    }

    setSecret("openai-api-key", key);
    addSecretName(workspaceDir, "openai-api-key");

    return c.json({ ok: true });
  });

  // POST /complete — mark setup complete
  app.post("/complete", (c) => {
    writeSettings(workspaceDir, { setupComplete: true });
    return c.json({ ok: true });
  });

  return app;
}
