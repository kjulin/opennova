import fs from "fs";
import path from "path";

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

let minLevel: number = LEVELS.info;
let logStream: fs.WriteStream | null = null;
let logFilePath = "";

function formatLine(level: Level, tag: string, message: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const lvl = level.toUpperCase().padEnd(5);
  const extra = args.length > 0
    ? " " + args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(" ")
    : "";
  return `${ts} ${lvl} [${tag}] ${message}${extra}`;
}

function write(level: Level, tag: string, message: string, args: unknown[]): void {
  if (LEVELS[level] < minLevel) return;
  const line = formatLine(level, tag, message, args);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (logStream) {
    logStream.write(line + "\n");
    rotateIfNeeded();
  }
}

function rotateIfNeeded(): void {
  try {
    const stats = fs.statSync(logFilePath);
    if (stats.size > MAX_FILE_SIZE) {
      logStream!.end();
      const rotated = logFilePath + ".1";
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      fs.renameSync(logFilePath, rotated);
      logStream = fs.createWriteStream(logFilePath, { flags: "a" });
    }
  } catch {
    // Ignore stat errors during rotation
  }
}

export const log = {
  init(workspaceDir: string) {
    const dir = path.join(workspaceDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, "daemon.log");
    logStream = fs.createWriteStream(logFilePath, { flags: "a" });

    const envLevel = process.env.NOVA_LOG_LEVEL?.toLowerCase();
    if (envLevel && envLevel in LEVELS) {
      minLevel = LEVELS[envLevel as Level];
    }
  },

  close() {
    if (logStream) {
      logStream.end();
      logStream = null;
    }
  },

  debug(tag: string, msg: string, ...args: unknown[]) { write("debug", tag, msg, args); },
  info(tag: string, msg: string, ...args: unknown[]) { write("info", tag, msg, args); },
  warn(tag: string, msg: string, ...args: unknown[]) { write("warn", tag, msg, args); },
  error(tag: string, msg: string, ...args: unknown[]) { write("error", tag, msg, args); },
};
