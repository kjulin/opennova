import fs from "fs";
import path from "path";
import { Config } from "./config.js";
import { resolveWorkspace } from "./workspace.js";

export function init(): void {
  const workspaceDir = resolveWorkspace();
  Config.workspaceDir = workspaceDir;

  if (!fs.existsSync(workspaceDir)) {
    const templateDir = path.resolve(import.meta.dirname, "..", "workspace-template");
    fs.cpSync(templateDir, workspaceDir, { recursive: true });
  }
}
