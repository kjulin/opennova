import { CoworkSession } from "./session.js";
import { log } from "../logger.js";
import type { CoworkSessionConfig, CoworkSessionState } from "./types.js";

export type { CoworkSessionConfig, CoworkSessionState };
export { CoworkSession };

let activeSession: CoworkSession | null = null;

/**
 * Start a new cowork session. Only one session can be active at a time.
 */
export async function startCoworkSession(config: CoworkSessionConfig): Promise<void> {
  if (activeSession) {
    log.warn("cowork", "stopping existing session before starting new one");
    await stopCoworkSession();
  }

  activeSession = new CoworkSession(config);
  await activeSession.start();
}

/**
 * Stop the active cowork session.
 */
export async function stopCoworkSession(): Promise<void> {
  if (activeSession) {
    await activeSession.stop();
    activeSession = null;
  }
}

/**
 * Get the active cowork session, if any.
 */
export function getActiveSession(): CoworkSession | null {
  return activeSession;
}

/**
 * Get the state of the active session, if any.
 */
export function getActiveSessionState(): CoworkSessionState | null {
  return activeSession?.getState() ?? null;
}
