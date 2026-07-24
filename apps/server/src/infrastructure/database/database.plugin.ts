import type { FastifyPluginAsync } from "fastify"
import fastifyPlugin from "fastify-plugin"

import {
  closeDatabaseClient,
  createDatabaseClient,
} from "./client.js"

const databasePluginImplementation: FastifyPluginAsync = async (
  application,
) => {
  const databaseClient = createDatabaseClient(
    application.appConfig.databaseUrl,
  )

  application.decorate("databaseClient", databaseClient)
  application.addHook("onClose", async () => {
    await closeDatabaseClient(databaseClient)
  })
}

export const databasePlugin = fastifyPlugin(databasePluginImplementation, {
  dependencies: ["application-config"],
  name: "database",
})
