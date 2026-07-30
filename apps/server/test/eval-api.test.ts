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
    },
    maxEvalCount: 5,
    generationBrief: null,
    error: null,
    usage: null,
    draftId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
  }
}

test("Evals API enforces idempotency and hides runtime internals", async () => {
  const workspaceId = randomUUID()
  const task = createTask(workspaceId)
  let capturedInput: unknown
  const fakeService = {
    start: async (input: unknown) => {
      capturedInput = input
      return task
    },
    list: async () => [task],
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
