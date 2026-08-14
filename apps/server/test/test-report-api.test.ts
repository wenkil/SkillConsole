import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox"
import Fastify from "fastify"

import { registerErrorHandling } from "../src/core/http/error-handler.js"
import { testReportRoutes } from "../src/modules/test-reports/test-report.routes.js"
import type { TestReportService } from "../src/modules/test-reports/test-report.service.js"
import type { TestReportAnalysisService } from "../src/modules/test-reports/test-report-analysis.service.js"

function listItem() {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    runId: randomUUID(),
    reportType: "skill_effect" as const,
    status: "AVAILABLE" as const,
    runStatus: "COMPLETED" as const,
    comparabilityStatus: "COMPARABLE" as const,
    analysisStatus: "NOT_REQUESTED" as const,
    targetLabel: "Frozen working copy",
    baselineLabel: "No-Skill Baseline",
    evalRevisionId: randomUUID(),
    evalRevisionNumber: 1,
    evalCount: 2,
    issueCount: 0,
    negativeTransitionCount: 0,
    positiveTransitionCount: 1,
    primaryPassRate: 1,
    assessmentCoverageRate: 1,
    executionCostUsd: 0.02,
    gradingCostUsd: 0.01,
    totalCostUsd: 0.03,
    wallClockDurationMs: 5_000,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

test("test report API applies list defaults and exposes Run lookup", async () => {
  const item = listItem()
  let capturedList: unknown
  let capturedRunId: string | null = null
  const detail = {
    ...item,
    currentRevisionId: null,
    generationError: null,
    report: null,
  }
  const pendingDetail = {
    ...detail,
    status: "GENERATION_PENDING" as const,
  }
  const fakeService = {
    list: async (workspaceId: string, query: unknown) => {
      capturedList = { workspaceId, query }
      return {
        items: [item],
        pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
        summary: {
          total: 1,
          available: 1,
          partial: 0,
          generationFailed: 0,
          withNegativeTransitions: 0,
          executionCostUsd: 0.02,
          gradingCostUsd: 0.01,
        },
      }
    },
    getByRun: async (runId: string) => {
      capturedRunId = runId
      return detail
    },
    get: async () => pendingDetail,
    regenerate: async () => detail,
    getDocument: async (
      _reportId: string,
      _revisionId: string,
      locale: string,
      format: "html" | "markdown",
    ) => ({
      content:
        format === "html"
          ? `<!doctype html><html lang="${locale}"><body>Static report</body></html>`
          : `# Static report (${locale})\n`,
      filename: format === "html" ? "report.html" : "report.md",
    }),
  } as unknown as TestReportService
  const application = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("testReportService", fakeService)
  registerErrorHandling(application)
  await application.register(testReportRoutes)
  try {
    const list = await application.inject({
      method: "GET",
      url: `/api/skill-workspaces/${item.workspaceId}/test-reports`,
    })
    assert.equal(list.statusCode, 200)
    assert.deepEqual(capturedList, {
      workspaceId: item.workspaceId,
      query: { page: 1, pageSize: 20, sort: "completedAt", order: "desc" },
    })
    const byRun = await application.inject({
      method: "GET",
      url: `/api/test-runs/${item.runId}/report`,
    })
    assert.equal(byRun.statusCode, 200)
    assert.equal(capturedRunId, item.runId)
    assert.equal(byRun.json().report, null)
    const pending = await application.inject({
      method: "GET",
      url: `/api/test-reports/${item.id}`,
    })
    assert.equal(pending.statusCode, 200)
    assert.equal(pending.json().status, "GENERATION_PENDING")
    assert.equal(pending.json().report, null)
    const revisionId = randomUUID()
    const htmlDocument = await application.inject({
      method: "GET",
      url: `/api/test-reports/${item.id}/revisions/${revisionId}/document.html?locale=zh-CN`,
    })
    assert.equal(htmlDocument.statusCode, 200)
    assert.match(htmlDocument.headers["content-type"] ?? "", /^text\/html/)
    assert.match(htmlDocument.headers["content-security-policy"] ?? "", /default-src 'none'/)
    assert.match(htmlDocument.headers["content-disposition"] ?? "", /^inline;/)
    assert.match(htmlDocument.body, /lang="zh-CN"/)
    const markdownDocument = await application.inject({
      method: "GET",
      url: `/api/test-reports/${item.id}/revisions/${revisionId}/document.md?locale=en`,
    })
    assert.equal(markdownDocument.statusCode, 200)
    assert.match(markdownDocument.headers["content-type"] ?? "", /^text\/markdown/)
    assert.match(markdownDocument.headers["content-disposition"] ?? "", /^attachment;/)
    assert.match(markdownDocument.body, /^# Static report/)
    const jsonExport = await application.inject({
      method: "GET",
      url: `/api/test-reports/${item.id}/revisions/${revisionId}/document.json`,
    })
    assert.equal(jsonExport.statusCode, 404)
    const missingIdempotencyKey = await application.inject({
      method: "POST",
      url: `/api/test-reports/${item.id}/regenerate`,
    })
    assert.equal(missingIdempotencyKey.statusCode, 400)
  } finally {
    await application.close()
  }
})

test("test report Case API passes filters and stable Case identity", async () => {
  const reportId = randomUUID()
  const evalRevisionCaseId = randomUUID()
  let capturedQuery: unknown
  const reportCase = {
    evalRevisionCaseId,
    externalId: 2,
    name: "Case 2",
    pairComparability: "COMPARABLE" as const,
    classification: "REGRESSION",
    targetCaseId: null,
    baselineCaseId: null,
    targetOutcome: "FAILED" as const,
    baselineOutcome: "PASSED" as const,
    assertionTransitions: [],
    outputDiff: {
      rawEqual: null,
      normalizedEqual: null,
      targetSha256: null,
      baselineSha256: null,
      targetCharacters: null,
      baselineCharacters: null,
      characterDelta: null,
      targetLines: null,
      baselineLines: null,
      lineDelta: null,
    },
    artifactDiff: { added: [], removed: [], changed: [], unchanged: [] },
    usageDelta: {
      executionCostUsd: null,
      gradingCostUsd: null,
      activeDurationMs: null,
      inputTokens: null,
      outputTokens: null,
    },
    issueIds: [],
    evidenceRefs: [],
  }
  const fakeService = {
    listCases: async (_reportId: string, query: unknown) => {
      capturedQuery = query
      return {
        items: [reportCase],
        pagination: { page: 1, pageSize: 50, total: 1, pageCount: 1 },
      }
    },
    getCase: async () => ({
      summary: reportCase,
      targetCase: null,
      baselineCase: null,
    }),
  } as unknown as TestReportService
  const application = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("testReportService", fakeService)
  registerErrorHandling(application)
  await application.register(testReportRoutes)
  try {
    const page = await application.inject({
      method: "GET",
      url: `/api/test-reports/${reportId}/cases?classification=REGRESSION&side=TARGET&externalId=2`,
    })
    assert.equal(page.statusCode, 200)
    assert.deepEqual(capturedQuery, {
      classification: "REGRESSION",
      side: "TARGET",
      externalId: 2,
      page: 1,
      pageSize: 50,
    })
    const detail = await application.inject({
      method: "GET",
      url: `/api/test-reports/${reportId}/cases/${evalRevisionCaseId}`,
    })
    assert.equal(detail.statusCode, 200)
    assert.equal(
      detail.json().summary.evalRevisionCaseId,
      evalRevisionCaseId,
    )
  } finally {
    await application.close()
  }
})

test("Analyzer API preserves Revision identity and never exposes its Agent Session", async () => {
  const reportId = randomUUID()
  const reportRevisionId = randomUUID()
  const analysisId = randomUUID()
  const evalRevisionCaseId = randomUUID()
  const now = new Date().toISOString()
  let capturedCreate: unknown
  const analysis = {
    id: analysisId,
    reportId,
    reportRevisionId,
    revisionNumber: 1,
    status: "PENDING" as const,
    agentSessionId: randomUUID(),
    configuredModelId: "sdk_default",
    actualModelId: null,
    modelId: "sdk_default",
    configurationFingerprint: "b".repeat(64),
    semanticConfigurationFingerprint: "d".repeat(64),
    runtimePolicy: {
      schemaVersion: "test-report-analyzer-runtime-policy.v1",
      maxTurns: 1,
      maxBudgetUsd: 0.75,
      timeoutMs: 90_000,
      cancellationGraceMs: 5_000,
      maxPromptCharacters: 500_000,
      maxResponseCharacters: 200_000,
      sandboxPolicy: "report_analyzer_strict_v1",
      persistSession: false,
      strictMcpConfig: true,
      toolsEnabled: false,
      skillsEnabled: false,
      mcpEnabled: false,
    },
    runtimePolicyFingerprint: "c".repeat(64),
    promptVersion: "test-report-analyzer-prompt-v1",
    inputFingerprint: "a".repeat(64),
    selectedEvalRevisionCaseIds: [evalRevisionCaseId],
    analysis: null,
    usage: null,
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  }
  const analysisService = {
    create: async (
      requestedReportId: string,
      selected: readonly string[],
      idempotencyKey: string,
    ) => {
      capturedCreate = { requestedReportId, selected, idempotencyKey }
      return analysis
    },
    list: async () => [analysis],
    get: async () => analysis,
    getDocument: async (
      _analysisId: string,
      locale: string,
      format: "html" | "markdown",
    ) => ({
      content:
        format === "html"
          ? `<!doctype html><html lang="${locale}"><body>Analysis</body></html>`
          : "# Analysis\n",
      filename: format === "html" ? "analysis.html" : "analysis.md",
    }),
  } as unknown as TestReportAnalysisService
  const application = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("testReportService", {} as TestReportService)
  application.decorate("testReportAnalysisService", analysisService)
  registerErrorHandling(application)
  await application.register(testReportRoutes)
  try {
    const created = await application.inject({
      method: "POST",
      url: `/api/test-reports/${reportId}/analyses`,
      headers: {
        "content-type": "application/json",
        "idempotency-key": "analysis-request-1",
      },
      payload: { evalRevisionCaseIds: [evalRevisionCaseId] },
    })
    assert.equal(created.statusCode, 200)
    assert.equal(created.json().id, analysisId)
    assert.equal("agentSessionId" in created.json(), false)
    assert.equal("configurationFingerprint" in created.json(), false)
    assert.equal(
      created.json().semanticConfigurationFingerprint,
      "d".repeat(64),
    )
    assert.deepEqual(capturedCreate, {
      requestedReportId: reportId,
      selected: [evalRevisionCaseId],
      idempotencyKey: "analysis-request-1",
    })
    const listed = await application.inject({
      method: "GET",
      url: `/api/test-reports/${reportId}/analyses`,
    })
    assert.equal(listed.statusCode, 200)
    assert.equal("agentSessionId" in listed.json().items[0], false)
    assert.equal(
      "configurationFingerprint" in listed.json().items[0],
      false,
    )
    const html = await application.inject({
      method: "GET",
      url: `/api/test-report-analyses/${analysisId}/document.html?locale=zh-CN`,
    })
    assert.equal(html.statusCode, 200)
    assert.match(html.headers["content-security-policy"] ?? "", /default-src 'none'/)
    assert.match(html.body, /lang="zh-CN"/)
    const missingKey = await application.inject({
      method: "POST",
      url: `/api/test-reports/${reportId}/analyses`,
      headers: { "content-type": "application/json" },
      payload: { evalRevisionCaseIds: [evalRevisionCaseId] },
    })
    assert.equal(missingKey.statusCode, 400)
  } finally {
    await application.close()
  }
})
