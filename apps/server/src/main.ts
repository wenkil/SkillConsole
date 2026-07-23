import { buildApplication } from "./app.js"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.")
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10)
const host = process.env.HOST ?? "0.0.0.0"

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.")
}

const application = await buildApplication({
  databaseUrl,
  logger: true,
  staticRoot: process.env.STATIC_ROOT,
})

try {
  const address = await application.listen({ host, port })
  application.log.info({ address }, "SkillConsole server is ready")
} catch (error) {
  application.log.error(error)
  process.exitCode = 1
}
