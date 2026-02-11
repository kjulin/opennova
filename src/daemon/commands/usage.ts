import fs from "fs";
import { resolveWorkspace } from "../workspace.js";
import { Config, loadUsageRecords, type UsageRecord } from "#core/index.js";

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

function formatWeekDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMonthDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function getWeekStart(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  // Adjust to Monday start: Sunday (0) -> go back 6 days, otherwise go back (day - 1)
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setDate(date.getDate() - daysToSubtract);
  return date;
}

function getMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getCalendarPeriod(period: "today" | "week" | "month"): { start: Date; end: Date; label: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case "today": {
      return { start: today, end: today, label: "Today" };
    }
    case "week": {
      // Calendar week starting Monday
      const weekStart = getWeekStart(today);
      return { start: weekStart, end: today, label: "This Week" };
    }
    case "month": {
      const monthStart = getMonthStart(today);
      return { start: monthStart, end: today, label: "This Month" };
    }
  }
}

interface PeriodStats {
  msgs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
}

function aggregateRecords(records: UsageRecord[]): PeriodStats {
  const stats: PeriodStats = {
    msgs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    durationMs: 0,
  };
  for (const r of records) {
    stats.msgs++;
    stats.inputTokens += r.inputTokens;
    stats.outputTokens += r.outputTokens;
    stats.cacheReadTokens += r.cacheReadTokens;
    stats.durationMs += r.durationMs;
  }
  return stats;
}

function runCurrentPeriod(period: "today" | "week" | "month") {
  const { start, end, label } = getCalendarPeriod(period);
  const records = loadUsageRecords(start);

  const dateRange = period === "today"
    ? formatDate(start)
    : `${formatDate(start)} - ${formatDate(end)}`;

  console.log();
  console.log(`OpenNova Usage - ${label} (${dateRange})`);
  console.log();

  if (records.length === 0) {
    console.log("No activity recorded.");
    console.log();
    return;
  }

  // Group by agent
  const byAgent = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const list = byAgent.get(r.agentId) ?? [];
    list.push(r);
    byAgent.set(r.agentId, list);
  }

  // Sort agents by duration
  const agents = Array.from(byAgent.entries())
    .map(([id, recs]) => ({ id, stats: aggregateRecords(recs) }))
    .sort((a, b) => b.stats.durationMs - a.stats.durationMs);

  // Column widths
  const agentCol = Math.max(11, ...agents.map((a) => a.id.length));
  const cols = { msgs: 4, input: 6, output: 6, cache: 6, dur: 6 };

  const header = [
    "Agent".padEnd(agentCol),
    "Msgs".padStart(cols.msgs),
    "Input".padStart(cols.input),
    "Output".padStart(cols.output),
    "Cache".padStart(cols.cache),
    "Time".padStart(cols.dur),
  ].join("  ");
  const sep = "-".repeat(header.length);

  console.log(header);
  console.log(sep);

  for (const { id, stats } of agents) {
    console.log([
      id.padEnd(agentCol),
      stats.msgs.toString().padStart(cols.msgs),
      formatTokens(stats.inputTokens).padStart(cols.input),
      formatTokens(stats.outputTokens).padStart(cols.output),
      formatTokens(stats.cacheReadTokens).padStart(cols.cache),
      formatDuration(stats.durationMs).padStart(cols.dur),
    ].join("  "));
  }

  // Totals
  const totals = aggregateRecords(records);
  console.log(sep);
  console.log([
    "Total".padEnd(agentCol),
    totals.msgs.toString().padStart(cols.msgs),
    formatTokens(totals.inputTokens).padStart(cols.input),
    formatTokens(totals.outputTokens).padStart(cols.output),
    formatTokens(totals.cacheReadTokens).padStart(cols.cache),
    formatDuration(totals.durationMs).padStart(cols.dur),
  ].join("  "));

  console.log();
}

