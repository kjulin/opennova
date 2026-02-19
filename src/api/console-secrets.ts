import { Hono } from "hono"
import { listSecretNames, setSecret, deleteSecret, addSecretName, removeSecretName } from "#core/secrets.js"

export function createConsoleSecretsRouter(workspaceDir: string): Hono {
  const app = new Hono()

  // List secret names
  app.get("/", (c) => {
    const secrets = listSecretNames(workspaceDir)
    return c.json({ secrets })
  })

  // Create secret
  app.post("/", async (c) => {
    const body = await c.req.json()
    const { name, value } = body

    if (!name || typeof name !== "string") {
      return c.json({ error: "name is required" }, 400)
    }
    if (!value || typeof value !== "string") {
      return c.json({ error: "value is required" }, 400)
    }

    const existing = listSecretNames(workspaceDir)
    if (existing.includes(name)) {
      return c.json({ error: "Secret already exists" }, 409)
    }

    setSecret(name, value)
    addSecretName(workspaceDir, name)

    return c.json({ ok: true, name }, 201)
  })

  // Update secret value
  app.patch("/:name", async (c) => {
    const name = c.req.param("name")
    const body = await c.req.json()
    const { value } = body

    if (!value || typeof value !== "string") {
      return c.json({ error: "value is required" }, 400)
    }

    const existing = listSecretNames(workspaceDir)
    if (!existing.includes(name)) {
      return c.json({ error: "Secret not found" }, 404)
    }

    setSecret(name, value)
    return c.json({ ok: true })
  })

  // Delete secret
  app.delete("/:name", (c) => {
    const name = c.req.param("name")

    const existing = listSecretNames(workspaceDir)
    if (!existing.includes(name)) {
      return c.json({ error: "Secret not found" }, 404)
    }

    deleteSecret(name)
    removeSecretName(workspaceDir, name)
    return c.json({ ok: true })
  })

  return app
}
