import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { Config } from "../config.js";
import { TriggerSchema, safeParseJsonFile, type Trigger } from "../schemas.js";
import { agentStore } from "../agents/singleton.js";
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
  private triggersPath(agentId: string): string {
    return path.join(Config.workspaceDir, "agents", agentId, "triggers.json");
  }

  private loadFile(agentId: string): Trigger[] {
    const filePath = this.triggersPath(agentId);
    if (!fs.existsSync(filePath)) return [];
    const raw = safeParseJsonFile(filePath, `triggers.json (${agentId})`);
    if (raw === null) return [];
    if (!Array.isArray(raw)) {
      log.warn("trigger", `triggers.json is not an array for agent ${agentId}`);
      return [];
    }
    const triggers: Trigger[] = [];
    for (const item of raw) {
      const result = TriggerSchema.safeParse(item);
      if (result.success) {
        triggers.push({ ...result.data, agentId });
      } else {
        log.warn("trigger", `skipping invalid trigger in ${agentId}: ${result.error.message}`);
      }
    }
    return triggers;
  }

  private saveFile(agentId: string, triggers: Trigger[]): void {
    // Strip agentId before persisting (it's added at read time)
    const toWrite = triggers.map(({ agentId: _aid, ...rest }) => rest);
    fs.writeFileSync(
      this.triggersPath(agentId),
      JSON.stringify(toWrite, null, 2),
    );
  }

  list(agentId?: string): Trigger[] {
    if (agentId) {
      return this.loadFile(agentId);
    }
    const all: Trigger[] = [];
    for (const [id] of agentStore.list()) {
      all.push(...this.loadFile(id));
    }
    return all;
  }

  get(triggerId: string): Trigger | null {
    for (const [agentId] of agentStore.list()) {
      const triggers = this.loadFile(agentId);
      const found = triggers.find((t) => t.id === triggerId);
      if (found) return found;
    }
    return null;
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

    const triggers = this.loadFile(agentId);
    triggers.push(trigger);
    this.saveFile(agentId, triggers);
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

    for (const [agentId] of agentStore.list()) {
      const triggers = this.loadFile(agentId);
      const trigger = triggers.find((t) => t.id === triggerId);
      if (!trigger) continue;

      if (partial.cron !== undefined) trigger.cron = partial.cron;
      if (partial.tz !== undefined) trigger.tz = partial.tz;
      if (partial.prompt !== undefined) trigger.prompt = partial.prompt;
      if (partial.lastRun !== undefined) trigger.lastRun = partial.lastRun;

      this.saveFile(agentId, triggers);
      return trigger;
    }

    throw new Error(`Trigger not found: ${triggerId}`);
  }

  delete(triggerId: string): void {
    for (const [agentId] of agentStore.list()) {
      const triggers = this.loadFile(agentId);
      const idx = triggers.findIndex((t) => t.id === triggerId);
      if (idx === -1) continue;
      triggers.splice(idx, 1);
      this.saveFile(agentId, triggers);
      return;
    }
  }

  deleteAllForAgent(agentId: string): void {
    const filePath = this.triggersPath(agentId);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]");
    }
  }
}
