import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { Config } from "../config.js";
import { TriggerSchema, safeParseJsonFile, type Trigger } from "../schemas.js";
import { log } from "../logger.js";

export interface TriggerInput {
  cron: string;
  tz?: string;
  prompt: string;
  lastRun?: string;
}

export interface TriggerStore {
  list(agentId?: string): Trigger[];
  get(triggerId: string): Trigger | null;
  create(agentId: string, input: TriggerInput): Trigger;
  update(triggerId: string, partial: Partial<TriggerInput>): Trigger;
  delete(triggerId: string): void;
  deleteAllForAgent(agentId: string): void;
}

export class FilesystemTriggerStore implements TriggerStore {
  private migrated = false;

  private triggersPath(): string {
    return path.join(Config.workspaceDir, "triggers.json");
  }

  private migrate(): void {
    if (this.migrated) return;
    this.migrated = true;

    const newPath = this.triggersPath();
    if (fs.existsSync(newPath)) return;

    const agentsDir = path.join(Config.workspaceDir, "agents");
    if (!fs.existsSync(agentsDir)) return;

    const merged: Trigger[] = [];
    const oldFiles: string[] = [];

    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const oldPath = path.join(agentsDir, entry.name, "triggers.json");
      if (!fs.existsSync(oldPath)) continue;

      const raw = safeParseJsonFile(oldPath, `triggers.json (${entry.name})`);
      if (raw === null || !Array.isArray(raw)) continue;

      for (const item of raw) {
        const result = TriggerSchema.safeParse({ ...item, agentId: entry.name });
        if (result.success) {
          merged.push(result.data);
        } else {
          log.warn("trigger", `migration: skipping invalid trigger in ${entry.name}: ${result.error.message}`);
        }
      }
      oldFiles.push(oldPath);
    }

    if (merged.length > 0 || oldFiles.length > 0) {
      fs.writeFileSync(newPath, JSON.stringify(merged, null, 2));
      log.info("trigger", `migrated ${merged.length} trigger(s) to workspace-level triggers.json`);

      for (const oldPath of oldFiles) {
        fs.unlinkSync(oldPath);
        log.info("trigger", `removed old ${oldPath}`);
      }
    }
  }

  private loadAll(): Trigger[] {
    this.migrate();
    const filePath = this.triggersPath();
    if (!fs.existsSync(filePath)) return [];
    const raw = safeParseJsonFile(filePath, "triggers.json");
    if (raw === null) return [];
    if (!Array.isArray(raw)) {
      log.warn("trigger", "triggers.json is not an array");
      return [];
    }
    const triggers: Trigger[] = [];
    for (const item of raw) {
      const result = TriggerSchema.safeParse(item);
      if (result.success) {
        triggers.push(result.data);
      } else {
        log.warn("trigger", `skipping invalid trigger: ${result.error.message}`);
      }
    }
    return triggers;
  }

  private saveAll(triggers: Trigger[]): void {
    fs.writeFileSync(
      this.triggersPath(),
      JSON.stringify(triggers, null, 2),
    );
  }

  list(agentId?: string): Trigger[] {
    const all = this.loadAll();
    if (agentId) return all.filter((t) => t.agentId === agentId);
    return all;
  }

  get(triggerId: string): Trigger | null {
    return this.loadAll().find((t) => t.id === triggerId) ?? null;
  }

  create(agentId: string, input: TriggerInput): Trigger {
    try {
      CronExpressionParser.parse(input.cron);
    } catch {
      throw new Error(`Invalid cron expression: ${input.cron}`);
    }
    if (!input.prompt || input.prompt.trim() === "") {
      throw new Error("Prompt is required");
    }

    const trigger: Trigger = {
      id: randomBytes(6).toString("hex"),
      agentId,
      cron: input.cron,
      prompt: input.prompt,
      lastRun: input.lastRun ?? new Date().toISOString(),
      ...(input.tz !== undefined && { tz: input.tz }),
    };

    const triggers = this.loadAll();
    triggers.push(trigger);
    this.saveAll(triggers);
    return trigger;
  }

  update(triggerId: string, partial: Partial<TriggerInput>): Trigger {
    if (partial.cron !== undefined) {
      try {
        CronExpressionParser.parse(partial.cron);
      } catch {
        throw new Error(`Invalid cron expression: ${partial.cron}`);
      }
    }

    const triggers = this.loadAll();
    const trigger = triggers.find((t) => t.id === triggerId);
    if (!trigger) throw new Error(`Trigger not found: ${triggerId}`);

    if (partial.cron !== undefined) trigger.cron = partial.cron;
    if (partial.tz !== undefined) trigger.tz = partial.tz;
    if (partial.prompt !== undefined) trigger.prompt = partial.prompt;
    if (partial.lastRun !== undefined) trigger.lastRun = partial.lastRun;

    this.saveAll(triggers);
    return trigger;
  }

  delete(triggerId: string): void {
    const triggers = this.loadAll();
    const filtered = triggers.filter((t) => t.id !== triggerId);
    if (filtered.length !== triggers.length) {
      this.saveAll(filtered);
    }
  }

  deleteAllForAgent(agentId: string): void {
    const triggers = this.loadAll();
    const filtered = triggers.filter((t) => t.agentId !== agentId);
    if (filtered.length !== triggers.length) {
      this.saveAll(filtered);
    }
  }
}
