import fs from "fs";
import path from "path";

/**
 * Activate a skill for an agent.
 * Creates symlink {agentDir}/.claude/skills/{name} → {workspace}/skills/{name}.
 * Idempotent — skips if correct symlink already exists. Skips non-symlink entries.
 */
export function activateSkill(workspaceDir: string, skillName: string, agentId: string): void {
  const skillDir = path.join(workspaceDir, "skills", skillName);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill not found in library: ${skillName}`);
  }

  const agentSkillsDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills");
  fs.mkdirSync(agentSkillsDir, { recursive: true });

  const linkPath = path.join(agentSkillsDir, skillName);
  if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const existing = fs.readlinkSync(linkPath);
      if (existing === skillDir) return; // Already correct
      fs.unlinkSync(linkPath); // Wrong target, recreate
    } else {
      return; // Not a symlink (agent's own skill), don't touch
    }
  }
  fs.symlinkSync(skillDir, linkPath);
}

/**
 * Deactivate a skill for an agent.
 * Removes the symlink. Idempotent — no-op if not active.
 */
export function deactivateSkill(workspaceDir: string, skillName: string, agentId: string): void {
  const linkPath = path.join(workspaceDir, "agents", agentId, ".claude", "skills", skillName);
  if (!fs.existsSync(linkPath) && !isSymlink(linkPath)) return;

  const stat = fs.lstatSync(linkPath);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(linkPath);
  }
  // Not a symlink — don't touch
}

/**
 * Delete a skill from the library.
 * Removes the skill directory and all symlinks pointing to it across all agents.
 */
export function deleteSkillFromLibrary(workspaceDir: string, skillName: string): void {
  const skillDir = path.join(workspaceDir, "skills", skillName);
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true });
  }

  // Clean up stale symlinks across all agents
  const agentsDir = path.join(workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return;

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const linkPath = path.join(agentsDir, entry.name, ".claude", "skills", skillName);
    if (!isSymlink(linkPath)) continue;
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    }
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
