import { Hono } from "hono"
import { z } from "zod/v4"
import { loadAgents, readAgentJson, writeAgentJson, agentDir } from "#core/agents/index.js"
import { KNOWN_CAPABILITIES } from "#core/capabilities.js"
import {
  AgentJsonSchema,
  VALID_AGENT_ID,
  TrustLevel,
  type AgentJson,
} from "#core/schemas.js"
import fs from "fs"
import path from "path"

function loadAgentDetail(workspaceDir: string, id: string, agent: { name: string; description?: string | undefined; identity?: string | undefined; instructions?: string | undefined; trust?: string | undefined; capabilities?: string[] | undefined; directories?: string[] | undefined; model?: string | undefined }) {
  const dir = path.join(workspaceDir, "agents", id)

  // Load triggers
  let triggers: unknown[] = []
  const triggersPath = path.join(dir, "triggers.json")
  if (fs.existsSync(triggersPath)) {
    try {
      triggers = JSON.parse(fs.readFileSync(triggersPath, "utf-8"))
    } catch {}
  }

  // Load skills (directory names)
  let skills: string[] = []
  const skillsDir = path.join(dir, ".claude", "skills")
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

// Schema for POST — requires id, identity, trust
const CreateAgentSchema = AgentJsonSchema.extend({
  id: z.string().min(1, "id is required"),
  identity: z.string().min(1, "identity is required"),
  trust: TrustLevel,
})

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

    const parsed = CreateAgentSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, 400)
    }

    const { id, ...agentData } = parsed.data

    if (!VALID_AGENT_ID.test(id)) {
      return c.json({ error: "Invalid agent ID. Use lowercase letters, numbers, and hyphens." }, 400)
    }

    // Validate capabilities against runtime registry
    if (agentData.capabilities) {
      const unknown = agentData.capabilities.filter((cap: string) => !KNOWN_CAPABILITIES.includes(cap))
      if (unknown.length > 0) {
        return c.json({ error: `Unknown capabilities: ${unknown.join(", ")}. Valid: ${KNOWN_CAPABILITIES.join(", ")}` }, 400)
      }
    }

    const agentsMap = loadAgents()
    if (agentsMap.has(id)) {
      return c.json({ error: "Agent already exists" }, 409)
    }

    const agentJson: AgentJson = { name: agentData.name, identity: agentData.identity, trust: agentData.trust }
    if (agentData.description) agentJson.description = agentData.description
    if (agentData.instructions) agentJson.instructions = agentData.instructions
    if (agentData.directories && agentData.directories.length > 0) agentJson.directories = agentData.directories
    if (agentData.capabilities && agentData.capabilities.length > 0) agentJson.capabilities = agentData.capabilities

    writeAgentJson(id, agentJson)

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

    const existing = readAgentJson(id)
    if (!existing) {
      return c.json({ error: "Agent not found" }, 404)
    }

    const body = await c.req.json()
    const allowedFields = ["name", "description", "identity", "instructions", "directories", "trust", "capabilities", "model"] as const

    const parsed = AgentJsonSchema.partial().safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, 400)
    }

    // Validate capabilities against runtime registry
    if ("capabilities" in body && Array.isArray(body.capabilities)) {
      const unknown = body.capabilities.filter((cap: string) => !KNOWN_CAPABILITIES.includes(cap))
      if (unknown.length > 0) {
        return c.json({ error: `Unknown capabilities: ${unknown.join(", ")}. Valid: ${KNOWN_CAPABILITIES.join(", ")}` }, 400)
      }
    }

    const config: Record<string, unknown> = { ...existing }
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

    writeAgentJson(id, config as AgentJson)

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

    const dir = agentDir(id)
    if (!fs.existsSync(dir)) {
      return c.json({ error: "Agent not found" }, 404)
    }

    fs.rmSync(dir, { recursive: true })
    return c.json({ ok: true })
  })

  return app
}
