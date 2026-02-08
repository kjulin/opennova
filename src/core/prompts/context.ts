export function buildContextBlock(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const local = now.toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
  return `\n<Context>\nCurrent time: ${local} (${tz})\n</Context>`;
}
