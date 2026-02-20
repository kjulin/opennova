import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import type { CouncilManifest, CouncilMessage, CouncilConfig } from "./types.js";

const COUNCILS_DIR = path.join(
  process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
  ".nova",
  "councils",
);

function councilsDir(): string {
  return COUNCILS_DIR;
}

function councilFile(councilId: string): string {
  return path.join(councilsDir(), `${councilId}.jsonl`);
}

function memoFile(councilId: string): string {
  return path.join(councilsDir(), `${councilId}.memo.md`);
}

function configFile(): string {
  return path.join(councilsDir(), "config.json");
}

function ensureDir(): void {
  const dir = councilsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// --- Council Lifecycle ---

export function createCouncil(options: {
  topic: string;
  coordinator: string;
  participants: string[];
}): CouncilManifest {
  ensureDir();

  const id = randomBytes(6).toString("hex");
  const now = new Date().toISOString();

  // Ensure coordinator is in participants
  const participants = options.participants.includes(options.coordinator)
    ? options.participants
    : [options.coordinator, ...options.participants];

  const manifest: CouncilManifest = {
    id,
    topic: options.topic,
    coordinator: options.coordinator,
    participants,
    status: "active",
    createdAt: now,
    updatedAt: now,
    participantState: {},
  };

  // Write manifest as first line of JSONL file
  fs.writeFileSync(councilFile(id), JSON.stringify(manifest) + "\n");

  return manifest;
}

export function loadCouncil(councilId: string): CouncilManifest | null {
  const file = councilFile(councilId);
  if (!fs.existsSync(file)) return null;

  try {
    const firstLine = fs.readFileSync(file, "utf-8").split("\n")[0]!;
    return JSON.parse(firstLine) as CouncilManifest;
  } catch {
    return null;
  }
}

export function saveCouncil(manifest: CouncilManifest): void {
  ensureDir();
  const file = councilFile(manifest.id);

  if (!fs.existsSync(file)) {
    // New file — just write the manifest
    fs.writeFileSync(file, JSON.stringify(manifest) + "\n");
    return;
  }

  // Replace first line (manifest), keep transcript lines
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");
  lines[0] = JSON.stringify(manifest);
  fs.writeFileSync(file, lines.join("\n"));
}

export function listCouncils(status?: "active" | "closed"): CouncilManifest[] {
  const dir = councilsDir();
  if (!fs.existsSync(dir)) return [];

  const councils: CouncilManifest[] = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".jsonl")) continue;
    try {
      const firstLine = fs.readFileSync(path.join(dir, file), "utf-8").split("\n")[0]!;
      const manifest = JSON.parse(firstLine) as CouncilManifest;
      if (status === undefined || manifest.status === status) {
        councils.push(manifest);
      }
    } catch {
      // skip corrupt files
    }
  }

  return councils;
}

// --- Transcript ---

export function appendMessage(councilId: string, message: CouncilMessage): void {
  const file = councilFile(councilId);
  fs.appendFileSync(file, JSON.stringify(message) + "\n");
}

export function loadMessages(councilId: string, since?: number): CouncilMessage[] {
  const file = councilFile(councilId);
  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n").slice(1); // skip manifest line
  const messages: CouncilMessage[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as CouncilMessage;
      if (parsed.type !== "message") continue;
      if (since !== undefined && parsed.index <= since) continue;
      messages.push(parsed);
    } catch {
      // skip corrupt lines
    }
  }

  return messages;
}

export function getMessageCount(councilId: string): number {
  const file = councilFile(councilId);
  if (!fs.existsSync(file)) return 0;

  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n").slice(1); // skip manifest line
  let count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "message") count++;
    } catch {
      // skip corrupt lines
    }
  }

  return count;
}

// --- Memo ---

export function readMemo(councilId: string): string {
  const file = memoFile(councilId);
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf-8");
}

export function writeMemo(councilId: string, content: string): void {
  ensureDir();
  fs.writeFileSync(memoFile(councilId), content);
}

// --- Participant State ---

export function initParticipant(
  councilId: string,
  agentId: string,
  threadId: string,
): void {
  const manifest = loadCouncil(councilId);
  if (!manifest) return;

  manifest.participantState[agentId] = {
    threadId,
    lastSeenIndex: -1,
  };
  manifest.updatedAt = new Date().toISOString();
  saveCouncil(manifest);
}

export function updateLastSeen(
  councilId: string,
  agentId: string,
  index: number,
): void {
  const manifest = loadCouncil(councilId);
  if (!manifest) return;

  const state = manifest.participantState[agentId];
  if (!state) return;

  state.lastSeenIndex = index;
  manifest.updatedAt = new Date().toISOString();
  saveCouncil(manifest);
}

// --- Config ---

export function loadCouncilConfig(): CouncilConfig | null {
  const file = configFile();
  if (!fs.existsSync(file)) return null;

  try {
    const content = fs.readFileSync(file, "utf-8");
    return JSON.parse(content) as CouncilConfig;
  } catch {
    return null;
  }
}

// --- Mention Detection ---

/**
 * Extract the first valid @mention from text.
 * Checks participants in order; skips selfId if provided.
 * Returns the matched agent ID or null.
 */
export function extractMention(
  text: string,
  participants: string[],
  selfId?: string,
): string | null {
  for (const id of participants) {
    if (id === selfId) continue;
    if (text.includes(`@${id}`)) return id;
  }
  return null;
}
