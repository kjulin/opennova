import { Hono } from "hono"
import { z } from "zod/v4"
import { agentStore } from "#core/agents/index.js"
import { triggerStore } from "#core/triggers/index.js"
import { KNOWN_CAPABILITIES } from "#core/capabilities.js"
import {
  AgentJsonSchema,
  VALID_AGENT_ID,
  TrustLevel,
  type AgentJsonInput,
} from "#core/schemas.js"

function loadAgentDetail(id: string, agent: { name: string; description?: string | undefined; identity?: string | undefined; instructions?: string | undefined; responsibilities?: { title: string; content: string }[] | undefined; trust?: string | undefined; capabilities?: string[] | undefined; directories?: string[] | undefined; model?: string | undefined }) {
  const triggers = triggerStore.list(id)

  // Load skills from agent.json (source of truth)
  const agentJson = agentStore.get(id)
  const skills: string[] = agentJson?.skills ?? []

  return {
    id,
    name: agent.name,
    description: agent.description,
    identity: agent.identity,
    instructions: agent.instructions,
    responsibilities: agent.responsibilities,
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
    const agentsMap = agentStore.list()
    const agents = Array.from(agentsMap.values()).map((agent) =>
      loadAgentDetail(agent.id, {
        ...agent,
        trust: agent.trust,
      }),
    )
    return c.json({ agents })
  })

  // Get single agent
  app.get("/:id", (c) => {
    const id = c.req.param("id")
    const agentsMap = agentStore.list()
    const agent = agentsMap.get(id)
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404)
    }
    return c.json(loadAgentDetail(agent.id, {
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

    const agentJson: AgentJsonInput = { name: agentData.name, identity: agentData.identity, trust: agentData.trust, model: "sonnet" }
    if (agentData.description) agentJson.description = agentData.description
    if (agentData.instructions) agentJson.instructions = agentData.instructions
    if (agentData.directories && agentData.directories.length > 0) agentJson.directories = agentData.directories
    if (agentData.capabilities && agentData.capabilities.length > 0) agentJson.capabilities = agentData.capabilities

    try {
      agentStore.create(id, agentJson)
    } catch {
      return c.json({ error: "Agent already exists" }, 409)
    }

    const created = agentStore.get(id)
    if (!created) {
      return c.json({ error: "Failed to create agent" }, 500)
    }
    return c.json(loadAgentDetail(id, {
      ...created,
      trust: created.trust,
    }), 201)
  })

  // Update agent
  app.patch("/:id", async (c) => {
    const id = c.req.param("id")

    if (!agentStore.get(id)) {
      return c.json({ error: "Agent not found" }, 404)
    }

    const body = await c.req.json()
    const allowedFields = ["name", "description", "identity", "instructions", "responsibilities", "directories", "trust", "capabilities", "model"] as const

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

    const partial: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) {
        partial[field] = body[field]
      }
    }

    agentStore.update(id, partial as Partial<AgentJsonInput>)

    const updated = agentStore.get(id)
    if (!updated) {
      return c.json({ error: "Agent not found" }, 404)
    }
    return c.json(loadAgentDetail(id, {
      ...updated,
      trust: updated.trust,
    }))
  })

  // Delete agent
  app.delete("/:id", (c) => {
    const id = c.req.param("id")

    if (!agentStore.get(id)) {
      return c.json({ error: "Agent not found" }, 404)
    }

    agentStore.delete(id)
    return c.json({ ok: true })
  })

  return app
}
