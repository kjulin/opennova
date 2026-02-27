import fs from "fs";
import path from "path";
import { readAgentJson, writeAgentJson } from "./agents/io.js";

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
  const agentJson = readAgentJson(agentId);
  if (agentJson) {
    const skills = agentJson.skills ?? [];
    if (!skills.includes(skillName)) {
      agentJson.skills = [...skills, skillName];
      writeAgentJson(agentId, agentJson);
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
  const agentJson = readAgentJson(agentId);
  if (agentJson && agentJson.skills) {
    agentJson.skills = agentJson.skills.filter((s) => s !== skillName);
    writeAgentJson(agentId, agentJson);
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
  const agentsDir = path.join(workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return;

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    // Remove from agent.json
    const agentJson = readAgentJson(entry.name);
    if (agentJson && agentJson.skills?.includes(skillName)) {
      agentJson.skills = agentJson.skills.filter((s) => s !== skillName);
      writeAgentJson(entry.name, agentJson);
    }

    // Remove symlink
    const linkPath = path.join(agentsDir, entry.name, ".claude", "skills", skillName);
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
