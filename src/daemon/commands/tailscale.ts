import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export async function run() {
  const subcommand = process.argv[3];

  if (subcommand === "setup") {
    await setupTailscale();
  } else {
    console.log("Usage: nova tailscale setup");
    console.log();
    console.log("Commands:");
    console.log("  setup    Generate Tailscale HTTPS certs for Mini App");
  }
}

async function setupTailscale() {
  // Check if Tailscale is available
  try {
    execSync("which tailscale", { encoding: "utf-8" });
  } catch {
    console.error("Error: Tailscale CLI not found. Install Tailscale first.");
    process.exit(1);
  }

  // Get Tailscale status
  let statusJson: string;
  try {
    statusJson = execSync("tailscale status --json", { encoding: "utf-8" });
  } catch (err) {
    console.error("Error: Failed to get Tailscale status. Is Tailscale running?");
    process.exit(1);
  }

  const status = JSON.parse(statusJson);

  if (!status.Self?.DNSName) {
    console.error("Error: Not connected to Tailscale or MagicDNS not enabled");
    console.error("Make sure you're logged in and MagicDNS is enabled in your tailnet.");
    process.exit(1);
  }

  // DNSName includes trailing dot, remove it
  const hostname = status.Self.DNSName.replace(/\.$/, "");
  console.log(`Tailscale hostname: ${hostname}`);

  // Create cert directory
  const certDir = path.join(os.homedir(), ".nova", "certs");
  fs.mkdirSync(certDir, { recursive: true });

  // Generate certs (tailscale cert writes to current directory)
  console.log("Generating HTTPS certificates...");
  const cwd = process.cwd();
  try {
    process.chdir(certDir);
    execSync(`tailscale cert ${hostname}`, { stdio: "inherit" });
  } finally {
    process.chdir(cwd);
  }

  const certFile = path.join(certDir, `${hostname}.crt`);
  const keyFile = path.join(certDir, `${hostname}.key`);

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    console.log(`\nCertificates saved to ${certDir}`);
    console.log(`\nSetup complete. HTTPS will be available at:`);
    console.log(`  https://${hostname}:3838`);
    console.log(`\nStart the daemon with: nova daemon`);
  } else {
    console.error("\nError: Certificates were not created. Check Tailscale permissions.");
    process.exit(1);
  }
}
