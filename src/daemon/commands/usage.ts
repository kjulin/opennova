import fs from "fs";
import { resolveWorkspace } from "../workspace.js";
import { Config, getUsageStats, getClaudeCodeStats } from "#core/index.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
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

function formatModelName(model: string): string {
  // Shorten model names for display
  if (model.includes("opus-4-5")) return "Opus 4.5";
  if (model.includes("opus-4-6")) return "Opus 4.6";
  if (model.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (model.includes("haiku-4-5")) return "Haiku 4.5";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
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
  const claudeStats = getClaudeCodeStats(period);

  const startDate = formatDate(stats.period.start);
  const endDate = formatDate(stats.period.end);
  const dateRange = period === "today" ? startDate : `${startDate} - ${endDate}`;

  console.log();
  console.log(`Usage for ${periodLabel(period)} (${dateRange}):`);
  console.log();

  // Claude Code stats (total usage)
  if (claudeStats) {
    // Claude Code messageCount includes both user and assistant messages
    // Estimate user messages as half of total for fair comparison
    const estimatedUserMessages = Math.round(claudeStats.totals.messages / 2);

    console.log("Claude Code (total):");
    const sessWord = claudeStats.totals.sessions === 1 ? "session" : "sessions";
    console.log(`  ~${estimatedUserMessages.toLocaleString()} user messages, ${claudeStats.totals.sessions.toLocaleString()} ${sessWord}`);
    console.log(`  ${claudeStats.totals.toolCalls.toLocaleString()} tool calls`);

    // Token usage
    const totalTokens = claudeStats.totals.inputTokens + claudeStats.totals.outputTokens;
    const cacheTokens = claudeStats.totals.cacheReadTokens + claudeStats.totals.cacheCreationTokens;
    if (totalTokens > 0 || cacheTokens > 0) {
      console.log(`  ${formatTokens(totalTokens)} tokens (${formatTokens(cacheTokens)} cached)`);
    }

    // By model breakdown
    const models = Object.entries(claudeStats.byModel)
      .filter(([, m]) => m.inputTokens + m.outputTokens > 0)
      .sort((a, b) => (b[1].inputTokens + b[1].outputTokens) - (a[1].inputTokens + a[1].outputTokens));

    if (models.length > 0) {
      console.log("  By model:");
      for (const [model, usage] of models) {
        const modelTokens = formatTokens(usage.inputTokens + usage.outputTokens);
        const modelName = formatModelName(model);
        console.log(`    ${modelName}: ${modelTokens} tokens`);
      }
    }

    // OpenNova breakdown (percentage of total user messages)
    if (stats.totals.userMessages > 0) {
      const novaPercent = estimatedUserMessages > 0
        ? ((stats.totals.userMessages / estimatedUserMessages) * 100).toFixed(1)
        : "0";
      console.log();
      console.log(`  Via OpenNova: ${stats.totals.userMessages.toLocaleString()} user messages (${novaPercent}%)`);
      console.log(`    ${formatDuration(stats.totals.durationMs)} agent work time`);

      // Sort by duration (agent work time)
      const agents = Object.entries(stats.byAgent).sort((a, b) => b[1].durationMs - a[1].durationMs);

      if (agents.length > 0) {
        const maxNameLen = Math.max(...agents.map(([id]) => id.length));
        const maxDurLen = Math.max(...agents.map(([, s]) => formatDuration(s.durationMs).length));

        console.log("    By agent:");
        for (const [agentId, agentStats] of agents) {
          const agentTokens = formatTokens(agentStats.inputTokens + agentStats.outputTokens);
          const agentDuration = formatDuration(agentStats.durationMs);
          const paddedId = agentId.padEnd(maxNameLen);
          const paddedDur = agentDuration.padStart(maxDurLen);
          console.log(`      ${paddedId} — ${paddedDur} (${agentTokens} tokens)`);
        }
      }
    }

    // All-time stats
    console.log();
    console.log("All-time:");
    const allEstimatedUserMessages = Math.round(claudeStats.allTime.totalMessages / 2);
    const allSessWord = claudeStats.allTime.totalSessions === 1 ? "session" : "sessions";
    console.log(`  ~${allEstimatedUserMessages.toLocaleString()} user messages, ${claudeStats.allTime.totalSessions.toLocaleString()} ${allSessWord}`);
    console.log(`  Since ${formatDate(claudeStats.allTime.firstSessionDate)}`);
    console.log();
  } else if (stats.totals.userMessages > 0) {
    // Only OpenNova stats available (no Claude Code stats file)
    console.log("OpenNova:");
    const totalMsgWord = stats.totals.userMessages === 1 ? "message" : "messages";
    console.log(`  ${stats.totals.userMessages.toLocaleString()} ${totalMsgWord}, ${formatDuration(stats.totals.durationMs)} agent work time`);

    const agents = Object.entries(stats.byAgent).sort((a, b) => b[1].durationMs - a[1].durationMs);
    if (agents.length > 0) {
      const maxNameLen = Math.max(...agents.map(([id]) => id.length));
      const maxDurLen = Math.max(...agents.map(([, s]) => formatDuration(s.durationMs).length));

      console.log("  By agent:");
      for (const [agentId, agentStats] of agents) {
        const agentTokens = formatTokens(agentStats.inputTokens + agentStats.outputTokens);
        const agentDuration = formatDuration(agentStats.durationMs);
        const paddedId = agentId.padEnd(maxNameLen);
        const paddedDur = agentDuration.padStart(maxDurLen);
        console.log(`    ${paddedId} — ${paddedDur} (${agentTokens} tokens)`);
      }
    }
    console.log();
  } else {
    console.log("No activity recorded.");
    console.log();
  }

  const otherPeriods = (["today", "week", "month"] as const).filter((p) => p !== period);
  console.log(`Tip: nova usage --${otherPeriods[0]} or --${otherPeriods[1]}`);
  console.log();
}
