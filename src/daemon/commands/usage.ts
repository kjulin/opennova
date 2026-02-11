import fs from "fs";
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function periodLabel(period: "today" | "week" | "month"): string {
  switch (period) {
    case "today":
      return "Today";
    case "week":
      return "Past Week";
    case "month":
      return "Past Month";
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

  const stats = getUsageStats(period);

  const startDate = formatDate(stats.period.start);
  const endDate = formatDate(stats.period.end);
  const dateRange = period === "today" ? startDate : `${startDate} - ${endDate}`;

  console.log();
  console.log(`OpenNova Usage - ${periodLabel(period)} (${dateRange})`);
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
  const agentCol = Math.max(5, ...agents.map(([id]) => id.length));
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

  // Total row
  console.log(separator);
  const totalRow = [
    "Total".padEnd(agentCol),
    stats.totals.userMessages.toString().padStart(msgsCol),
    formatTokens(stats.totals.inputTokens).padStart(inputCol),
    formatTokens(stats.totals.outputTokens).padStart(outputCol),
    formatTokens(stats.totals.cacheReadTokens).padStart(cacheCol),
    formatDuration(stats.totals.durationMs).padStart(durCol),
  ].join("  ");
  console.log(totalRow);

  console.log();
  const otherPeriods = (["today", "week", "month"] as const).filter((p) => p !== period);
  console.log(`Tip: nova usage --${otherPeriods[0]} | --${otherPeriods[1]}`);
  console.log("     ccusage for total Claude Code usage");
  console.log();
}
