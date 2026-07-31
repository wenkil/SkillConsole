import fastifyPlugin from "fastify-plugin"

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"

import { DraftRevisionService } from "../skill-workspaces/draft-revision.service.js"
import { LocalSnapshotStorage } from "../skill-workspaces/snapshot-storage.js"
import { TestRunRepository } from "./test-run.repository.js"
import { testRunRoutes } from "./test-run.routes.js"
import { TestRunScorer } from "./test-run-scorer.js"
import { TestRunService } from "./test-run.service.js"
import { TestRunStorage } from "./test-run-storage.js"

const testRunModulePlugin: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const storage = new TestRunStorage(
    application.appConfig.dataRoot,
    application.appConfig.uploadLimits,
  )
  const snapshotStorage = new LocalSnapshotStorage(
    application.appConfig.dataRoot,
  )
  await Promise.all([storage.initialize(), snapshotStorage.initialize()])
  const database = application.databaseClient.database
  const service = new TestRunService({
    claudeSettingsPath: application.appConfig.claudeSettingsPath,
    repository: new TestRunRepository(database),
    draftRevisions: new DraftRevisionService(
      database,
      snapshotStorage,
      application.appConfig.uploadLimits,
    ),
    storage,
    agentSessions: application.agentSessionService,
    scorer: new TestRunScorer(),
    logger: application.log,
  })
  await service.initialize()
  application.decorate("testRunService", service)
  await application.register(testRunRoutes)
  application.addHook("onClose", async () => {
    service.shutdown()
  })
}

export const testRunPlugin = fastifyPlugin(testRunModulePlugin, {
  name: "test-runs",
  dependencies: ["agent-sessions", "eval-generation"],
})
