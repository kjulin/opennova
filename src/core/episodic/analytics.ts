import fs from "fs";
import path from "path";
import { Config } from "../config.js";

export interface SearchAnalytics {
  timestamp: string;
  agentId: string;
  threadId: string;
  query: string;
  resultCount: number;
  topScore: number;
}

function getAnalyticsPath(): string {
  return path.join(Config.workspaceDir, "episodic-search.jsonl");
}

/**
 * Log a search invocation to the workspace-level analytics file.
 */
export function logSearch(record: SearchAnalytics): void {
  const filePath = getAnalyticsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}
