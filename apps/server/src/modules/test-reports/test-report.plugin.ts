import fastifyPlugin from "fastify-plugin"

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"

import { TestReportRepository } from "./test-report.repository.js"
import { testReportRoutes } from "./test-report.routes.js"
import { TestReportService } from "./test-report.service.js"
import { TestReportAnalysisService } from "./test-report-analysis.service.js"

const testReportModulePlugin: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const repository = new TestReportRepository(
    application.databaseClient.database,
  )
  const service = new TestReportService({
    repository,
    testRuns: application.testRunService,
    agentSessions: application.agentSessionService,
    logger: application.log,
  })
  const analysisService = new TestReportAnalysisService({
    repository,
    agentSessions: application.agentSessionService,
    dataRoot: application.appConfig.dataRoot,
    claudeSettingsPath: application.appConfig.claudeSettingsPath,
    logger: application.log,
  })
  await service.initialize()
  await analysisService.initialize()
  application.decorate("testReportService", service)
  application.decorate("testReportAnalysisService", analysisService)
  await application.register(testReportRoutes)
  application.addHook("onClose", async () => {
    await analysisService.shutdown()
    await service.shutdown()
  })
}

export const testReportPlugin = fastifyPlugin(testReportModulePlugin, {
  name: "test-reports",
  dependencies: ["agent-sessions", "test-runs"],
})
