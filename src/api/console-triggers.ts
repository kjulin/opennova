import { Hono } from "hono"
import { loadAgents } from "#core/agents.js"
import { CronExpressionParser } from "cron-parser"
import crypto from "crypto"
import fs from "fs"
import path from "path"

function loadTriggers(workspaceDir: string, agentId: string): unknown[] {
  const p = path.join(workspaceDir, "agents", agentId, "triggers.json")
  if (!fs.existsSync(p)) return []
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"))
  } catch {
    return []
  }
}

function saveTriggers(workspaceDir: string, agentId: string, triggers: unknown[]): void {
  fs.writeFileSync(
    path.join(workspaceDir, "agents", agentId, "triggers.json"),
    JSON.stringify(triggers, null, 2) + "\n",
  )
}

export function createConsoleTriggersRouter(workspaceDir: string): Hono {
  const app = new Hono()

  // List all triggers (cross-agent)
  app.get("/", (c) => {
    const agentsMap = loadAgents()
    const allTriggers: unknown[] = []

    for (const [agentId, agent] of agentsMap) {
      const triggers = loadTriggers(workspaceDir, agentId)
      for (const trigger of triggers) {
        if (trigger && typeof trigger === "object") {
          allTriggers.push({ ...(trigger as Record<string, unknown>), agentId, agentName: agent.name })
        }
      }
    }

    return c.json({ triggers: allTriggers })
  })

  // List triggers for one agent
  app.get("/agent/:agentId", (c) => {
    const agentId = c.req.param("agentId")
    const agentsMap = loadAgents()
    const agent = agentsMap.get(agentId)
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404)
    }

    const triggers = loadTriggers(workspaceDir, agentId).map((t) => {
      if (t && typeof t === "object") {
        return { ...(t as Record<string, unknown>), agentId, agentName: agent.name }
      }
      return t
    })

    return c.json({ triggers })
  })

  // Create trigger for an agent
  app.post("/agent/:agentId", async (c) => {
    const agentId = c.req.param("agentId")
    const agentsMap = loadAgents()
    const agent = agentsMap.get(agentId)
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404)
    }
    const body = await c.req.json()
    const { cron, tz, prompt, enabled } = body

    if (!cron || typeof cron !== "string") {
      return c.json({ error: "cron is required" }, 400)
    }
    try {
      CronExpressionParser.parse(cron)
    } catch {
      return c.json({ error: "Invalid cron expression" }, 400)
    }
    if (!prompt || typeof prompt !== "string") {
      return c.json({ error: "prompt is required" }, 400)
    }

    const trigger: Record<string, unknown> = {
      id: crypto.randomBytes(6).toString("hex"),
      cron,
      prompt,
      enabled: enabled !== undefined ? enabled : true,
      lastRun: new Date().toISOString(),
    }
    if (tz) trigger.tz = tz

    const triggers = loadTriggers(workspaceDir, agentId)
    triggers.push(trigger)
    saveTriggers(workspaceDir, agentId, triggers)

    return c.json(trigger, 201)
  })

  // Update trigger by triggerId
  app.patch("/:triggerId", async (c) => {
    const triggerId = c.req.param("triggerId")
    const agentsMap = loadAgents()
    const body = await c.req.json()

    for (const [agentId, agent] of agentsMap) {
      const triggers = loadTriggers(workspaceDir, agentId)
      const idx = triggers.findIndex(
        (t) => t && typeof t === "object" && (t as Record<string, unknown>).id === triggerId,
      )
      if (idx === -1) continue

      const existing = triggers[idx] as Record<string, unknown>

      if (body.cron !== undefined) {
        try {
          CronExpressionParser.parse(body.cron)
        } catch {
          return c.json({ error: "Invalid cron expression" }, 400)
        }
        existing.cron = body.cron
      }
      if (body.tz !== undefined) existing.tz = body.tz
      if (body.prompt !== undefined) existing.prompt = body.prompt
      if (body.enabled !== undefined) existing.enabled = body.enabled

      triggers[idx] = existing
      saveTriggers(workspaceDir, agentId, triggers)

      return c.json({ ...existing, agentId, agentName: agent.name })
    }

    return c.json({ error: "Trigger not found" }, 404)
  })

  // Delete trigger by triggerId
  app.delete("/:triggerId", (c) => {
    const triggerId = c.req.param("triggerId")
    const agentsMap = loadAgents()

    for (const [agentId] of agentsMap) {
      const triggers = loadTriggers(workspaceDir, agentId)
      const idx = triggers.findIndex(
        (t) => t && typeof t === "object" && (t as Record<string, unknown>).id === triggerId,
      )
      if (idx === -1) continue

      triggers.splice(idx, 1)
      saveTriggers(workspaceDir, agentId, triggers)

      return c.json({ ok: true })
    }

    return c.json({ error: "Trigger not found" }, 404)
  })

  return app
}
