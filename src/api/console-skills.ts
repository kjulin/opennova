import { Hono } from "hono"
import { syncSharedSkills } from "#core/skills.js"
import fs from "fs"
import path from "path"

const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/

interface Frontmatter {
  name?: string
  description?: string
  arguments?: string
  [key: string]: unknown
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  if (!content.startsWith("---\n")) return { meta: {}, body: content }
  const end = content.indexOf("\n---\n", 4)
  if (end === -1) return { meta: {}, body: content }
  const yaml = content.slice(4, end)
  const body = content.slice(end + 5)
  const meta: Frontmatter = {}
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/)
    if (match) meta[match[1]!] = match[2]!
  }
  return { meta, body }
}

function buildFrontmatter(meta: Frontmatter, body: string): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) lines.push(`${key}: ${value}`)
  }
  if (lines.length === 0) return body
  return `---\n${lines.join("\n")}\n---\n${body}`
}

function getAssignedAgents(workspaceDir: string, skillName: string): string[] {
  const agentsDir = path.join(workspaceDir, "agents")
  const sharedSkillDir = path.join(workspaceDir, "skills", skillName)
  if (!fs.existsSync(agentsDir)) return []
  const assigned: string[] = []
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const linkPath = path.join(agentsDir, entry.name, ".claude", "skills", skillName)
    if (fs.existsSync(linkPath)) {
      try {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink()) {
          assigned.push(entry.name)
        }
      } catch {}
    }
  }
  return assigned
}

function loadSkillDetail(workspaceDir: string, name: string) {
  const skillPath = path.join(workspaceDir, "skills", name, "SKILL.md")
  if (!fs.existsSync(skillPath)) return null
  const raw = fs.readFileSync(skillPath, "utf-8")
  const { meta, body } = parseFrontmatter(raw)
  return {
    name,
    description: meta.description ?? "",
    arguments: meta.arguments ?? "",
    content: body,
    assignedTo: getAssignedAgents(workspaceDir, name),
    hasContent: body.trim().length > 0,
  }
}

export function createConsoleSkillsRouter(workspaceDir: string): Hono {
  const app = new Hono()

  // List all shared skills
  app.get("/", (c) => {
    const skillsDir = path.join(workspaceDir, "skills")
    if (!fs.existsSync(skillsDir)) {
      return c.json({ skills: [] })
    }

    const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const detail = loadSkillDetail(workspaceDir, d.name)
        if (!detail) return null
        return {
          name: detail.name,
          description: detail.description,
          assignedTo: detail.assignedTo,
          hasContent: detail.hasContent,
        }
      })
      .filter((s) => s !== null)

    return c.json({ skills })
  })

  // Get skill detail
  app.get("/:name", (c) => {
    const name = c.req.param("name")
    const detail = loadSkillDetail(workspaceDir, name)
    if (!detail) {
      return c.json({ error: "Skill not found" }, 404)
    }
    return c.json(detail)
  })

  // Create skill
  app.post("/", async (c) => {
    const body = await c.req.json()
    const { name, description, content } = body

    if (!name || typeof name !== "string") {
      return c.json({ error: "name is required" }, 400)
    }
    if (!VALID_SKILL_NAME.test(name)) {
      return c.json({ error: "Invalid skill name. Use lowercase letters, numbers, and hyphens." }, 400)
    }
    if (!content || typeof content !== "string") {
      return c.json({ error: "content is required" }, 400)
    }

    const skillDir = path.join(workspaceDir, "skills", name)
    if (fs.existsSync(skillDir)) {
      return c.json({ error: "Skill already exists" }, 409)
    }

    fs.mkdirSync(skillDir, { recursive: true })

    const meta: Frontmatter = { name }
    if (description) meta.description = description
    if (body.arguments) meta.arguments = body.arguments
    const fileContent = buildFrontmatter(meta, content)
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), fileContent)

    const detail = loadSkillDetail(workspaceDir, name)
    return c.json(detail, 201)
  })

  // Update skill
  app.put("/:name", async (c) => {
    const name = c.req.param("name")
    const skillDir = path.join(workspaceDir, "skills", name)
    if (!fs.existsSync(skillDir)) {
      return c.json({ error: "Skill not found" }, 404)
    }

    const body = await c.req.json()
    const skillPath = path.join(skillDir, "SKILL.md")

    let existingMeta: Frontmatter = {}
    let existingBody = ""
    if (fs.existsSync(skillPath)) {
      const raw = fs.readFileSync(skillPath, "utf-8")
      const parsed = parseFrontmatter(raw)
      existingMeta = parsed.meta
      existingBody = parsed.body
    }

    if (body.description !== undefined) existingMeta.description = body.description
    if (body.arguments !== undefined) existingMeta.arguments = body.arguments
    if (!existingMeta.name) existingMeta.name = name
    const newBody = body.content !== undefined ? body.content : existingBody
    const fileContent = buildFrontmatter(existingMeta, newBody)
    fs.writeFileSync(skillPath, fileContent)

    const detail = loadSkillDetail(workspaceDir, name)
    return c.json(detail)
  })

  // Delete skill
  app.delete("/:name", (c) => {
    const name = c.req.param("name")
    const skillDir = path.join(workspaceDir, "skills", name)
    if (!fs.existsSync(skillDir)) {
      return c.json({ error: "Skill not found" }, 404)
    }

    fs.rmSync(skillDir, { recursive: true })
    syncSharedSkills(workspaceDir)
    return c.json({ ok: true })
  })

  // Assign skill to agents
  app.post("/:name/assign", async (c) => {
    const name = c.req.param("name")
    const skillDir = path.join(workspaceDir, "skills", name)
    if (!fs.existsSync(skillDir)) {
      return c.json({ error: "Skill not found" }, 404)
    }

    const body = await c.req.json()
    const agents = body.agents
    if (!Array.isArray(agents)) {
      return c.json({ error: "agents must be an array" }, 400)
    }

    for (const agentId of agents) {
      if (typeof agentId !== "string") continue
      const agentSkillsDir = path.join(workspaceDir, "agents", agentId, ".claude", "skills")
      fs.mkdirSync(agentSkillsDir, { recursive: true })
      const linkPath = path.join(agentSkillsDir, name)
      if (!fs.existsSync(linkPath)) {
        fs.symlinkSync(skillDir, linkPath)
      }
    }

    return c.json({ assignedTo: getAssignedAgents(workspaceDir, name) })
  })

  // Unassign skill from agents
  app.post("/:name/unassign", async (c) => {
    const name = c.req.param("name")
    const skillDir = path.join(workspaceDir, "skills", name)
    if (!fs.existsSync(skillDir)) {
      return c.json({ error: "Skill not found" }, 404)
    }

    const body = await c.req.json()
    const agents = body.agents
    if (!Array.isArray(agents)) {
      return c.json({ error: "agents must be an array" }, 400)
    }

    for (const agentId of agents) {
      if (typeof agentId !== "string") continue
      const linkPath = path.join(workspaceDir, "agents", agentId, ".claude", "skills", name)
      if (fs.existsSync(linkPath)) {
        try {
          const stat = fs.lstatSync(linkPath)
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(linkPath)
          }
        } catch {}
      }
    }

    return c.json({ assignedTo: getAssignedAgents(workspaceDir, name) })
  })

  return app
}
