import fs from "fs";
import path from "path";
import { agentStore } from "./agents/singleton.js";

/**
 * Activate a skill for an agent.
 * Writes to agent.json and creates symlink for SDK discovery.
 * Idempotent.
 */
export function activateSkill(workspaceDir: string, skillName: string, agentId: string): void {
  const skillDir = path.join(workspaceDir, "skills", skillName);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill not found in library: ${skillName}`);
  }

  // Update agent.json (source of truth)
  const agentJson = agentStore.get(agentId);
  if (agentJson) {
    const skills = agentJson.skills ?? [];
    if (!skills.includes(skillName)) {
      agentStore.update(agentId, { skills: [...skills, skillName] });
    }
  }

  // Create symlink for SDK discovery
  const agentSkillsDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills");
  fs.mkdirSync(agentSkillsDir, { recursive: true });

  const linkPath = path.join(agentSkillsDir, skillName);
  if (isSymlink(linkPath)) {
    const existing = fs.readlinkSync(linkPath);
    if (existing === skillDir) return;
    fs.unlinkSync(linkPath);
  } else if (fs.existsSync(linkPath)) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
  fs.symlinkSync(skillDir, linkPath);
}

/**
 * Deactivate a skill for an agent.
 * Removes from agent.json and deletes symlink.
 * Idempotent.
 */
export function deactivateSkill(workspaceDir: string, skillName: string, agentId: string): void {
  // Update agent.json (source of truth)
  const agentJson = agentStore.get(agentId);
  if (agentJson && agentJson.skills) {
    agentStore.update(agentId, { skills: agentJson.skills.filter((s) => s !== skillName) });
  }

  // Remove symlink
  const linkPath = path.join(workspaceDir, "agents", agentId, ".claude", "skills", skillName);
  if (isSymlink(linkPath)) {
    fs.unlinkSync(linkPath);
  } else if (fs.existsSync(linkPath)) {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
}

/**
 * Delete a skill from the library.
 * Removes skill directory, cleans up all agent.json references and symlinks.
 */
export function deleteSkillFromLibrary(workspaceDir: string, skillName: string): void {
  const skillDir = path.join(workspaceDir, "skills", skillName);
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true });
  }

  // Clean up across all agents: agent.json + symlinks
  const agentsDirPath = path.join(workspaceDir, "agents");
  if (!fs.existsSync(agentsDirPath)) return;

  for (const [id, agent] of agentStore.list()) {
    // Remove from agent.json
    if (agent.skills?.includes(skillName)) {
      agentStore.update(id, { skills: agent.skills.filter((s) => s !== skillName) });
    }

    // Remove symlink
    const linkPath = path.join(agentsDirPath, id, ".claude", "skills", skillName);
    if (isSymlink(linkPath)) {
      fs.unlinkSync(linkPath);
    } else if (fs.existsSync(linkPath)) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  }
}

/**
 * Materialize skills from agent.json into .claude/skills/ symlinks.
 * Full reconcile: directory will exactly match the skills array.
 * Removes entries not in config, adds missing ones.
 * Fails if any skill is missing from library.
 */
export function materializeSkills(workspaceDir: string, agentId: string, skills: string[]): void {
  const agentSkillsDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills");
  const expected = new Set(skills);

  // Remove entries not in config
  if (fs.existsSync(agentSkillsDir)) {
    for (const entry of fs.readdirSync(agentSkillsDir)) {
      if (!expected.has(entry)) {
        fs.rmSync(path.join(agentSkillsDir, entry), { recursive: true, force: true });
      }
    }
  }

  if (skills.length === 0) return;

  fs.mkdirSync(agentSkillsDir, { recursive: true });

  // Add missing symlinks
  for (const skillName of skills) {
    const skillDir = path.join(workspaceDir, "skills", skillName);
    if (!fs.existsSync(skillDir)) {
      throw new Error(`Skill "${skillName}" referenced in agent.json for "${agentId}" not found in library`);
    }

    const linkPath = path.join(agentSkillsDir, skillName);
    if (isSymlink(linkPath)) {
      const existing = fs.readlinkSync(linkPath);
      if (existing === skillDir) continue;
      fs.unlinkSync(linkPath);
    } else if (fs.existsSync(linkPath)) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
    fs.symlinkSync(skillDir, linkPath);
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
