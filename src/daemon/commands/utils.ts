import fs from "fs";
import path from "path";
import https from "https";
import { resolveWorkspace } from "../workspace.js";

export interface PidInfo {
  pid: number;
  port: number;
}

export function readPidFile(): PidInfo | null {
  const pidPath = path.join(resolveWorkspace(), "daemon.pid");
  if (!fs.existsSync(pidPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pidPath, "utf-8"));
  } catch {
    return null;
  }
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Try HTTP first (default now)
    fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
      .then((res) => resolve(res.ok))
      .catch(() => {
        // HTTP failed, try HTTPS (legacy/Tailscale)
        const req = https.get(
          { hostname: "127.0.0.1", port, path: "/api/health", rejectUnauthorized: false, timeout: 2000 },
          (res) => resolve(res.statusCode === 200),
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
      });
  });
}

export async function waitForHealth(port: number, maxMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await probeHealth(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