function runWeekly() {
  const records = loadUsageRecords();

  console.log();
  console.log("OpenNova Usage - Weekly");
  console.log();

  if (records.length === 0) {
    console.log("No activity recorded.");
    console.log();
    return;
  }

  // Group by week
  const byWeek = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const weekStart = getWeekStart(new Date(r.timestamp));
    const key = formatYYYYMMDD(weekStart);
    const list = byWeek.get(key) ?? [];
    list.push(r);
    byWeek.set(key, list);
  }

  // Sort weeks ascending
  const weeks = Array.from(byWeek.entries())
    .map(([key, recs]) => ({
      key,
      date: new Date(parseInt(key.slice(0, 4)), parseInt(key.slice(4, 6)) - 1, parseInt(key.slice(6, 8))),
      stats: aggregateRecords(recs),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Column widths
  const cols = { week: 12, msgs: 4, input: 6, output: 6, cache: 6, dur: 6 };

  const header = [
    "Week".padEnd(cols.week),
    "Msgs".padStart(cols.msgs),
    "Input".padStart(cols.input),
    "Output".padStart(cols.output),
    "Cache".padStart(cols.cache),
    "Time".padStart(cols.dur),
  ].join("  ");
  const sep = "-".repeat(header.length);

  console.log(header);
  console.log(sep);

  let totalStats: PeriodStats = { msgs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 0 };

  for (const { date, stats } of weeks) {
    console.log([
      formatWeekDate(date).padEnd(cols.week),
      stats.msgs.toString().padStart(cols.msgs),
      formatTokens(stats.inputTokens).padStart(cols.input),
      formatTokens(stats.outputTokens).padStart(cols.output),
      formatTokens(stats.cacheReadTokens).padStart(cols.cache),
      formatDuration(stats.durationMs).padStart(cols.dur),
    ].join("  "));

    totalStats.msgs += stats.msgs;
    totalStats.inputTokens += stats.inputTokens;
    totalStats.outputTokens += stats.outputTokens;
    totalStats.cacheReadTokens += stats.cacheReadTokens;
    totalStats.durationMs += stats.durationMs;
  }

  console.log(sep);
  console.log([
    "Total".padEnd(cols.week),
    totalStats.msgs.toString().padStart(cols.msgs),
    formatTokens(totalStats.inputTokens).padStart(cols.input),
    formatTokens(totalStats.outputTokens).padStart(cols.output),
    formatTokens(totalStats.cacheReadTokens).padStart(cols.cache),
    formatDuration(totalStats.durationMs).padStart(cols.dur),
  ].join("  "));

  console.log();
}

function runMonthly() {
  const records = loadUsageRecords();

  console.log();
  console.log("OpenNova Usage - Monthly");
  console.log();

  if (records.length === 0) {
    console.log("No activity recorded.");
    console.log();
    return;
  }

  // Group by month
  const byMonth = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }

  // Sort months ascending
  const months = Array.from(byMonth.entries())
    .map(([key, recs]) => ({
      key,
      date: new Date(parseInt(key.slice(0, 4)), parseInt(key.slice(5, 7)) - 1, 1),
      stats: aggregateRecords(recs),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Column widths
  const cols = { month: 10, msgs: 4, input: 6, output: 6, cache: 6, dur: 6 };

  const header = [
    "Month".padEnd(cols.month),
    "Msgs".padStart(cols.msgs),
    "Input".padStart(cols.input),
    "Output".padStart(cols.output),
    "Cache".padStart(cols.cache),
    "Time".padStart(cols.dur),
  ].join("  ");
  const sep = "-".repeat(header.length);

  console.log(header);
  console.log(sep);

  let totalStats: PeriodStats = { msgs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 0 };

  for (const { date, stats } of months) {
    console.log([
      formatMonthDate(date).padEnd(cols.month),
      stats.msgs.toString().padStart(cols.msgs),
      formatTokens(stats.inputTokens).padStart(cols.input),
      formatTokens(stats.outputTokens).padStart(cols.output),
      formatTokens(stats.cacheReadTokens).padStart(cols.cache),
      formatDuration(stats.durationMs).padStart(cols.dur),
    ].join("  "));

    totalStats.msgs += stats.msgs;
    totalStats.inputTokens += stats.inputTokens;
    totalStats.outputTokens += stats.outputTokens;
    totalStats.cacheReadTokens += stats.cacheReadTokens;
    totalStats.durationMs += stats.durationMs;
  }

  console.log(sep);
  console.log([
    "Total".padEnd(cols.month),
    totalStats.msgs.toString().padStart(cols.msgs),
    formatTokens(totalStats.inputTokens).padStart(cols.input),
    formatTokens(totalStats.outputTokens).padStart(cols.output),
    formatTokens(totalStats.cacheReadTokens).padStart(cols.cache),
    formatDuration(totalStats.durationMs).padStart(cols.dur),
  ].join("  "));

  console.log();
}

export function run() {
  const args = process.argv.slice(3);
  const subcommand = args[0];

  const workspaceDir = resolveWorkspace();
  if (!fs.existsSync(workspaceDir)) {
    console.log("\nWorkspace not found. Run 'nova init' first.\n");
    process.exit(1);
  }
  Config.workspaceDir = workspaceDir;

  if (subcommand === "weekly") {
    runWeekly();
    return;
  }

  if (subcommand === "monthly") {
    runMonthly();
    return;
  }

  // Default: current period view
  let period: "today" | "week" | "month" = "week";
  if (args.includes("--today")) period = "today";
  else if (args.includes("--week")) period = "week";
  else if (args.includes("--month")) period = "month";

  runCurrentPeriod(period);

  const otherPeriods = (["today", "week", "month"] as const).filter((p) => p !== period);
  console.log(`Tip: nova usage --${otherPeriods[0]} | --${otherPeriods[1]} | weekly | monthly`);
  console.log();
}
