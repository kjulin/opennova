import fs from "fs";
import path from "path";
import { resolveWorkspace } from "../workspace.js";
import {
  activateSkill,
  deactivateSkill,
  deleteSkillFromLibrary,
} from "#core/skills.js";

function parseArgs(): { agent: string | undefined } {
  const args = process.argv.slice(4);
  const result: { agent: string | undefined } = { agent: undefined };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" && args[i + 1]) {
      result.agent = args[i + 1];
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

async function link(workspaceDir: string) {
  const name = process.argv[4];
  if (!name) {
    console.error("Usage: nova skills link <name> --agent <id|all>");
    process.exit(1);
  }

  const { agent } = parseArgs();
  if (!agent) {
    console.error("--agent is required");
    console.error("Usage: nova skills link <name> --agent <id|all>");
    process.exit(1);
  }

  // Verify skill exists in library
  const skillDir = path.join(workspaceDir, "skills", name);
  if (!fs.existsSync(skillDir)) {
    console.error(`Skill not found in library: ${name}`);
    console.error(`Available skills are in ${path.join(workspaceDir, "skills")}/`);
    process.exit(1);
  }

  if (agent === "all") {
    const agentsDir = path.join(workspaceDir, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) activateSkill(workspaceDir, name, entry.name);
      }
    }
    console.log(`Activated ${name} for all agents`);
  } else {
    const agentDir = path.join(workspaceDir, "agents", agent);
    if (!fs.existsSync(agentDir)) {
      console.error(`Agent not found: ${agent}`);
      process.exit(1);
    }
    activateSkill(workspaceDir, name, agent);
    console.log(`Activated ${name} for agent ${agent}`);
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
    const agentsDir = path.join(workspaceDir, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) deactivateSkill(workspaceDir, name, entry.name);
      }
    }
    console.log(`Deactivated ${name} for all agents`);
  } else {
    const agentDir = path.join(workspaceDir, "agents", agent);
    if (!fs.existsSync(agentDir)) {
      console.error(`Agent not found: ${agent}`);
      process.exit(1);
    }
    deactivateSkill(workspaceDir, name, agent);
    console.log(`Deactivated ${name} for agent ${agent}`);
  }
}

async function deleteSkill(workspaceDir: string) {
  const name = process.argv[4];
  if (!name) {
    console.error("Usage: nova skills delete <name>");
    process.exit(1);
  }

  const skillDir = path.join(workspaceDir, "skills", name);
  if (!fs.existsSync(skillDir)) {
    console.error(`Skill not found in library: ${name}`);
    process.exit(1);
  }

  deleteSkillFromLibrary(workspaceDir, name);
  console.log(`Deleted skill ${name} from library and removed all agent symlinks`);
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
    case "delete":
      await deleteSkill(workspaceDir);
      break;
    default:
      console.error("Usage: nova skills <list|link|unlink|delete>");
      console.error("");
      console.error("  list [--agent <id>]              List skills (all or per-agent)");
      console.error("  link <name> --agent <id|all>     Activate a library skill for agent(s)");
      console.error("  unlink <name> --agent <id|all>   Deactivate a skill for agent(s)");
      console.error("  delete <name>                    Delete a skill from the library");
      process.exit(1);
  }
}
