import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import {
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox"
import Fastify from "fastify"

import { registerErrorHandling } from "../src/core/http/error-handler.js"
import type { TestRunDetailView } from "../src/modules/test-runs/test-run.domain.js"
import { testRunRoutes } from "../src/modules/test-runs/test-run.routes.js"
import type { TestRunService } from "../src/modules/test-runs/test-run.service.js"

function createRun(
  workspaceId: string,
  runId = randomUUID(),
): TestRunDetailView {
  const now = new Date().toISOString()
  const hash = "a".repeat(64)
  return {
    id: runId,
    workspaceId,
    mode: "target_vs_no_skill",
    status: "PREPARING",
    target: {
      draftId: randomUUID(),
      draftRevisionId: randomUUID(),
      draftContentRevision: 3,
      skillVersionId: null,
      skillVersionName: null,
      skillVersionNumber: null,
      skillSnapshotId: randomUUID(),
      evalRevisionId: randomUUID(),
      evalRevisionNumber: 2,
      evalCount: 1,
    },
    traceability: {
      protocolVersion: "skill-test-run-v1",
      sdkVersion: "0.3.220",
      skillCreatorCommit: "b".repeat(40),
      skillCreatorTreeHash: hash,
      configurationFingerprint: hash,
      environmentFingerprint: hash,
      skillManifestHash: hash,
      evalManifestHash: hash,
      comparabilityFingerprint: hash,
      runInputFingerprint: hash,
    },
    progress: { totalCases: 2, completedCases: 0 },
    benchmark: null,
    error: null,
    cases: [],
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  }
}

test("test run API requires the current draft revision and hides runtime internals", async () => {
  const workspaceId = randomUUID()
  const run = createRun(workspaceId)
  let capturedStart: unknown
  let capturedList: unknown
  const fakeService = {
    start: async (input: unknown) => {
      capturedStart = input
      return run
    },
    list: async (
      requestedWorkspaceId: string,
      page: number,
      pageSize: number,
    ) => {
      capturedList = { requestedWorkspaceId, page, pageSize }
      return {
        items: [run],
        pagination: { page, pageSize, total: 1, pageCount: 1 },
        summary: {
          total: 1,
          active: 1,
          completed: 0,
          interrupted: 0,
          failed: 0,
        },
      }
    },
  } as unknown as TestRunService
  const application = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("testRunService", fakeService)
  registerErrorHandling(application)
  await application.register(testRunRoutes)

  try {
    const payload = {
      draftId: run.target.draftId,
      draftContentRevision: run.target.draftContentRevision,
      evalRevisionId: run.target.evalRevisionId,
      mode: "target_vs_no_skill",
    }
    const missingKey = await application.inject({
      method: "POST",
      url: `/api/skill-workspaces/${workspaceId}/test-runs`,
      payload,
    })
    assert.equal(missingKey.statusCode, 400)

    const response = await application.inject({
      method: "POST",
      url: `/api/skill-workspaces/${workspaceId}/test-runs`,
      headers: { "idempotency-key": "run-request-1" },
      payload,
    })
    assert.equal(response.statusCode, 202)
    assert.deepEqual(capturedStart, {
      workspaceId,
      ...payload,
      idempotencyKey: "run-request-1",
    })
    const body = response.json<Record<string, unknown>>()
    assert.equal(body.id, run.id)
    assert.equal(
      (
        body.traceability as {
          comparabilityFingerprint: string
        }
      ).comparabilityFingerprint,
      run.traceability.comparabilityFingerprint,
    )
    assert.equal("agentSessionId" in body, false)
    assert.equal("workspaceLocator" in body, false)
    assert.equal(JSON.stringify(body).includes("\\test-runs\\"), false)

    const listResponse = await application.inject({
      method: "GET",
      url: `/api/skill-workspaces/${workspaceId}/test-runs?page=2&pageSize=50`,
    })
    assert.equal(listResponse.statusCode, 200)
    assert.deepEqual(capturedList, {
      requestedWorkspaceId: workspaceId,
      page: 2,
      pageSize: 50,
    })
  } finally {
    await application.close()
  }
})

test("test run SSE rejects unsafe Last-Event-ID values before opening a stream", async () => {
  const run = createRun(randomUUID())
  const fakeService = {
    get: async () => run,
  } as unknown as TestRunService
  const application = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("testRunService", fakeService)
  registerErrorHandling(application)
  await application.register(testRunRoutes)

  try {
    const response = await application.inject({
      method: "GET",
      url: `/api/test-runs/${run.id}/events`,
      headers: { "last-event-id": "99999999999999999" },
    })
    assert.equal(response.statusCode, 400)
  } finally {
    await application.close()
  }
})
