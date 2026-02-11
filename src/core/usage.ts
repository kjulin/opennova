import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { Config } from "./config.js";

// Claude Code stats types
export interface ClaudeCodeDailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface ClaudeCodeDailyTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

export interface ClaudeCodeModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
}

export interface ClaudeCodeStats {
  version: number;
  lastComputedDate: string;
  dailyActivity: ClaudeCodeDailyActivity[];
  dailyModelTokens: ClaudeCodeDailyTokens[];
  modelUsage: Record<string, ClaudeCodeModelUsage>;
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string;
  hourCounts: Record<string, number>;
}

export interface ClaudeCodePeriodStats {
  period: { start: string; end: string };
  totals: {
    messages: number;
    sessions: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }>;
  allTime: {
    totalSessions: number;
    totalMessages: number;
    firstSessionDate: string;
  };
}

export interface UsageRecord {
  timestamp: string;
  agentId: string;
  threadId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
  turns: number;
}

export interface UsageStats {
  period: { start: string; end: string };
  totals: {
    userMessages: number;
    agentMessages: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number;
  };
  byAgent: Record<
    string,
    {
      userMessages: number;
      agentMessages: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      durationMs: number;
    }
  >;
}

function getUsagePath(): string {
  return path.join(Config.workspaceDir, "usage.jsonl");
}

export function appendUsage(record: UsageRecord): void {
  const filePath = getUsagePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}

export function loadUsageRecords(since?: Date): UsageRecord[] {
  const filePath = getUsagePath();
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const records: UsageRecord[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as UsageRecord;
      if (since && new Date(record.timestamp) < since) continue;
      records.push(record);
    } catch {
      // Skip malformed lines
    }
  }

  return records;
}

function getPeriodBounds(period: "today" | "week" | "month"): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;

  switch (period) {
    case "today": {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "week": {
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "month": {
      start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      break;
    }
  }

  return { start, end };
}

export function getUsageStats(period: "today" | "week" | "month", customStart?: Date): UsageStats {
  const { start, end } = customStart
    ? { start: customStart, end: new Date() }
    : getPeriodBounds(period);
  const records = loadUsageRecords(start);

  const totals = {
    userMessages: 0,
    agentMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    durationMs: 0,
  };

  const byAgent: UsageStats["byAgent"] = {};

  for (const record of records) {
    // Each record represents one exchange: 1 user message → 1 agent response
    totals.userMessages++;
    totals.agentMessages++;
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
    totals.durationMs += record.durationMs;

    let agentStats = byAgent[record.agentId];
    if (!agentStats) {
      agentStats = {
        userMessages: 0,
        agentMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        durationMs: 0,
      };
      byAgent[record.agentId] = agentStats;
    }

    agentStats.userMessages++;
    agentStats.agentMessages++;
    agentStats.inputTokens += record.inputTokens;
    agentStats.outputTokens += record.outputTokens;
    agentStats.cacheReadTokens += record.cacheReadTokens;
    agentStats.durationMs += record.durationMs;
  }

  return {
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    totals,
    byAgent,
  };
}

// Claude Code stats functions
function getClaudeCodeStatsPath(): string {
  return path.join(os.homedir(), ".claude", "stats-cache.json");
}

export function loadClaudeCodeStats(): ClaudeCodeStats | null {
  const filePath = getClaudeCodeStatsPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as ClaudeCodeStats;
  } catch {
    return null;
  }
}

export function getClaudeCodeStats(period: "today" | "week" | "month"): ClaudeCodePeriodStats | null {
  const stats = loadClaudeCodeStats();
  if (!stats) return null;

  const { start, end } = getPeriodBounds(period);
  const startDate = start.toISOString().split("T")[0]!;
  const endDate = end.toISOString().split("T")[0]!;

  // Filter daily activity by period
  const filteredActivity = stats.dailyActivity.filter(
    (d) => d.date >= startDate && d.date <= endDate
  );

  // Filter daily tokens by period
  const filteredTokens = stats.dailyModelTokens.filter(
    (d) => d.date >= startDate && d.date <= endDate
  );

  // Calculate totals
  const totals = {
    messages: 0,
    sessions: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  for (const day of filteredActivity) {
    totals.messages += day.messageCount;
    totals.sessions += day.sessionCount;
    totals.toolCalls += day.toolCallCount;
  }

  // For tokens, we need to use the all-time model usage since daily tokens
  // only tracks output tokens. We'll estimate based on the proportion of
  // messages in the period vs total messages.
  const messageRatio = stats.totalMessages > 0
    ? totals.messages / stats.totalMessages
    : 0;

  for (const [, usage] of Object.entries(stats.modelUsage)) {
    totals.inputTokens += Math.round(usage.inputTokens * messageRatio);
    totals.outputTokens += Math.round(usage.outputTokens * messageRatio);
    totals.cacheReadTokens += Math.round(usage.cacheReadInputTokens * messageRatio);
    totals.cacheCreationTokens += Math.round(usage.cacheCreationInputTokens * messageRatio);
  }

  // Build by-model breakdown (all-time, scaled by period)
  const byModel: ClaudeCodePeriodStats["byModel"] = {};
  for (const [model, usage] of Object.entries(stats.modelUsage)) {
    byModel[model] = {
      inputTokens: Math.round(usage.inputTokens * messageRatio),
      outputTokens: Math.round(usage.outputTokens * messageRatio),
      cacheReadTokens: Math.round(usage.cacheReadInputTokens * messageRatio),
      cacheCreationTokens: Math.round(usage.cacheCreationInputTokens * messageRatio),
    };
  }

  return {
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    totals,
    byModel,
    allTime: {
      totalSessions: stats.totalSessions,
      totalMessages: stats.totalMessages,
      firstSessionDate: stats.firstSessionDate,
    },
  };
}

export function createUsageMcpServer(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "usage",
    tools: [
      tool(
        "get_usage_stats",
        "Get usage statistics for the Nova workspace. Returns total activity and per-agent breakdown for the specified time period.",
        {
          period: z
            .enum(["today", "week", "month"])
            .optional()
            .default("week")
            .describe("Time period to query"),
        },
        async (args) => {
          const stats = getUsageStats(args.period);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(stats, null, 2) },
            ],
          };
        },
      ),
    ],
  });
}
