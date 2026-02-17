import fs from "fs";
import path from "path";
import os from "os";
import { resolveWorkspace } from "../workspace.js";
import { syncSharedSkills } from "#core/skills.js";

function parseArgs() {
  const args = process.argv.slice(3);
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      flags[key] = args[i + 1] ?? "";
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function getAgentIds(workspaceDir: string): string[] {
  const agentsDir = path.join(workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function agentExists(workspaceDir: string, agentId: string): boolean {
  return fs.existsSync(path.join(workspaceDir, "agents", agentId));
}

function getSharedSkills(workspaceDir: string): string[] {
  const dir = path.join(workspaceDir, "skills");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .map((d) => d.name);
}

function getAgentSkills(workspaceDir: string, agentId: string): { name: string; label: string }[] {
  const skillsDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills");
  if (!fs.existsSync(skillsDir)) return [];

  const sharedSkillsDir = path.join(workspaceDir, "skills");
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: { name: string; label: string }[] = [];

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry.name);
    const stat = fs.lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(entryPath);
      if (target.startsWith(sharedSkillsDir + path.sep) || target === sharedSkillsDir) {
        skills.push({ name: entry.name, label: "(shared)" });
      } else {
        skills.push({ name: entry.name, label: "(linked)" });
      }
    } else if (stat.isDirectory()) {
      // Check if it's a wrapper directory (contains only a symlinked SKILL.md)
      const contents = fs.readdirSync(entryPath);
      if (contents.length === 1 && contents[0] === "SKILL.md") {
        const skillMdPath = path.join(entryPath, "SKILL.md");
        const skillMdStat = fs.lstatSync(skillMdPath);
        if (skillMdStat.isSymbolicLink()) {
          skills.push({ name: entry.name, label: "(linked)" });
          continue;
        }
      }
      skills.push({ name: entry.name, label: "" });
    }
  }
  return skills;
}

function list(workspaceDir: string, agentFilter?: string) {
  if (agentFilter) {
    if (!agentExists(workspaceDir, agentFilter)) {
      console.error(`Agent not found: ${agentFilter}`);
      process.exit(1);
    }
    const skills = getAgentSkills(workspaceDir, agentFilter);
    console.log(`${agentFilter}:`);
    if (skills.length === 0) {
      console.log("  (none)");
    } else {
      for (const s of skills) {
        console.log(`  ${s.name}${s.label ? " " + s.label : ""}`);
      }
    }
    return;
  }

  // Full skill map
  const sharedSkills = getSharedSkills(workspaceDir);
  console.log("Shared skills:");
  if (sharedSkills.length === 0) {
    console.log("  (none)");
  } else {
    for (const s of sharedSkills) {
      console.log(`  ${s}`);
    }
  }

  console.log();
  console.log("Agent skills:");
  const agents = getAgentIds(workspaceDir);
  if (agents.length === 0) {
    console.log("  (no agents)");
  } else {
    for (const agent of agents) {
      const skills = getAgentSkills(workspaceDir, agent);
      const skillList = skills.length > 0
        ? skills.map((s) => s.name + (s.label ? " " + s.label : "")).join(", ")
        : "(none)";
      console.log(`  ${agent}:  ${skillList}`);
    }
  }
}

function resolveSource(name: string, sourcePath?: string): { type: "directory" | "file"; path: string } {
  if (sourcePath) {
    const resolved = sourcePath.startsWith("~")
      ? path.join(os.homedir(), sourcePath.slice(1))
      : path.resolve(sourcePath);

    if (!fs.existsSync(resolved)) {
      console.error(`Source not found: ${sourcePath}`);
      process.exit(1);
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(resolved, "SKILL.md"))) {
        console.error(`Source directory does not contain SKILL.md: ${sourcePath}`);
        process.exit(1);
      }
      return { type: "directory", path: resolved };
    } else if (resolved.endsWith(".md")) {
      return { type: "file", path: resolved };
    } else {
      console.error(`Source must be a directory with SKILL.md or a .md file: ${sourcePath}`);
      process.exit(1);
    }
  }

  // Resolve from ~/.claude/skills/<name>
  const userSkillsDir = path.join(os.homedir(), ".claude", "skills");

  // Check directory first
  const dirPath = path.join(userSkillsDir, name);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    if (!fs.existsSync(path.join(dirPath, "SKILL.md"))) {
      console.error(`User skill directory does not contain SKILL.md: ${dirPath}`);
      process.exit(1);
    }
    return { type: "directory", path: dirPath };
  }

  // Check flat file
  const filePath = path.join(userSkillsDir, `${name}.md`);
  if (fs.existsSync(filePath)) {
    return { type: "file", path: filePath };
  }

  console.error(`Skill not found: ${name}`);
  console.error(`Looked in: ${dirPath}/ and ${filePath}`);
  process.exit(1);
}

