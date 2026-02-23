const SETUP_API = "/api/setup";

export interface SetupStatus {
  complete: boolean;
  steps: {
    workspace: { done: boolean; path: string };
    auth: { done: boolean; method: string };
    telegram: { done: boolean; status: string };
    tailscale: { done: boolean; status: string; skipped: boolean };
    openai: { done: boolean; skipped: boolean };
  };
}

export interface AuthStatus {
  method: string;
  detail?: string;
}

export interface TelegramStatus {
  status: "not_configured" | "waiting" | "paired";
  chatId?: string;
  chatName?: string;
}

export interface TailscaleStatus {
  installed: boolean;
  connected: boolean;
  hostname: string | null;
  certsReady: boolean;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await fetch(`${SETUP_API}/status`);
  if (!res.ok) throw new Error("Failed to fetch setup status");
  return res.json();
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${SETUP_API}/auth`);
  if (!res.ok) throw new Error("Failed to fetch auth status");
  return res.json();
}

export async function submitTelegramToken(token: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${SETUP_API}/telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error("Failed to save Telegram token");
  return res.json();
}

export async function fetchTelegramStatus(): Promise<TelegramStatus> {
  const res = await fetch(`${SETUP_API}/telegram/status`);
  if (!res.ok) throw new Error("Failed to fetch Telegram status");
  return res.json();
}

export async function fetchTailscaleStatus(): Promise<TailscaleStatus> {
  const res = await fetch(`${SETUP_API}/tailscale/status`);
  if (!res.ok) throw new Error("Failed to fetch Tailscale status");
  return res.json();
}

export async function generateTailscaleCerts(): Promise<{ ok: boolean; hostname: string }> {
  const res = await fetch(`${SETUP_API}/tailscale`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to generate Tailscale certs");
  return res.json();
}

export async function submitOpenAIKey(key: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${SETUP_API}/openai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error("Failed to save OpenAI key");
  return res.json();
}

export async function completeSetup(): Promise<{ ok: boolean }> {
  const res = await fetch(`${SETUP_API}/complete`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to complete setup");
  return res.json();
}
