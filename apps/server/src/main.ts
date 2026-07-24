import { buildApplication } from "./app.js"
import { parseApplicationConfig } from "./config/index.js"

const config = parseApplicationConfig(process.env)
const application = await buildApplication({ config })
let isShuttingDown = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return

  isShuttingDown = true
  application.log.info({ signal }, "SkillConsole server is shutting down")

  try {
    await application.close()
  } catch (error) {
    application.log.error({ err: error }, "Failed to close SkillConsole server")
    process.exitCode = 1
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT")
})
process.once("SIGTERM", () => {
  void shutdown("SIGTERM")
})

try {
  const address = await application.listen({
    host: config.host,
    port: config.port,
  })

  application.log.info({ address }, "SkillConsole server is ready")
} catch (error) {
  application.log.error({ err: error }, "SkillConsole server failed to start")

  try {
    await application.close()
  } catch (closeError) {
    application.log.error(
      { err: closeError },
      "Failed to close SkillConsole server after startup error",
    )
  }

  process.exitCode = 1
}
