import readline from "readline";
import { resolveWorkspace } from "../workspace.js";
import {
  getSecret,
  setSecret,
  deleteSecret,
  listSecretNames,
  addSecretName,
  removeSecretName,
} from "#core/secrets.js";

export async function run() {
  const workspaceDir = resolveWorkspace();
  const subcommand = process.argv[3];

  switch (subcommand) {
    case "set": {
      const name = process.argv[4];
      if (!name) {
        console.error("Usage: nova secrets set <name>");
        process.exit(1);
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      process.stdout.write("Secret value: ");
      const value = await new Promise<string>((resolve) => {
        const stdin = process.stdin;
        stdin.setRawMode?.(true);
        let input = "";
        const onData = (data: Buffer) => {
          const char = data.toString();
          if (char === "\n" || char === "\r") {
            stdin.setRawMode?.(false);
            stdin.removeListener("data", onData);
            process.stdout.write("\n");
            resolve(input);
          } else if (char === "\x7f" || char === "\b") {
            input = input.slice(0, -1);
          } else if (char === "\x03") {
            process.exit(1);
          } else {
            input += char;
          }
        };
        stdin.on("data", onData);
        stdin.resume();
      });
      rl.close();

      setSecret(name, value);
      addSecretName(workspaceDir, name);
      console.log(`Secret "${name}" saved.`);
      break;
    }

    case "get": {
      const name = process.argv[4];
      if (!name) {
        console.error("Usage: nova secrets get <name>");
        process.exit(1);
      }
      try {
        const value = getSecret(name);
        console.log(value);
      } catch {
        console.error(`Secret not found: ${name}`);
        process.exit(1);
      }
      break;
    }

    case "list": {
      const names = listSecretNames(workspaceDir);
      for (const name of names) {
        console.log(name);
      }
      break;
    }

    case "delete": {
      const name = process.argv[4];
      if (!name) {
        console.error("Usage: nova secrets delete <name>");
        process.exit(1);
      }
      try {
        deleteSecret(name);
      } catch {
        // Graceful if not in keyring
      }
      removeSecretName(workspaceDir, name);
      console.log(`Secret "${name}" deleted.`);
      break;
    }

    default:
      console.log("Usage: nova secrets <command>\n");
      console.log("Commands:");
      console.log("  set <name>      Set a secret (prompts for value)");
      console.log("  get <name>      Get a secret value");
      console.log("  list            List secret names");
      console.log("  delete <name>   Delete a secret");
      process.exit(subcommand ? 1 : 0);
  }
}
