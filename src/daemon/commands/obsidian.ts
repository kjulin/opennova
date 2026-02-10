import fs from "fs";
import path from "path";

const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

export function obsidianInstall(vaultPath: string) {
  // Resolve path
  const resolvedPath = vaultPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", vaultPath.slice(1))
    : path.resolve(vaultPath);

  // Check vault exists
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Vault not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Check .obsidian folder exists
  const obsidianDir = path.join(resolvedPath, ".obsidian");
  if (!fs.existsSync(obsidianDir)) {
    console.error(`❌ Not an Obsidian vault (no .obsidian folder): ${resolvedPath}`);
    process.exit(1);
  }

  // Find plugin source files
  const pluginSrcDir = path.resolve(import.meta.dirname, "..", "..", "..", "packages", "obsidian-plugin");

  // Check if plugin is built
  const mainJs = path.join(pluginSrcDir, "main.js");
  if (!fs.existsSync(mainJs)) {
    console.error("❌ Plugin not built. Run 'npm run build' in packages/obsidian-plugin first.");
    process.exit(1);
  }

  // Create plugin folder
  const pluginDir = path.join(obsidianDir, "plugins", "nova-cowork");
  fs.mkdirSync(pluginDir, { recursive: true });

  // Copy files
  for (const file of PLUGIN_FILES) {
    const src = path.join(pluginSrcDir, file);
    const dest = path.join(pluginDir, file);

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  ✓ ${file}`);
    } else {
      console.warn(`  ⚠ ${file} not found`);
    }
  }

  console.log(`\n✅ Nova Cowork plugin installed to ${resolvedPath}`);
  console.log("\nNext steps:");
  console.log("  1. Restart Obsidian (or reload plugins)");
  console.log("  2. Go to Settings → Community plugins → Enable 'Nova Cowork'");
  console.log("  3. Start the daemon: nova daemon");
}

export function obsidianUninstall(vaultPath: string) {
  const resolvedPath = vaultPath.startsWith("~")
    ? path.join(process.env.HOME ?? "", vaultPath.slice(1))
    : path.resolve(vaultPath);

  const pluginDir = path.join(resolvedPath, ".obsidian", "plugins", "nova-cowork");

  if (!fs.existsSync(pluginDir)) {
    console.log("Plugin not installed in this vault.");
    return;
  }

  fs.rmSync(pluginDir, { recursive: true });
  console.log(`✅ Nova Cowork plugin removed from ${resolvedPath}`);
}
