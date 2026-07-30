import fastifyPlugin from "fastify-plugin"

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"

import { EvalTargetService } from "../skill-workspaces/eval-target.service.js"
import { LocalSnapshotStorage } from "../skill-workspaces/snapshot-storage.js"
import { EvalGenerationRepository } from "./eval-generation.repository.js"
import { evalGenerationRoutes } from "./eval-generation.routes.js"
import { EvalGenerationService } from "./eval-generation.service.js"
import { EvalStorage } from "./eval-storage.js"
import { EvalWorkspacePreparer } from "./eval-workspace.js"

const evalGenerationModulePlugin: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const database = application.databaseClient.database
  const snapshotStorage = new LocalSnapshotStorage(
    application.appConfig.dataRoot,
  )
  const evalStorage = new EvalStorage(application.appConfig.dataRoot)
  await Promise.all([
    snapshotStorage.initialize(),
    evalStorage.initialize(),
  ])
  const repository = new EvalGenerationRepository(database)
  const service = new EvalGenerationService(
    database,
    repository,
    new EvalTargetService(
      database,
      snapshotStorage,
      application.appConfig.uploadLimits,
    ),
    new EvalWorkspacePreparer(
      database,
      evalStorage,
      application.appConfig.dataRoot,
      application.appConfig.claudeSettingsPath,
    ),
    evalStorage,
    application.agentSessionService,
    application.log,
  )
  await service.initialize()
  application.decorate("evalGenerationService", service)
  await application.register(evalGenerationRoutes)
  application.addHook("onClose", async () => {
    await service.shutdown()
  })
}

export const evalGenerationPlugin = fastifyPlugin(
  evalGenerationModulePlugin,
  {
    name: "eval-generation",
    dependencies: ["agent-sessions"],
  },
)
