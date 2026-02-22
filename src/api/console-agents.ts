import { Hono } from "hono"
import { loadAgents } from "#core/agents.js"
import { PROTECTED_AGENTS } from "#core/agent-management.js"
import { KNOWN_CAPABILITIES } from "#core/capabilities.js"
import { syncSharedSkills } from "#core/skills.js"
import fs from "fs"
import path from "path"

const VALID_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/

function loadAgentDetail(workspaceDir: string, id: string, agent: { name: string; description?: string; identity?: string; instructions?: string; trust?: string; capabilities?: string[]; directories?: string[]; model?: string }) {
  const agentDir = path.join(workspaceDir, "agents", id)

  // Load triggers
  let triggers: unknown[] = []
  const triggersPath = path.join(agentDir, "triggers.json")
  if (fs.existsSync(triggersPath)) {
    try {
      triggers = JSON.parse(fs.readFileSync(triggersPath, "utf-8"))
    } catch {}
  }

  // Load skills (directory names)
  let skills: string[] = []
  const skillsDir = path.join(agentDir, ".claude", "skills")
  if (fs.existsSync(skillsDir)) {
    try {
      skills = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {}
  }

  return {
    id,
    name: agent.name,
    description: agent.description,
    identity: agent.identity,
    instructions: agent.instructions,
    trust: agent.trust,
    capabilities: agent.capabilities,
    directories: agent.directories,
    model: agent.model,
    skills,
    triggers,
  }
}

export function createConsoleAgentsRouter(workspaceDir: string): Hono {
  const app = new Hono()

  // List all agents
  app.get("/", (c) => {
    const agentsMap = loadAgents()
    const agents = Array.from(agentsMap.values()).map((agent) =>
      loadAgentDetail(workspaceDir, agent.id, {
        ...agent,
        trust: agent.trust,
      }),
    )
    return c.json({ agents })
  })

  // Get single agent
  app.get("/:id", (c) => {
    const id = c.req.param("id")
    const agentsMap = loadAgents()
    const agent = agentsMap.get(id)
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404)
    }
    return c.json(loadAgentDetail(workspaceDir, agent.id, {
      ...agent,
      trust: agent.trust,
    }))
  })

  // Create agent
  app.post("/", async (c) => {
    const body = await c.req.json()
    const { id, name, description, identity, instructions, directories, trust } = body

    if (!id || typeof id !== "string") {
      return c.json({ error: "id is required" }, 400)
    }
    if (!VALID_AGENT_ID.test(id)) {
      return c.json({ error: "Invalid agent ID. Use lowercase letters, numbers, and hyphens." }, 400)
    }
    if (!name || typeof name !== "string") {
      return c.json({ error: "name is required" }, 400)
    }
    if (!identity || typeof identity !== "string") {
      return c.json({ error: "identity is required" }, 400)
    }
    const validTrustLevels = ["sandbox", "controlled", "unrestricted"]
    if (!trust || !validTrustLevels.includes(trust)) {
      return c.json({ error: `trust is required. Must be one of: ${validTrustLevels.join(", ")}` }, 400)
    }
    if (PROTECTED_AGENTS.has(id)) {
      return c.json({ error: "Cannot modify system agent" }, 403)
    }

    // Validate capabilities
    if (body.capabilities) {
      if (!Array.isArray(body.capabilities) || !body.capabilities.every((c: unknown) => typeof c === "string")) {
        return c.json({ error: "capabilities must be an array of strings" }, 400)
      }
      const unknown = body.capabilities.filter((c: string) => !KNOWN_CAPABILITIES.includes(c))
      if (unknown.length > 0) {
        return c.json({ error: `Unknown capabilities: ${unknown.join(", ")}. Valid: ${KNOWN_CAPABILITIES.join(", ")}` }, 400)
      }
    }

    const agentsMap = loadAgents()
    if (agentsMap.has(id)) {
      return c.json({ error: "Agent already exists" }, 409)
    }

    const agentJson: Record<string, unknown> = { name, identity, trust }
    if (description) agentJson.description = description
    if (instructions) agentJson.instructions = instructions
    if (directories && Array.isArray(directories) && directories.length > 0) agentJson.directories = directories
    if (body.capabilities && Array.isArray(body.capabilities) && body.capabilities.length > 0) agentJson.capabilities = body.capabilities

    const agentDir = path.join(workspaceDir, "agents", id)
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(
      path.join(agentDir, "agent.json"),
      JSON.stringify(agentJson, null, 2) + "\n",
    )

    syncSharedSkills(workspaceDir, id)

    const created = loadAgents().get(id)
    if (!created) {
      return c.json({ error: "Failed to create agent" }, 500)
    }
    return c.json(loadAgentDetail(workspaceDir, id, {
      ...created,
      trust: created.trust,
    }), 201)
  })

  // Update agent
  app.patch("/:id", async (c) => {
    const id = c.req.param("id")

    if (PROTECTED_AGENTS.has(id)) {
      return c.json({ error: "Cannot modify system agent" }, 403)
    }

    const agentDir = path.join(workspaceDir, "agents", id)
    const configPath = path.join(agentDir, "agent.json")
    if (!fs.existsSync(configPath)) {
      return c.json({ error: "Agent not found" }, 404)
    }

    const body = await c.req.json()
    const allowedFields = ["name", "description", "identity", "instructions", "directories", "trust", "capabilities", "model"]

    // Validate trust
    if ("trust" in body) {
      const validTrust = ["sandbox", "controlled", "unrestricted"]
      if (!validTrust.includes(body.trust)) {
        return c.json({ error: `Invalid trust level. Must be one of: ${validTrust.join(", ")}` }, 400)
      }
    }

    // Validate model
    if ("model" in body) {
      const validModels = ["sonnet", "opus", "haiku"]
      if (body.model != null && !validModels.includes(body.model)) {
        return c.json({ error: `Invalid model. Must be one of: ${validModels.join(", ")}` }, 400)
      }
    }

    // Validate capabilities
    if ("capabilities" in body) {
      if (!Array.isArray(body.capabilities) || !body.capabilities.every((c: unknown) => typeof c === "string")) {
        return c.json({ error: "capabilities must be an array of strings" }, 400)
      }
      const unknown = body.capabilities.filter((c: string) => !KNOWN_CAPABILITIES.includes(c))
      if (unknown.length > 0) {
        return c.json({ error: `Unknown capabilities: ${unknown.join(", ")}. Valid: ${KNOWN_CAPABILITIES.join(", ")}` }, 400)
      }
    }

    let config: Record<string, unknown>
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch {
      return c.json({ error: "Failed to read agent config" }, 500)
    }

    for (const field of allowedFields) {
      if (field in body) {
        // Allow clearing model by setting to null/undefined
        if (field === "model" && body[field] == null) {
          delete config[field]
        } else {
          config[field] = body[field]
        }
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

    const updated = loadAgents().get(id)
    if (!updated) {
      return c.json({ error: "Agent not found" }, 404)
    }
    return c.json(loadAgentDetail(workspaceDir, id, {
      ...updated,
      trust: updated.trust,
    }))
  })

  // Delete agent
  app.delete("/:id", (c) => {
    const id = c.req.param("id")

    if (PROTECTED_AGENTS.has(id)) {
      return c.json({ error: "Cannot modify system agent" }, 403)
    }

    const agentDir = path.join(workspaceDir, "agents", id)
    if (!fs.existsSync(agentDir)) {
      return c.json({ error: "Agent not found" }, 404)
    }

    fs.rmSync(agentDir, { recursive: true })
    return c.json({ ok: true })
  })

  return app
}
