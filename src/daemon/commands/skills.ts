import fs from "fs";
import path from "path";
import os from "os";
import { resolveWorkspace } from "../workspace.js";
import { syncSharedSkills } from "#core/skills.js";

function parseArgs(): { agent: string | undefined; source: string | undefined } {
  const args = process.argv.slice(4);
  const result: { agent: string | undefined; source: string | undefined } = { agent: undefined, source: undefined };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      result.agent = args[i + 1];
      i++;
    } else if (args[i] === "--source" && args[i + 1]) {
      result.source = args[i + 1];
      i++;
    }
  }
  return result;
}

function getSkillLabel(entryPath: string, sharedSkillsDir: string): string {
  const stat = fs.lstatSync(entryPath);
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(entryPath);
    if (target.startsWith(sharedSkillsDir + path.sep) || target === sharedSkillsDir) {
      return "(shared)";
    }
    return "(linked)";
  }
  return "";
}

function listAgentSkills(agentSkillsDir: string, sharedSkillsDir: string): string[] {
  if (!fs.existsSync(agentSkillsDir)) return [];
  return fs.readdirSync(agentSkillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .map((d) => {
      const entryPath = path.join(agentSkillsDir, d.name);
      const label = getSkillLabel(entryPath, sharedSkillsDir);
      return label ? `${d.name} ${label}` : d.name;
    });
}

async function list(workspaceDir: string) {
  const sharedSkillsDir = path.join(workspaceDir, "skills");
  const agentsDir = path.join(workspaceDir, "agents");
  const { agent } = parseArgs();

  if (agent) {
    // Show skills for a specific agent
    const agentDir = path.join(agentsDir, agent);
    if (!fs.existsSync(agentDir)) {
      console.error(`Agent not found: ${agent}`);
      process.exit(1);
    }
    const agentSkillsDir = path.join(agentDir, ".claude", "skills");
    const skills = listAgentSkills(agentSkillsDir, sharedSkillsDir);
    console.log(`${agent}:`);
    if (skills.length === 0) {
      console.log("  (none)");
    } else {
      console.log("  " + skills.join(", "));
    }
    return;
  }

  // Show full skill map
  const sharedSkills: string[] = [];
  if (fs.existsSync(sharedSkillsDir)) {
    for (const d of fs.readdirSync(sharedSkillsDir, { withFileTypes: true })) {
      if (d.isDirectory() || d.isSymbolicLink()) sharedSkills.push(d.name);
    }
  }

  console.log("Shared skills:");
  if (sharedSkills.length === 0) {
    console.log("  (none)");
  } else {
    for (const s of sharedSkills) console.log(`  ${s}`);
  }

  console.log("\nAgent skills:");
  if (!fs.existsSync(agentsDir)) {
    console.log("  (no agents)");
    return;
  }

  const agents = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const a of agents) {
    const agentSkillsDir = path.join(agentsDir, a.name, ".claude", "skills");
    const skills = listAgentSkills(agentSkillsDir, sharedSkillsDir);
    if (skills.length === 0) {
      console.log(`  ${a.name}:  (none)`);
    } else {
      console.log(`  ${a.name}:  ${skills.join(", ")}`);
    }
  }
}

function resolveSource(name: string, sourcePath?: string): { type: "directory" | "file"; resolved: string } {
  if (sourcePath) {
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) {
      console.error(`Source not found: ${sourcePath}`);
      process.exit(1);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(resolved, "SKILL.md"))) {
        console.error(`Directory missing SKILL.md: ${resolved}`);
        process.exit(1);
      }
      return { type: "directory", resolved };
    }
    if (resolved.endsWith(".md")) {
      return { type: "file", resolved };
    }
    console.error(`Source must be a directory with SKILL.md or a .md file: ${sourcePath}`);
    process.exit(1);
  }

  // Resolve from ~/.claude/skills/
  const userSkillsDir = path.join(os.homedir(), ".claude", "skills");
  const dirPath = path.join(userSkillsDir, name);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    if (!fs.existsSync(path.join(dirPath, "SKILL.md"))) {
      console.error(`Directory missing SKILL.md: ${dirPath}`);
      process.exit(1);
    }
    return { type: "directory", resolved: dirPath };
  }
  const filePath = path.join(userSkillsDir, `${name}.md`);
  if (fs.existsSync(filePath)) {
    return { type: "file", resolved: filePath };
  }

  console.error(`Skill not found: ${name}`);
  console.error(`Looked in: ${dirPath} and ${filePath}`);
  process.exit(1);
}

async function link(workspaceDir: string) {
  const name = process.argv[4];
  if (!name) {
    console.error("Usage: nova skills link <name> --agent <id|all> [--source <path>]");
    process.exit(1);
  }

  const { agent, source } = parseArgs();
  if (!agent) {
    console.error("--agent is required");
    console.error("Usage: nova skills link <name> --agent <id|all> [--source <path>]");
    process.exit(1);
  }

  const { type, resolved } = resolveSource(name, source);

  if (agent === "all") {
    const targetDir = path.join(workspaceDir, "skills", name);
    linkSkill(targetDir, resolved, type, name);
    syncSharedSkills(workspaceDir);
    console.log(`Linked ${name} as shared skill and synced to all agents`);
  } else {
    const agentDir = path.join(workspaceDir, "agents", agent);
    if (!fs.existsSync(agentDir)) {
      console.error(`Agent not found: ${agent}`);
      process.exit(1);
    }
    const targetDir = path.join(agentDir, ".claude", "skills", name);
    linkSkill(targetDir, resolved, type, name);
    console.log(`Linked ${name} to agent ${agent}`);
  }
}

