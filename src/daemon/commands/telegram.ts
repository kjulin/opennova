import readline from "readline/promises";
import { readPidFile, isRunning } from "./utils.js";

const TOKEN_REGEX = /^[0-9]+:[A-Za-z0-9_-]{35,}$/;
const MAX_TOKEN_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function ensureDaemonRunning(): { port: number } {
  const pidInfo = readPidFile();
  if (!pidInfo || !isRunning(pidInfo.pid)) {
    console.log("Daemon is not running. Run 'nova start' first.");
    process.exit(1);
  }
  return { port: pidInfo.port };
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function pair(port: number): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Handle Ctrl+C gracefully
  const cleanup = () => {
    rl.close();
    console.log("\nPairing cancelled.");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);

  try {
    // Prompt for bot token with validation and retry
    let token: string | null = null;
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
      const input = (await rl.question("Paste your Telegram bot token: ")).trim();
      if (!TOKEN_REGEX.test(input)) {
        console.log("That doesn't look like a valid bot token. It should look like: 1234567890:ABCdefGHI...");
        if (attempt < MAX_TOKEN_ATTEMPTS - 1) continue;
        console.log("Too many invalid attempts.");
        process.exit(1);
      }

      // Send to daemon for validation
      process.stdout.write("Validating bot token... ");
      let startResult: { status?: string; error?: string };
      try {
        const res = await fetch(`${baseUrl(port)}/api/telegram/pair/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botToken: input }),
        });
        startResult = await res.json() as typeof startResult;
      } catch {
        console.log("✗");
        console.log("Could not connect to daemon. Is it running?");
        process.exit(1);
      }

      if (startResult.error) {
        console.log("✗");
        console.log(startResult.error);
        if (attempt < MAX_TOKEN_ATTEMPTS - 1) continue;
        console.log("Too many invalid attempts.");
        process.exit(1);
      }

      console.log("✓");
      token = input;
      break;
    }

    if (!token) {
      process.exit(1);
    }

    console.log("Open Telegram and send any message to your bot.");
    process.stdout.write("Waiting for message...");

    // Poll for message
    const pollStart = Date.now();
    let status: { status: string; user?: { chatId: number; firstName: string; lastName: string | null; username: string | null }; error?: string };

    while (true) {
      if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
        console.log("");
        console.log("No message received. Make sure you messaged your bot in Telegram, then try again.");
        process.exit(1);
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      try {
        const res = await fetch(`${baseUrl(port)}/api/telegram/pair/status`);
        status = await res.json() as typeof status;
      } catch {
        console.log("");
        console.log("Lost connection to daemon.");
        process.exit(1);
      }

      if (status.status === "message_received" && status.user) {
        console.log(""); // end "Waiting for message..." line

        // Format user display
        let display = `Message received from ${status.user.firstName}`;
        if (status.user.lastName) display += ` ${status.user.lastName}`;
        if (status.user.username) display += ` (username: ${status.user.username})`;
        console.log(display);
        break;
      }

      if (status.status === "error") {
        console.log("");
        console.log(status.error ?? "An error occurred during pairing.");
        process.exit(1);
      }
    }

    // Confirm pairing
    const confirm = (await rl.question("Confirm pairing? (Y/n): ")).trim().toLowerCase();
    if (confirm === "" || confirm === "y" || confirm === "yes") {
      try {
        const res = await fetch(`${baseUrl(port)}/api/telegram/pair/confirm`, { method: "POST" });
        const result = await res.json() as { status?: string; error?: string };
        if (result.error) {
          console.log(`Error: ${result.error}`);
          process.exit(1);
        }
      } catch {
        console.log("Could not connect to daemon.");
        process.exit(1);
      }
      console.log("Pairing complete! Your bot is now connected.");
      console.log("Run 'nova status' to verify.");
    } else {
      try {
        await fetch(`${baseUrl(port)}/api/telegram/pair/cancel`, { method: "POST" });
      } catch {
        // ignore
      }
      console.log("Pairing cancelled. Run 'nova telegram pair' to try again.");
    }
  } finally {
    process.removeListener("SIGINT", cleanup);
    rl.close();
  }
}

async function unpairCommand(port: number): Promise<void> {
  let result: { status?: string };
  try {
    const res = await fetch(`${baseUrl(port)}/api/telegram/unpair`, {
      method: "POST",
    });
    result = await res.json() as typeof result;
  } catch {
    console.log("Could not connect to daemon. Is it running?");
    process.exit(1);
  }

  if (result.status === "unpaired") {
    console.log("Telegram bot disconnected. Bot token and chat ID cleared.");
  } else if (result.status === "not_paired") {
    console.log("Telegram is not paired. Nothing to do.");
  }
}

export async function run(subcommand: "pair" | "unpair"): Promise<void> {
  const { port } = ensureDaemonRunning();

  if (subcommand === "pair") {
    await pair(port);
  } else {
    await unpairCommand(port);
  }
}
