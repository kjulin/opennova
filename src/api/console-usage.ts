import { Hono } from "hono";
import { Config, loadUsageRecords, type UsageRecord } from "#core/index.js";

type View = "weekly" | "monthly";

interface BucketStats {
  label: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  byAgent: Array<{
    agentId: string;
    messages: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    durationMs: number;
  }>;
}

function getWeekKey(d: Date): string {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayOfWeek = date.getDay();
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function getMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatWeekLabel(key: string): string {
  const d = new Date(key + "T12:00:00");
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(d)} – ${fmt(end)}`;
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(parseInt(y!, 10), parseInt(m!, 10) - 1, 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

interface BucketAccum {
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  agents: Map<string, {
    messages: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    durationMs: number;
  }>;
}

function emptyBucket(): BucketAccum {
  return { messages: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, durationMs: 0, agents: new Map() };
}

function generateSlots(view: View): { keys: string[]; since: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (view === "weekly") {
    // Last 10 calendar weeks (Mon–Sun), current week last
    const dayOfWeek = today.getDay();
    const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(thisMonday.getDate() - daysBack);

    const keys: string[] = [];
    for (let i = 9; i >= 0; i--) {
      const monday = new Date(thisMonday);
      monday.setDate(monday.getDate() - i * 7);
      keys.push(monday.toISOString().slice(0, 10));
    }
    return { keys, since: new Date(keys[0]! + "T00:00:00") };
  } else {
    // Last 6 calendar months, current month last
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      keys.push(getMonthKey(d));
    }
    return { keys, since: new Date(today.getFullYear(), today.getMonth() - 5, 1) };
  }
}

function aggregate(records: UsageRecord[], view: View) {
  const { keys, since } = generateSlots(view);

  // Pre-populate all slots
  const bucketMap = new Map<string, BucketAccum>();
  for (const key of keys) {
    bucketMap.set(key, emptyBucket());
  }

  // Fill with data
  for (const r of records) {
    if (new Date(r.timestamp) < since) continue;

    const key = view === "weekly"
      ? getWeekKey(new Date(r.timestamp))
      : getMonthKey(new Date(r.timestamp));

    const bucket = bucketMap.get(key);
    if (!bucket) continue; // outside our slot range

    bucket.messages++;
    bucket.inputTokens += r.inputTokens;
    bucket.outputTokens += r.outputTokens;
    bucket.cacheReadTokens += r.cacheReadTokens;
    bucket.costUsd += r.costUsd ?? 0;
    bucket.durationMs += r.durationMs;

    let agent = bucket.agents.get(r.agentId);
    if (!agent) {
      agent = { messages: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, durationMs: 0 };
      bucket.agents.set(r.agentId, agent);
    }
    agent.messages++;
    agent.inputTokens += r.inputTokens;
    agent.outputTokens += r.outputTokens;
    agent.cacheReadTokens += r.cacheReadTokens;
    agent.costUsd += r.costUsd ?? 0;
    agent.durationMs += r.durationMs;
  }

  // Convert in slot order (keys already sorted oldest→newest)
  const buckets: BucketStats[] = keys.map((key) => {
    const b = bucketMap.get(key)!;
    return {
      label: view === "weekly" ? formatWeekLabel(key) : formatMonthLabel(key),
      messages: b.messages,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      cacheReadTokens: b.cacheReadTokens,
      costUsd: b.costUsd,
      durationMs: b.durationMs,
      byAgent: Array.from(b.agents.entries())
        .map(([agentId, s]) => ({ agentId, ...s }))
        .sort((a, b) => b.messages - a.messages),
    };
  });

  return { buckets };
}

export function createConsoleUsageRouter(workspaceDir: string): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const viewParam = c.req.query("view") ?? "weekly";
    const view: View = viewParam === "monthly" ? "monthly" : "weekly";

    Config.workspaceDir = workspaceDir;

    const records = loadUsageRecords();
    const result = aggregate(records, view);

    return c.json(result);
  });

  return app;
}