function linkSkill(workspaceDir: string, name: string, agentId: string, sourcePath?: string) {
  const source = resolveSource(name, sourcePath);

  if (agentId === "all") {
    // Link to shared skills
    const targetDir = path.join(workspaceDir, "skills", name);

    if (fs.existsSync(targetDir)) {
      const stat = fs.lstatSync(targetDir);
      if (stat.isSymbolicLink()) {
        const existing = fs.readlinkSync(targetDir);
        if (source.type === "directory" && existing === source.path) {
          console.log(`Already linked: ${name} → ${source.path}`);
          return;
        }
        console.error(`Skill "${name}" already linked to ${existing}. Unlink first.`);
        process.exit(1);
      }
      // For wrapped flat files, check the inner symlink
      if (stat.isDirectory() && source.type === "file") {
        const innerPath = path.join(targetDir, "SKILL.md");
        if (fs.existsSync(innerPath) && fs.lstatSync(innerPath).isSymbolicLink()) {
          const existing = fs.readlinkSync(innerPath);
          if (existing === source.path) {
            console.log(`Already linked: ${name} → ${source.path}`);
            return;
          }
          console.error(`Skill "${name}" already linked to ${existing}. Unlink first.`);
          process.exit(1);
        }
      }
      if (stat.isDirectory()) {
        console.error(`Skill "${name}" already exists at ${targetDir}. Unlink first.`);
        process.exit(1);
      }
    }

    fs.mkdirSync(path.join(workspaceDir, "skills"), { recursive: true });

    if (source.type === "directory") {
      fs.symlinkSync(source.path, targetDir);
    } else {
      // Wrap flat file
      fs.mkdirSync(targetDir, { recursive: true });
      fs.symlinkSync(source.path, path.join(targetDir, "SKILL.md"));
    }

    syncSharedSkills(workspaceDir);
    console.log(`Linked ${name} → ${source.path} (shared with all agents)`);
    return;
  }

  // Link to specific agent
  if (!agentExists(workspaceDir, agentId)) {
    console.error(`Agent not found: ${agentId}`);
    process.exit(1);
  }

  const targetDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills", name);

  if (fs.existsSync(targetDir)) {
    const stat = fs.lstatSync(targetDir);
    if (stat.isSymbolicLink()) {
      const existing = fs.readlinkSync(targetDir);
      if (source.type === "directory" && existing === source.path) {
        console.log(`Already linked: ${name} → ${source.path}`);
        return;
      }
      console.error(`Skill "${name}" already linked to ${existing}. Unlink first.`);
      process.exit(1);
    }
    // For wrapped flat files, check the inner symlink
    if (stat.isDirectory() && source.type === "file") {
      const innerPath = path.join(targetDir, "SKILL.md");
      if (fs.existsSync(innerPath) && fs.lstatSync(innerPath).isSymbolicLink()) {
        const existing = fs.readlinkSync(innerPath);
        if (existing === source.path) {
          console.log(`Already linked: ${name} → ${source.path}`);
          return;
        }
        console.error(`Skill "${name}" already linked to ${existing}. Unlink first.`);
        process.exit(1);
      }
    }
    if (stat.isDirectory()) {
      console.error(`Skill "${name}" already exists at ${targetDir}. Unlink first.`);
      process.exit(1);
    }
  }

  fs.mkdirSync(path.join(workspaceDir, "agents", agentId, ".claude", "skills"), { recursive: true });

  if (source.type === "directory") {
    fs.symlinkSync(source.path, targetDir);
  } else {
    // Wrap flat file
    fs.mkdirSync(targetDir, { recursive: true });
    fs.symlinkSync(source.path, path.join(targetDir, "SKILL.md"));
  }

  console.log(`Linked ${name} → ${source.path} (agent: ${agentId})`);
}

