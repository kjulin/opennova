import fs from "fs";
import path from "path";

/**
 * Sync shared skills from workspace to agent(s).
 * Creates symlinks from agent's .claude/skills/ to shared skills directory.
 */
export function syncSharedSkills(workspaceDir: string, agentId?: string): void {
  const sharedSkillsDir = path.join(workspaceDir, "skills");
  const agentsDir = path.join(workspaceDir, "agents");

  // No shared skills directory or empty — nothing to sync
  if (!fs.existsSync(sharedSkillsDir)) return;
  const sharedSkills = fs.readdirSync(sharedSkillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (sharedSkills.length === 0) return;

  // Determine target agents
  const targetAgents = agentId
    ? [agentId]
    : fs.existsSync(agentsDir)
      ? fs.readdirSync(agentsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [];

  for (const agent of targetAgents) {
    const agentSkillsDir = path.join(agentsDir, agent, ".claude", "skills");
    fs.mkdirSync(agentSkillsDir, { recursive: true });

    // Sync each shared skill
    for (const skill of sharedSkills) {
      const linkPath = path.join(agentSkillsDir, skill);
      const targetPath = path.join(sharedSkillsDir, skill);

      if (fs.existsSync(linkPath)) {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          const existing = fs.readlinkSync(linkPath);
          if (existing === targetPath) continue; // Already correct
          fs.unlinkSync(linkPath); // Wrong target, recreate
        } else {
          continue; // Not a symlink (agent's own skill), don't touch
        }
      }
      fs.symlinkSync(targetPath, linkPath);
    }

    // Clean up stale symlinks (pointing to deleted shared skills)
    for (const entry of fs.readdirSync(agentSkillsDir, { withFileTypes: true })) {
      const entryPath = path.join(agentSkillsDir, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(entryPath);
        // Only clean symlinks pointing to our shared skills dir
        if (target.startsWith(sharedSkillsDir) && !fs.existsSync(target)) {
          fs.unlinkSync(entryPath);
        }
      }
    }
  }
}
