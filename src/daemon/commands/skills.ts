import fs from "fs";
import path from "path";
import { resolveWorkspace } from "../workspace.js";
import {
  activateSkill,
  deactivateSkill,
  deleteSkillFromLibrary,
} from "#core/skills.js";
import { readAgentJson, loadAllAgents } from "#core/agents/index.js";
import { Config } from "#core/config.js";

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

async function list(workspaceDir: string) {
  const sharedSkillsDir = path.join(workspaceDir, "skills");
  const { agent } = parseArgs();

  if (agent) {
    const agentJson = readAgentJson(agent);
    if (!agentJson) {
      console.error(`Agent not found: ${agent}`);
      process.exit(1);
    }
    const skills = agentJson.skills ?? [];
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
  const agents = loadAllAgents();
  if (agents.size === 0) {
    console.log("  (no agents)");
    return;
  }

  for (const [id, agent] of agents) {
    const skills = agent.skills ?? [];
    if (skills.length === 0) {
      console.log(`  ${id}:  (none)`);
    } else {
      console.log(`  ${id}:  ${skills.join(", ")}`);
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
    const agents = loadAllAgents();
    for (const [id] of agents) {
      activateSkill(workspaceDir, name, id);
    }
    console.log(`Activated ${name} for all agents`);
  } else {
    const agentJson = readAgentJson(agent);
    if (!agentJson) {
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
    const agents = loadAllAgents();
    for (const [id] of agents) {
      deactivateSkill(workspaceDir, name, id);
    }
    console.log(`Deactivated ${name} for all agents`);
  } else {
    const agentJson = readAgentJson(agent);
    if (!agentJson) {
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
  console.log(`Deleted skill ${name} from library and removed all agent references`);
}

export async function run() {
  const workspaceDir = resolveWorkspace();
  Config.workspaceDir = workspaceDir;

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
