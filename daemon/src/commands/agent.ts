import fs from "fs";
import path from "path";
import { resolveWorkspace } from "../workspace.js";
import { SecurityLevel } from "../schemas.js";

const VALID_LEVELS = SecurityLevel.options;

export function run() {
  const workspaceDir = resolveWorkspace();
  const agentsDir = path.join(workspaceDir, "agents");

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Run 'nova init' first.`);
    process.exit(1);
  }

  const agentId = process.argv[3];

  // nova agent — list all agents
  if (!agentId) {
    if (!fs.existsSync(agentsDir)) {
      console.log("No agents found.");
      return;
    }
    const dirs = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of dirs) {
      const configPath = path.join(agentsDir, dir.name, "agent.json");
      if (!fs.existsSync(configPath)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const security = config.security ? ` [${config.security}]` : "";
        console.log(`${dir.name}  ${config.name || dir.name}${security}`);
      } catch {
        console.log(dir.name);
      }
    }
    return;
  }

  // Verify agent exists
  const agentDir = path.join(agentsDir, agentId);
  const configPath = path.join(agentDir, "agent.json");
  if (!fs.existsSync(configPath)) {
    console.error(`Agent not found: ${agentId}`);
    process.exit(1);
  }

  const subcommand = process.argv[4];

  // nova agent <id> — show agent details
  if (!subcommand) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log(`Name:       ${config.name || agentId}`);
    console.log(`ID:         ${agentId}`);
    console.log(`Security:   ${config.security || "(global default)"}`);
    if (config.cwd) console.log(`Directory:  ${config.cwd}`);
    if (config.subagents) {
      console.log(`Subagents:  ${Object.keys(config.subagents).join(", ")}`);
    }
    const threadsDir = path.join(agentDir, "threads");
    if (fs.existsSync(threadsDir)) {
      const count = fs.readdirSync(threadsDir).filter((f) => f.endsWith(".jsonl")).length;
      console.log(`Threads:    ${count}`);
    }
    return;
  }

  // nova agent <id> security <level>
  if (subcommand === "security") {
    const level = process.argv[5];
    if (!level) {
      console.error("Usage: nova agent <id> security <level>");
      console.error(`Levels: ${VALID_LEVELS.join(", ")}`);
      process.exit(1);
    }

    if (!VALID_LEVELS.includes(level as typeof VALID_LEVELS[number])) {
      console.error(`Invalid security level: ${level}`);
      console.error(`Valid levels: ${VALID_LEVELS.join(", ")}`);
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.security = level;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Set ${agentId} security to ${level}`);
    return;
  }

  console.error(`Unknown subcommand: ${subcommand}`);
  console.error("Usage: nova agent [<id>] [security <level>]");
  process.exit(1);
}
