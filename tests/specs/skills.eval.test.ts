import { describe, test, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "../..")

/** Recursively collect all .ts files under a directory */
function collectTsFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full))
    } else if (entry.name.endsWith(".ts")) {
      results.push(full)
    }
  }
  return results
}

describe("Spec Evals: Skills", () => {
  describe("Boundary", () => {
    // "OpenNova does not parse or inject skill content. The SDK handles discovery and injection." — skills.md
    // "OpenNova never reads skill content at runtime, never injects skills into the system prompt, and never interprets what a skill does." — skills.md
    test("Core skills module does not read SKILL.md content", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      // syncSharedSkills should only deal with symlinks, never readFileSync on SKILL.md
      expect(content).not.toMatch(/readFileSync/)
      expect(content).not.toMatch(/readFile\(/)
    })

    // "OpenNova does not parse, interpret, or inject skill content into the system prompt." — skills.md
    // "System prompt assembly (System Prompt spec — skills are not part of the system prompt)" — skills.md
    test("System prompt assembly does not reference skills", () => {
      const promptFiles = collectTsFiles(join(ROOT, "src/core/prompts"))
      expect(promptFiles.length).toBeGreaterThan(0)
      for (const file of promptFiles) {
        const content = readFileSync(file, "utf-8")
        expect(content).not.toMatch(/skill/i)
      }
    })
  })

  describe("Structural", () => {
    // "All skills live in the workspace skill library: {workspace}/skills/{skill-name}/SKILL.md" — skills.md
    test("Core skills module uses skills/{name} path pattern", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      // Must reference the "skills" subdirectory within workspace
      expect(content).toMatch(/["']skills["']/)
    })

    // "A skill is a directory containing a SKILL.md file" — skills.md
    test("Console API reads SKILL.md from skill directories", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      expect(content).toMatch(/SKILL\.md/)
    })

    // "Skill names follow the same rules as agent IDs: lowercase alphanumeric with hyphens (/^[a-z0-9][a-z0-9-]*$/)" — skills.md
    test("Console API validates skill names with correct regex", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      expect(content).toMatch(/\[a-z0-9\]\[a-z0-9-\]\*/)
    })

    // "settingSources: ['project']" — skills.md
    // "This tells the SDK to scan the agent's working directory ({agentDir}) for .claude/skills/" — skills.md
    test("Engine sets settingSources to ['project']", () => {
      const content = readFileSync(join(ROOT, "src/core/engine/claude.ts"), "utf-8")
      expect(content).toMatch(/settingSources:\s*\["project"\]/)
    })

    // "A skill is a directory containing a SKILL.md file with optional YAML frontmatter" — skills.md
    // "name — identifier, matches directory name" — skills.md
    // "description — tells the agent when to invoke this skill" — skills.md
    test("Console API parses frontmatter with name and description fields", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      expect(content).toMatch(/frontmatter|Frontmatter/i)
      expect(content).toMatch(/name\??:\s*string/)
      expect(content).toMatch(/description\??:\s*string/)
    })

    // "Activation creates a symlink from {agentDir}/.claude/skills/{skill-name} to {workspace}/skills/{skill-name}" — skills.md
    test("Core skills module creates symlinks in .claude/skills/ path", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      expect(content).toMatch(/\.claude.*skills/)
      expect(content).toMatch(/symlinkSync/)
    })

    // "The agent's .claude/skills/ directory contains only symlinks to the workspace library — never source files." — skills.md
    test("Console API activation creates symlinks not copies", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      // Assign endpoint should use symlinkSync, not copyFileSync
      expect(content).toMatch(/symlinkSync/)
      expect(content).not.toMatch(/copyFileSync/)
    })
  })

  describe("Invariant", () => {
    // "The agent's .claude/skills/ directory contains only symlinks to the workspace library — never source files." — skills.md
    test("syncSharedSkills skips non-symlink entries (never overwrites source files)", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      // When an entry exists and is NOT a symlink, it should be skipped
      expect(content).toMatch(/isSymbolicLink/)
      // The code says: "Not a symlink (agent's own skill), don't touch" then continues
      expect(content).toMatch(/Not a symlink/)
    })

    // "Activation is idempotent — activating an already-active skill is a no-op." — skills.md
    test("syncSharedSkills is idempotent (skips correct existing symlinks)", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      // Should check if symlink already points to correct target and skip
      expect(content).toMatch(/readlinkSync/)
      expect(content).toMatch(/Already correct/)
    })

    // "Activation is idempotent — activating an already-active skill is a no-op." — skills.md
    test("Console API assign is idempotent (skips existing symlinks)", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      // The assign endpoint checks if linkPath exists before creating
      expect(content).toMatch(/existsSync\(linkPath\)/)
    })

    // "Deactivating a skill that isn't active is a no-op." — skills.md
    test("Console API unassign handles missing symlinks gracefully", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      // The unassign endpoint checks existence and isSymbolicLink before unlinking
      expect(content).toMatch(/existsSync\(linkPath\)/)
      expect(content).toMatch(/isSymbolicLink\(\)/)
      expect(content).toMatch(/unlinkSync/)
    })

    // "Deleting a skill from the library removes the skill directory and all symlinks pointing to it across all agents." — skills.md
    test("syncSharedSkills cleans stale symlinks pointing to deleted skills", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      // Must detect symlinks pointing to non-existent targets and remove them
      expect(content).toMatch(/stale/i)
      expect(content).toMatch(/unlinkSync/)
    })

    // "Deleting a skill from the library removes the skill directory and all symlinks pointing to it across all agents." — skills.md
    test("Delete skill operation triggers syncSharedSkills to clean all agents", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      // After rmSync of skill dir, must call syncSharedSkills
      expect(content).toMatch(/rmSync/)
      expect(content).toMatch(/syncSharedSkills/)
    })

    // "Three operations maintain the symlink state. There is no background sync or startup reconciliation" — skills.md
    test("No startup reconciliation — syncSharedSkills not called on daemon start", () => {
      const content = readFileSync(join(ROOT, "src/daemon/index.ts"), "utf-8")
      expect(content).not.toMatch(/syncSharedSkills/)
    })

    // "Agents do not create, edit, or delete skills. Skills are a user-managed resource." — skills.md
    test("Thread runner does not import skills module", () => {
      const content = readFileSync(join(ROOT, "src/core/thread-runner.ts"), "utf-8")
      expect(content).not.toMatch(/from\s+["'].*skills/)
    })

    // "Skill names are unique within the workspace." — skills.md
    test("Console API rejects duplicate skill names on create", () => {
      const content = readFileSync(join(ROOT, "src/api/console-skills.ts"), "utf-8")
      // Should check if skill dir already exists and return 409
      expect(content).toMatch(/409/)
      expect(content).toMatch(/already exists/i)
    })

    // "OpenNova's role is strictly filesystem management" — skills.md
    // "1. Store skill content in the workspace library" — skills.md
    // "2. Create symlinks on activation, remove on deactivation" — skills.md
    // "3. Remove all symlinks when a skill is deleted" — skills.md
    test("Core skills module only uses filesystem operations (no HTTP, no DB)", () => {
      const content = readFileSync(join(ROOT, "src/core/skills.ts"), "utf-8")
      expect(content).not.toMatch(/fetch\(/)
      expect(content).not.toMatch(/database|sqlite|sql/i)
      expect(content).not.toMatch(/import.*http/i)
    })
  })
})
