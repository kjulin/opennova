import fs from "fs";
import { execSync } from "child_process";
import { resolveWorkspace } from "../workspace.js";
import { Config, getUsageStats } from "#core/index.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(1)}h`;
  }
  if (minutes >= 1) {
    return `${minutes.toFixed(1)}m`;
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(0)}s`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatYYYYMMDD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getCalendarPeriod(period: "today" | "week" | "month"): { start: Date; end: Date; label: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case "today": {
      return {
        start: today,
        end: today,
        label: "Today",
      };
    }
    case "week": {
      // Calendar week starting Sunday (to match ccusage)
      const dayOfWeek = today.getDay(); // 0 = Sunday
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dayOfWeek);
      return {
        start: weekStart,
        end: today,
        label: "This Week",
      };
    }
    case "month": {
      // Calendar month
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        start: monthStart,
        end: today,
        label: "This Month",
      };
    }
  }
}

interface CcusageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

function getCcusageTotals(start: Date, end: Date): CcusageTotals | null {
  try {
    const since = formatYYYYMMDD(start);
    const until = formatYYYYMMDD(end);
    const result = execSync(`ccusage daily --json --offline --since ${since} --until ${until} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });

    const data = JSON.parse(result) as {
      daily: Array<{
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
      }>;
    };

    const totals: CcusageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
    };

    for (const day of data.daily) {
      totals.inputTokens += day.inputTokens;
      totals.outputTokens += day.outputTokens;
      totals.cacheReadTokens += day.cacheReadTokens;
    }

    return totals;
  } catch {
    return null;
  }
}

export function run() {
  const args = process.argv.slice(3);

  let period: "today" | "week" | "month" = "week";
  if (args.includes("--today")) period = "today";
  else if (args.includes("--week")) period = "week";
  else if (args.includes("--month")) period = "month";

  const workspaceDir = resolveWorkspace();
  if (!fs.existsSync(workspaceDir)) {
    console.log("\nWorkspace not found. Run 'nova init' first.\n");
    process.exit(1);
  }
  Config.workspaceDir = workspaceDir;

  const { start, end, label } = getCalendarPeriod(period);
  const stats = getUsageStats(period, start);

  const dateRange = period === "today"
    ? formatDate(start)
    : `${formatDate(start)} - ${formatDate(end)}`;

  console.log();
  console.log(`OpenNova Usage - ${label} (${dateRange})`);
  console.log();

  if (stats.totals.userMessages === 0) {
    console.log("No activity recorded.");
    console.log();
    console.log("Tip: Use 'ccusage' for total Claude Code usage");
    console.log();
    return;
  }

  // Sort agents by duration (most active first)
  const agents = Object.entries(stats.byAgent).sort((a, b) => b[1].durationMs - a[1].durationMs);

  // Calculate column widths
  const agentCol = Math.max(10, ...agents.map(([id]) => id.length));
  const msgsCol = 4;
  const inputCol = 6;
  const outputCol = 6;
  const cacheCol = 6;
  const durCol = 6;

  // Header
  const header = [
    "Agent".padEnd(agentCol),
    "Msgs".padStart(msgsCol),
    "Input".padStart(inputCol),
    "Output".padStart(outputCol),
    "Cache".padStart(cacheCol),
    "Time".padStart(durCol),
  ].join("  ");

  const separator = "-".repeat(header.length);

  console.log(header);
  console.log(separator);

  // Agent rows
  for (const [agentId, agentStats] of agents) {
    const row = [
      agentId.padEnd(agentCol),
      agentStats.userMessages.toString().padStart(msgsCol),
      formatTokens(agentStats.inputTokens).padStart(inputCol),
      formatTokens(agentStats.outputTokens).padStart(outputCol),
      formatTokens(agentStats.cacheReadTokens).padStart(cacheCol),
      formatDuration(agentStats.durationMs).padStart(durCol),
    ].join("  ");
    console.log(row);
  }

  // Nova total row
  console.log(separator);
  const totalRow = [
    "Nova Total".padEnd(agentCol),
    stats.totals.userMessages.toString().padStart(msgsCol),
    formatTokens(stats.totals.inputTokens).padStart(inputCol),
    formatTokens(stats.totals.outputTokens).padStart(outputCol),
    formatTokens(stats.totals.cacheReadTokens).padStart(cacheCol),
    formatDuration(stats.totals.durationMs).padStart(durCol),
  ].join("  ");
  console.log(totalRow);

  // Claude Code total from ccusage
  const ccTotals = getCcusageTotals(start, end);
  if (ccTotals) {
    const ccRow = [
      "Claude Code".padEnd(agentCol),
      "".padStart(msgsCol),
      formatTokens(ccTotals.inputTokens).padStart(inputCol),
      formatTokens(ccTotals.outputTokens).padStart(outputCol),
      formatTokens(ccTotals.cacheReadTokens).padStart(cacheCol),
      "".padStart(durCol),
    ].join("  ");
    console.log(ccRow);
  }

  console.log();
  const otherPeriods = (["today", "week", "month"] as const).filter((p) => p !== period);
  console.log(`Tip: nova usage --${otherPeriods[0]} | --${otherPeriods[1]}`);
  console.log();
}
