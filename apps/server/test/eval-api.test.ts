import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"

import {
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox"
import Fastify from "fastify"

import { registerErrorHandling } from "../src/core/http/error-handler.js"
import type {
  EvalGenerationDraftView,
  EvalGenerationTaskView,
  PublishEvalRevisionResult,
} from "../src/modules/evals/eval-generation.domain.js"
import { evalGenerationRoutes } from "../src/modules/evals/eval-generation.routes.js"
import type { EvalGenerationService } from "../src/modules/evals/eval-generation.service.js"

function createTask(
  workspaceId: string,
  taskId = randomUUID(),
): EvalGenerationTaskView {
  const now = new Date().toISOString()
  const currentAttempt = {
    id: randomUUID(),
    attemptNumber: 1,
    status: "RUNNING" as const,
    error: null,
    usage: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
  }
  return {
    id: taskId,
    suiteId: randomUUID(),
    workspaceId,
    status: "RUNNING",
    target: {
      sourceKind: "SKILL_VERSION",
      snapshotId: randomUUID(),
      versionId: randomUUID(),
      draftRevisionId: null,
      skillName: "sample-skill",
      displayVersion: "V1",
    },
    maxEvalCount: 5,
    generationBrief: null,
    error: null,
    usage: null,
    draftId: null,
    draftStatus: null,
    evalCount: null,
    fileCount: null,
    revisionNumber: null,
    attemptCount: 1,
    currentAttempt,
    attempts: [currentAttempt],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
  } as EvalGenerationTaskView
}

test("Evals API enforces idempotency and hides runtime internals", async () => {
  const workspaceId = randomUUID()
  const task = createTask(workspaceId)
  let capturedInput: unknown
  let capturedListInput: unknown
  const fakeService = {
    start: async (input: unknown) => {
      capturedInput = input
      return task
    },
    list: async (requestedWorkspaceId: string, page: number, pageSize: number) => {
      capturedListInput = { requestedWorkspaceId, page, pageSize }
      return {
        items: [task],
        pagination: { page, pageSize, total: 1, pageCount: 1 },
        summary: {
          total: 1,
          running: 1,
          awaitingReview: 0,
          published: 0,
          failed: 0,
        },
      }
    },
    listRevisions: async () => [],
  } as unknown as EvalGenerationService
  const application = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("evalGenerationService", fakeService)
  registerErrorHandling(application)
  await application.register(evalGenerationRoutes)

  try {
    const missingKey = await application.inject({
      method: "POST",
      url: `/api/skill-workspaces/${workspaceId}/eval-generations`,
      payload: {
        target: { kind: "version", versionId: randomUUID() },
        maxEvalCount: 5,
      },
    })
    assert.equal(missingKey.statusCode, 400)

    const response = await application.inject({
      method: "POST",
      url: `/api/skill-workspaces/${workspaceId}/eval-generations`,
      headers: { "idempotency-key": "eval-request-1" },
      payload: {
        target: { kind: "version", versionId: task.target.versionId },
        maxEvalCount: 5,
      },
    })
    assert.equal(response.statusCode, 202)
    assert.deepEqual(capturedInput, {
      workspaceId,
      target: { kind: "version", versionId: task.target.versionId },
      maxEvalCount: 5,
      idempotencyKey: "eval-request-1",
    })
    const body = response.json<Record<string, unknown>>()
    assert.equal(body.id, task.id)
    assert.equal("agentSessionId" in body, false)
    assert.equal("configurationFingerprint" in body, false)
    assert.equal(JSON.stringify(body).includes("\\workspace"), false)

    const listResponse = await application.inject({
      method: "GET",
      url: `/api/skill-workspaces/${workspaceId}/eval-generations?page=2&pageSize=50`,
    })
    assert.equal(listResponse.statusCode, 200)
    assert.deepEqual(capturedListInput, {
      requestedWorkspaceId: workspaceId,
      page: 2,
      pageSize: 50,
    })
    assert.equal(
      listResponse.json<{ pagination: { total: number } }>().pagination.total,
      1,
    )
  } finally {
    await application.close()
  }
})

test("Evals draft and publish routes preserve review state and replay status", async () => {
  const workspaceId = randomUUID()
  const task = createTask(workspaceId)
  const now = new Date().toISOString()
  const draft: EvalGenerationDraftView = {
    id: randomUUID(),
    taskId: task.id,
    status: "READY",
    sourceSchemaVariant: "assertions",
    rawEvalsSha256: "a".repeat(64),
    manifestHash: "b".repeat(64),
    evalCount: 1,
    fileCount: 0,
    totalBytes: 128,
    cases: [
      {
        externalId: 1,
        name: "sample",
        prompt: "生成摘要",
        expectedOutput: "摘要",
        assertions: ["输出包含摘要正文"],
        files: [],
      },
    ],
    files: [],
    createdAt: now,
    updatedAt: now,
  }
  const publishResult: PublishEvalRevisionResult = {
    replayed: false,
    revision: {
      id: randomUUID(),
      suiteId: task.suiteId,
      sequenceNumber: 1,
      skillName: "sample-skill",
      sourceGenerationTaskId: task.id,
      sourceSnapshotId: task.target.snapshotId,
      manifestHash: "c".repeat(64),
      rawEvalsSha256: draft.rawEvalsSha256,
      evalCount: 1,
      fileCount: 0,
      totalBytes: 128,
      createdAt: now,
    },
  }
  const fakeService = {
    getDraft: async () => draft,
    discardDraft: async () => ({ ...draft, status: "DISCARDED" }),
    publish: async () => publishResult,
  } as unknown as EvalGenerationService
  const application = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("evalGenerationService", fakeService)
  registerErrorHandling(application)
  await application.register(evalGenerationRoutes)

  try {
    const draftResponse = await application.inject({
      method: "GET",
      url: `/api/eval-generations/${task.id}/draft`,
    })
    assert.equal(draftResponse.statusCode, 200)
    assert.equal(
      draftResponse.json<{ cases: unknown[] }>().cases.length,
      1,
    )
    assert.equal(
      draftResponse.headers["cache-control"],
      "private, no-store",
    )

    const publishResponse = await application.inject({
      method: "POST",
      url: `/api/eval-generations/${task.id}/publish`,
    })
    assert.equal(publishResponse.statusCode, 201)
    assert.equal(
      publishResponse.json<{ replayed: boolean }>().replayed,
      false,
    )
  } finally {
    await application.close()
  }
})

test("Evals retry route restarts the same failed generation task", async () => {
  const failedTask = {
    ...createTask(randomUUID()),
    status: "FAILED" as const,
  }
  const retriedTask = {
    ...createTask(failedTask.workspaceId, failedTask.id),
    attemptCount: 2,
    currentAttempt: {
      id: randomUUID(),
      attemptNumber: 2,
      status: "PREPARING" as const,
      error: null,
      usage: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    },
  } as EvalGenerationTaskView
  let retriedTaskId: string | null = null
  const fakeService = {
    retry: async (taskId: string, idempotencyKey: string) => {
      retriedTaskId = taskId
      assert.equal(idempotencyKey, "retry-request-1")
      return retriedTask
    },
  } as unknown as EvalGenerationService
  const application = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("evalGenerationService", fakeService)
  registerErrorHandling(application)
  await application.register(evalGenerationRoutes)

  try {
    const response = await application.inject({
      method: "POST",
      url: `/api/eval-generations/${failedTask.id}/retry`,
      headers: { "idempotency-key": "retry-request-1" },
    })
    assert.equal(response.statusCode, 202)
    assert.equal(retriedTaskId, failedTask.id)
    assert.equal(response.json<{ id: string }>().id, failedTask.id)
  } finally {
    await application.close()
  }
})

test("Evals SSE rejects unsafe Last-Event-ID values before opening a stream", async () => {
  const task = createTask(randomUUID())
  const fakeService = {
    get: async () => task,
  } as unknown as EvalGenerationService
  const application = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>()
  application.decorate("evalGenerationService", fakeService)
  registerErrorHandling(application)
  await application.register(evalGenerationRoutes)

  try {
    const response = await application.inject({
      method: "GET",
      url: `/api/eval-generations/${task.id}/events`,
      headers: { "last-event-id": "99999999999999999" },
    })
    assert.equal(response.statusCode, 400)
  } finally {
    await application.close()
  }
})
