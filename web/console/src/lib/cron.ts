const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const DAY_NAME_SINGULAR = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const m = minute.toString().padStart(2, "0");
  return `${h}:${m} ${period}`;
}

function parseDayRange(dow: string): string | null {
  // e.g. "1-5" → "Weekdays"
  if (dow === "1-5") return "Weekdays";
  if (dow === "0-6" || dow === "*") return null; // every day
  // Single day: "0" → "Sundays"
  const num = parseInt(dow, 10);
  if (!isNaN(num) && num >= 0 && num <= 6) return DAY_NAMES[num];
  return null;
}

export function cronToHuman(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [min, hour, dom, mon, dow] = parts;

  // Every minute: * * * * *
  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every minute";
  }

  // Every hour: 0 * * * *
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every hour";
  }

  // Specific minute + every hour
  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every hour at minute ${min}`;
  }

  // Specific minute + specific hour
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    const time = formatTime(h, m);

    // First of month: 0 0 1 * *
    if (dom === "1" && mon === "*" && dow === "*") {
      return `First day of every month at ${time}`;
    }

    // Specific day of month
    if (/^\d+$/.test(dom) && mon === "*" && dow === "*") {
      return `Day ${dom} of every month at ${time}`;
    }

    // All days, all months: specific time daily
    if (dom === "*" && mon === "*" && dow === "*") {
      return `Every day at ${time}`;
    }

    // Day-of-week patterns
    if (dom === "*" && mon === "*" && dow !== "*") {
      const dayLabel = parseDayRange(dow);
      if (dayLabel) {
        return `${dayLabel} at ${time}`;
      }
      // Comma-separated days
      const dayNums = dow.split(",").map((d) => parseInt(d, 10));
      if (dayNums.every((d) => !isNaN(d) && d >= 0 && d <= 6)) {
        const names = dayNums.map((d) => DAY_NAME_SINGULAR[d]);
        return `${names.join(", ")} at ${time}`;
      }
    }
  }

  return null;
}

export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    { min: 0, max: 59 },  // minute
    { min: 0, max: 23 },  // hour
    { min: 1, max: 31 },  // day of month
    { min: 1, max: 12 },  // month
    { min: 0, max: 7 },   // day of week (0 and 7 = Sunday)
  ];

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    if (field === "*") continue;

    // Validate each comma-separated value or range
    const segments = field.split(",");
    for (const seg of segments) {
      // Step values like */5 or 1-5/2
      const stepMatch = seg.match(/^(.+)\/(\d+)$/);
      const base = stepMatch ? stepMatch[1] : seg;
      if (stepMatch) {
        const step = parseInt(stepMatch[2], 10);
        if (isNaN(step) || step < 1) return false;
      }

      if (base === "*") continue;

      // Range like 1-5
      const rangeMatch = base.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start < ranges[i].min || end > ranges[i].max || start > end) return false;
        continue;
      }

      // Single number
      const num = parseInt(base, 10);
      if (isNaN(num) || num < ranges[i].min || num > ranges[i].max) return false;
    }
  }

  return true;
}
