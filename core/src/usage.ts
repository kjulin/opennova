import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { Config } from "./config.js";

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
    durationMs: number;
  };
  byAgent: Record<
    string,
    {
      userMessages: number;
      agentMessages: number;
      inputTokens: number;
      outputTokens: number;
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

export function getUsageStats(period: "today" | "week" | "month"): UsageStats {
  const { start, end } = getPeriodBounds(period);
  const records = loadUsageRecords(start);

  const totals = {
    userMessages: 0,
    agentMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  const byAgent: UsageStats["byAgent"] = {};

  for (const record of records) {
    // Each record represents one exchange: 1 user message → 1 agent response
    totals.userMessages++;
    totals.agentMessages++;
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.durationMs += record.durationMs;

    let agentStats = byAgent[record.agentId];
    if (!agentStats) {
      agentStats = {
        userMessages: 0,
        agentMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      };
      byAgent[record.agentId] = agentStats;
    }

    agentStats.userMessages++;
    agentStats.agentMessages++;
    agentStats.inputTokens += record.inputTokens;
    agentStats.outputTokens += record.outputTokens;
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
