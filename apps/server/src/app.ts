import fastifyStatic from "@fastify/static"
import Fastify, { type FastifyInstance } from "fastify"
import { Pool } from "pg"

export interface BuildApplicationOptions {
  databaseUrl: string
  logger: boolean
  staticRoot: string | undefined
}

interface HealthResponse {
  service: "skillconsole-server"
  status: "ready" | "unavailable"
  database: "connected" | "unavailable"
}

export async function buildApplication({
  databaseUrl,
  logger,
  staticRoot,
}: BuildApplicationOptions): Promise<FastifyInstance> {
  const application = Fastify({ logger })
  const database = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  })

  application.addHook("onClose", async () => {
    await database.end()
  })

  async function checkHealth(): Promise<HealthResponse> {
    try {
      await database.query("select 1 as connected")

      return {
        service: "skillconsole-server",
        status: "ready",
        database: "connected",
      }
    } catch (error) {
      application.log.error({ err: error }, "PostgreSQL health check failed")

      return {
        service: "skillconsole-server",
        status: "unavailable",
        database: "unavailable",
      }
    }
  }

  application.get("/api/health", async (_request, reply) => {
    const health = await checkHealth()
    return reply.code(health.status === "ready" ? 200 : 503).send(health)
  })

  application.get("/health", async (_request, reply) => {
    const health = await checkHealth()
    return reply.code(health.status === "ready" ? 200 : 503).send(health)
  })

  if (staticRoot) {
    await application.register(fastifyStatic, {
      root: staticRoot,
    })

    application.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({
          error: "Not Found",
          message: "The requested API route does not exist.",
          statusCode: 404,
        })
      }

      return reply.sendFile("index.html")
    })
  }

  return application
}
