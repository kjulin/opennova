import fs from "fs";
import { resolveWorkspace } from "../workspace.js";
import { Config, getUsageStats } from "#core/index.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(1)} hrs`;
  }
  if (minutes >= 1) {
    return `${minutes.toFixed(1)} min`;
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(0)} sec`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function periodLabel(period: "today" | "week" | "month"): string {
  switch (period) {
    case "today":
      return "today";
    case "week":
      return "the past week";
    case "month":
      return "the past month";
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
  console.log(`Usage for ${periodLabel(period)} (${dateRange}):`);
  console.log();

  const totalTokens = stats.totals.inputTokens + stats.totals.outputTokens;
  const totalMsgWord = stats.totals.userMessages === 1 ? "message" : "messages";
  console.log(`You sent ${stats.totals.userMessages.toLocaleString()} ${totalMsgWord}. Agents worked for ${formatDuration(stats.totals.durationMs)}.`);
  console.log();

  // Sort by duration (agent work time)
  const agents = Object.entries(stats.byAgent).sort((a, b) => b[1].durationMs - a[1].durationMs);

  if (agents.length === 0) {
    console.log("No activity recorded.");
  } else {
    const maxNameLen = Math.max(...agents.map(([id]) => id.length));
    const maxDurLen = Math.max(...agents.map(([, s]) => formatDuration(s.durationMs).length));

    console.log("By agent:");
    for (const [agentId, agentStats] of agents) {
      const agentTokens = formatTokens(agentStats.inputTokens + agentStats.outputTokens);
      const agentDuration = formatDuration(agentStats.durationMs);
      const paddedId = agentId.padEnd(maxNameLen);
      const paddedDur = agentDuration.padStart(maxDurLen);
      console.log(`  ${paddedId} — ${paddedDur} (${agentTokens} tokens)`);
    }
  }

  console.log();

  const otherPeriods = (["today", "week", "month"] as const).filter((p) => p !== period);
  console.log(`Tip: nova usage --${otherPeriods[0]} or --${otherPeriods[1]}`);
  console.log();
}
