import fs from "fs";
import path from "path";
import { Config, setLogger } from "#core/index.js";
import { resolveWorkspace } from "./workspace.js";
import { log } from "./logger.js";

export function init(): void {
  const workspaceDir = resolveWorkspace();
  Config.workspaceDir = workspaceDir;

  if (!fs.existsSync(workspaceDir)) {
    // Go up two levels: dist/daemon -> dist -> root
    const templateDir = path.resolve(import.meta.dirname, "..", "..", "workspace-template");
    fs.cpSync(templateDir, workspaceDir, { recursive: true });
  }

  log.init(workspaceDir);

  // Wire up core's logger to use daemon's file-based logger
  setLogger(log);
}
