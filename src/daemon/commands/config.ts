import fs from "fs";
import { resolveWorkspace, getConfigValue, setConfigValue, listConfig, SENSITIVE_KEYS } from "../workspace.js";

export async function run() {
  const subcommand = process.argv[3];
  const workspaceDir = resolveWorkspace();

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Run 'nova init' first.`);
    process.exit(1);
  }

  switch (subcommand) {
    case "list": {
      const config = listConfig(workspaceDir);
      const entries = Object.entries(config);
      if (entries.length === 0) {
        console.log("No configuration found.");
        return;
      }
      for (const [key, value] of entries) {
        console.log(`${key} = ${value}`);
      }
      break;
    }
    case "get": {
      const key = process.argv[4];
      if (!key) {
        console.error("Usage: nova config get <key>");
        process.exit(1);
      }
      if (key === "api-token") {
        // Resolution: NOVA_API_TOKEN env → keyring → fail
        const envToken = process.env.NOVA_API_TOKEN;
        if (envToken) {
          console.log(envToken);
          return;
        }
        try {
          const { getSecret } = await import("#core/secrets.js");
          const token = getSecret("nova-api-token");
          console.log(token);
        } catch {
          console.error("No API token found. Run 'nova init' to generate one.");
          process.exit(1);
        }
        return;
      }
      const value = getConfigValue(workspaceDir, key);
      if (value === undefined) {
        console.error(`Key not found: ${key}`);
        process.exit(1);
      }
      if (SENSITIVE_KEYS.has(key)) {
        const str = String(value);
        console.log(str.length <= 8 ? "****" : str.slice(0, 4) + "****" + str.slice(-4));
      } else {
        console.log(value);
      }
      break;
    }
    case "set": {
      const key = process.argv[4];
      const value = process.argv[5];
      if (!key || value === undefined) {
        console.error("Usage: nova config set <key> <value>");
        process.exit(1);
      }
      setConfigValue(workspaceDir, key, value);
      console.log(`Set ${key}`);
      break;
    }
    default:
      console.error("Usage: nova config <list|get|set>");
      process.exit(1);
  }
}