function linkSkill(targetDir: string, sourcePath: string, type: "directory" | "file", name: string) {
  if (type === "directory") {
    // Symlink directory directly
    if (fs.existsSync(targetDir)) {
      const stat = fs.lstatSync(targetDir);
      if (stat.isSymbolicLink()) {
        const existing = fs.readlinkSync(targetDir);
        if (existing === sourcePath) {
          console.log(`${name} is already linked`);
          process.exit(0);
        }
        console.error(`${name} is already linked to a different source: ${existing}`);
        console.error(`Run 'nova skills unlink ${name} --agent ...' first`);
        process.exit(1);
      }
      console.error(`${name} already exists as a directory (not a symlink)`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.symlinkSync(sourcePath, targetDir);
  } else {
    // Wrap flat .md file: create directory, symlink file as SKILL.md inside
    if (fs.existsSync(targetDir)) {
      const stat = fs.lstatSync(targetDir);
      if (stat.isSymbolicLink()) {
        // It's a symlink to a directory — already linked differently
        const existing = fs.readlinkSync(targetDir);
        console.error(`${name} is already linked to a different source: ${existing}`);
        console.error(`Run 'nova skills unlink ${name} --agent ...' first`);
        process.exit(1);
      }
      if (stat.isDirectory()) {
        // Check if it's a wrapper directory with symlinked SKILL.md
        const skillMdPath = path.join(targetDir, "SKILL.md");
        if (fs.existsSync(skillMdPath)) {
          const skillStat = fs.lstatSync(skillMdPath);
          if (skillStat.isSymbolicLink()) {
            const existing = fs.readlinkSync(skillMdPath);
            if (existing === sourcePath) {
              console.log(`${name} is already linked`);
              process.exit(0);
            }
            console.error(`${name} is already linked to a different source: ${existing}`);
            console.error(`Run 'nova skills unlink ${name} --agent ...' first`);
            process.exit(1);
          }
        }
        console.error(`${name} already exists as a directory (not a symlink)`);
        process.exit(1);
      }
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.symlinkSync(sourcePath, path.join(targetDir, "SKILL.md"));
  }
}

async function unlink(workspaceDir: string) {
  const name = process.argv[4];
  if (!name) {
    console.error("Usage: nova skills unlink <name> --agent <id|all>");
    process.exit(1);
  }

  const { agent } = parseArgs();
  if (!agent) {
    console.error("--agent is required");
    console.error("Usage: nova skills unlink <name> --agent <id|all>");
    process.exit(1);
  }

  if (agent === "all") {
    const targetDir = path.join(workspaceDir, "skills", name);
    removeSkill(targetDir, name);
    syncSharedSkills(workspaceDir);
    console.log(`Unlinked shared skill ${name} and cleaned up agent symlinks`);
  } else {
    const agentDir = path.join(workspaceDir, "agents", agent);
    if (!fs.existsSync(agentDir)) {
      console.error(`Agent not found: ${agent}`);
      process.exit(1);
    }
    const targetDir = path.join(agentDir, ".claude", "skills", name);
    removeSkill(targetDir, name);
    console.log(`Unlinked ${name} from agent ${agent}`);
  }
}

function removeSkill(targetDir: string, name: string) {
  if (!fs.existsSync(targetDir) && !isSymlink(targetDir)) {
    console.error(`Skill not found: ${name}`);
    process.exit(1);
  }

  const stat = fs.lstatSync(targetDir);

  // Direct symlink to a directory — just remove the symlink
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(targetDir);
    return;
  }

  // Wrapper directory (directory with symlinked SKILL.md)
  if (stat.isDirectory()) {
    const skillMdPath = path.join(targetDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath) && !isSymlink(skillMdPath)) {
      console.error(`${name} is agent-authored, not linked`);
      process.exit(1);
    }
    const skillStat = fs.lstatSync(skillMdPath);
    if (!skillStat.isSymbolicLink()) {
      console.error(`${name} is agent-authored, not linked`);
      process.exit(1);
    }
    // It's a wrapper — check nothing else is in there
    const entries = fs.readdirSync(targetDir);
    if (entries.length === 1 && entries[0] === "SKILL.md") {
      fs.unlinkSync(skillMdPath);
      fs.rmdirSync(targetDir);
      return;
    }
    // Has other files — only remove the symlinked SKILL.md
    fs.unlinkSync(skillMdPath);
    return;
  }

  console.error(`${name} is agent-authored, not linked`);
  process.exit(1);
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function run() {
  const workspaceDir = resolveWorkspace();

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Run 'nova init' first.`);
    process.exit(1);
  }

  const subcommand = process.argv[3];

  switch (subcommand) {
    case "list":
      await list(workspaceDir);
      break;
    case "link":
      await link(workspaceDir);
      break;
    case "unlink":
      await unlink(workspaceDir);
      break;
    default:
      console.error("Usage: nova skills <list|link|unlink>");
      console.error("");
      console.error("  list [--agent <id>]                    List skills (all or per-agent)");
      console.error("  link <name> --agent <id|all>           Link a Claude skill to agent(s)");
      console.error("  link <name> --agent <id> --source <p>  Link a skill from a custom path");
      console.error("  unlink <name> --agent <id|all>         Unlink a skill from agent(s)");
      process.exit(1);
  }
}
