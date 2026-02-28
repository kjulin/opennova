import { Hono } from "hono"
import { agentStore } from "#core/agents/index.js"
import { triggerStore } from "#core/triggers/index.js"

export function createConsoleTriggersRouter(): Hono {
  const app = new Hono()

  // List all triggers (cross-agent)
  app.get("/", (c) => {
    const agentsMap = agentStore.list()
    const triggers = triggerStore.list()
    const allTriggers = triggers.map((t) => {
      const agent = agentsMap.get(t.agentId)
      return { ...t, agentName: agent?.name }
    })
    return c.json({ triggers: allTriggers })
  })

  // List triggers for one agent
  app.get("/agent/:agentId", (c) => {
    const agentId = c.req.param("agentId")
    const agentsMap = agentStore.list()
    const agent = agentsMap.get(agentId)
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404)
    }

    const triggers = triggerStore.list(agentId).map((t) => ({
      ...t,
      agentName: agent.name,
    }))

    return c.json({ triggers })
  })

  // Create trigger for an agent
  app.post("/agent/:agentId", async (c) => {
    const agentId = c.req.param("agentId")
    const agentsMap = agentStore.list()
    const agent = agentsMap.get(agentId)
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404)
    }
    const body = await c.req.json()
    const { cron, tz, prompt } = body

    if (!cron || typeof cron !== "string") {
      return c.json({ error: "cron is required" }, 400)
    }
    if (!prompt || typeof prompt !== "string") {
      return c.json({ error: "prompt is required" }, 400)
    }

    try {
      const trigger = triggerStore.create(agentId, { cron, tz, prompt })
      return c.json(trigger, 201)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  // Update trigger by triggerId
  app.patch("/:triggerId", async (c) => {
    const triggerId = c.req.param("triggerId")
    const body = await c.req.json()

    try {
      const trigger = triggerStore.update(triggerId, {
        ...(body.cron !== undefined && { cron: body.cron }),
        ...(body.tz !== undefined && { tz: body.tz }),
        ...(body.prompt !== undefined && { prompt: body.prompt }),
      })
      const agentsMap = agentStore.list()
      const agent = agentsMap.get(trigger.agentId)
      return c.json({ ...trigger, agentName: agent?.name })
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes("not found")) return c.json({ error: msg }, 404)
      return c.json({ error: msg }, 400)
    }
  })

  // Delete trigger by triggerId
  app.delete("/:triggerId", (c) => {
    const triggerId = c.req.param("triggerId")

    // Check if trigger exists first to return 404
    const existing = triggerStore.get(triggerId)
    if (!existing) {
      return c.json({ error: "Trigger not found" }, 404)
    }

    triggerStore.delete(triggerId)
    return c.json({ ok: true })
  })

  return app
}
