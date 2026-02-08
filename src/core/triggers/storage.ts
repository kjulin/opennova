import fs from "fs";
import path from "path";
import { TriggerSchema, type Trigger } from "./schema.js";
import { safeParseJsonFile } from "../schemas.js";
import { log } from "../logger.js";

export function loadTriggers(agentDir: string): Trigger[] {
  const filePath = path.join(agentDir, "triggers.json");
  if (!fs.existsSync(filePath)) return [];

  const raw = safeParseJsonFile(filePath, `triggers.json (${path.basename(agentDir)})`);
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    log.warn("trigger", `triggers.json is not an array for agent ${path.basename(agentDir)}`);
    return [];
  }

  const triggers: Trigger[] = [];
  let needsSave = false;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    // Migration: enabled:false → skip (will be deleted on save)
    if ("enabled" in item && item.enabled === false) {
      needsSave = true;
      continue;
    }

    // Migration: strip enabled field
    if ("enabled" in item) {
      delete item.enabled;
      needsSave = true;
    }

    // Migration: ensure lastRun is set
    if (!item.lastRun) {
      item.lastRun = new Date().toISOString();
      needsSave = true;
    }

    // Backfill channel for old triggers
    if (!item.channel) {
      item.channel = "telegram";
      needsSave = true;
    }

    const result = TriggerSchema.safeParse(item);
    if (result.success) {
      triggers.push(result.data);
    } else {
      log.warn("trigger", `skipping invalid trigger in ${path.basename(agentDir)}: ${result.error.message}`);
    }
  }

  // Save if we migrated anything
  if (needsSave) {
    saveTriggers(agentDir, triggers);
  }

  return triggers;
}

export function saveTriggers(agentDir: string, triggers: Trigger[]): void {
  fs.writeFileSync(
    path.join(agentDir, "triggers.json"),
    JSON.stringify(triggers, null, 2) + "\n",
  );
}