function unlinkSkill(workspaceDir: string, name: string, agentId: string) {
  if (agentId === "all") {
    const targetDir = path.join(workspaceDir, "skills", name);

    if (!fs.existsSync(targetDir)) {
      console.error(`Shared skill not found: ${name}`);
      process.exit(1);
    }

    const stat = fs.lstatSync(targetDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(targetDir);
    } else if (stat.isDirectory()) {
      // Check if it's a wrapper directory
      const contents = fs.readdirSync(targetDir);
      if (contents.length === 1 && contents[0] === "SKILL.md") {
        const skillMdPath = path.join(targetDir, "SKILL.md");
        if (fs.lstatSync(skillMdPath).isSymbolicLink()) {
          fs.unlinkSync(skillMdPath);
          fs.rmdirSync(targetDir);
        } else {
          console.error(`Skill "${name}" is authored content, not linked`);
          process.exit(1);
        }
      } else {
        console.error(`Skill "${name}" is agent-authored, not linked`);
        process.exit(1);
      }
    }

    syncSharedSkills(workspaceDir);
    console.log(`Unlinked shared skill: ${name}`);
    return;
  }

  // Unlink from specific agent
  if (!agentExists(workspaceDir, agentId)) {
    console.error(`Agent not found: ${agentId}`);
    process.exit(1);
  }

  const targetDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills", name);

  if (!fs.existsSync(targetDir)) {
    console.error(`Skill not found for agent ${agentId}: ${name}`);
    process.exit(1);
  }

  const stat = fs.lstatSync(targetDir);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(targetDir);
  } else if (stat.isDirectory()) {
    // Check if it's a wrapper directory
    const contents = fs.readdirSync(targetDir);
    if (contents.length === 1 && contents[0] === "SKILL.md") {
      const skillMdPath = path.join(targetDir, "SKILL.md");
      if (fs.lstatSync(skillMdPath).isSymbolicLink()) {
        fs.unlinkSync(skillMdPath);
        fs.rmdirSync(targetDir);
      } else {
        console.error(`Skill "${name}" is agent-authored, not linked`);
        process.exit(1);
      }
    } else {
      console.error(`Skill "${name}" is agent-authored, not linked`);
      process.exit(1);
    }
  }

  console.log(`Unlinked skill "${name}" from agent ${agentId}`);
}

export async function run() {
  const workspaceDir = resolveWorkspace();

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Run 'nova init' first.`);
    process.exit(1);
  }

  const { positional, flags } = parseArgs();
  const subcommand = positional[0];

  if (subcommand === "list") {
    list(workspaceDir, flags.agent);
    return;
  }

  if (subcommand === "link") {
    const name = positional[1];
    if (!name) {
      console.error("Usage: nova skills link <name> --agent <agentId|all> [--source <path>]");
      process.exit(1);
    }
    if (!flags.agent) {
      console.error("--agent is required");
      console.error("Usage: nova skills link <name> --agent <agentId|all> [--source <path>]");
      process.exit(1);
    }
    linkSkill(workspaceDir, name, flags.agent, flags.source);
    return;
  }

  if (subcommand === "unlink") {
    const name = positional[1];
    if (!name) {
      console.error("Usage: nova skills unlink <name> --agent <agentId|all>");
      process.exit(1);
    }
    if (!flags.agent) {
      console.error("--agent is required");
      console.error("Usage: nova skills unlink <name> --agent <agentId|all>");
      process.exit(1);
    }
    unlinkSkill(workspaceDir, name, flags.agent);
    return;
  }

  console.log("Usage: nova skills <command>\n");
  console.log("Commands:");
  console.log("  list [--agent <id>]                    List skills (all or per-agent)");
  console.log("  link <name> --agent <id|all>           Link a Claude skill to agent(s)");
  console.log("  link <name> --agent <id> --source <p>  Link a skill from a custom path");
  console.log("  unlink <name> --agent <id|all>         Unlink a skill from agent(s)");
  process.exit(subcommand ? 1 : 0);
}
