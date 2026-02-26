import fs from "fs";
import path from "path";
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
  return fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })
    .then((res) => res.ok)
    .catch(() => false);
}

export async function waitForHealth(port: number, maxMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await probeHealth(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
