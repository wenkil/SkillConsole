import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"
import { Type } from "typebox"

import { ErrorResponseSchema } from "../../core/http/error.contract.js"
import type {
  TestRunDetailView,
  TestRunEvent,
  TestRunView,
} from "./test-run.domain.js"
import {
  StartTestRunBodySchema,
  TestRunArtifactParamsSchema,
  TestRunDetailSchema,
  TestRunEventsHeaderSchema,
  TestRunEventsQuerySchema,
  TestRunLogPageSchema,
  TestRunLogsQuerySchema,
  TestRunListQuerySchema,
  TestRunPageSchema,
  TestRunParamsSchema,
  TestRunSchema,
  TestRunStartHeadersSchema,
  WorkspaceTestRunParamsSchema,
} from "./test-run.contract.js"

function writeSseEvent(
  response: NodeJS.WritableStream,
  event: TestRunEvent,
): void {
  response.write(`id: ${event.sequence}\n`)
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

type SseHeartbeat = ReturnType<typeof setInterval>

export function createTestRunSseCleanup(
  unsubscribe: () => void,
  clearHeartbeat: (heartbeat: SseHeartbeat) => void = clearInterval,
): {
  cleanup: () => void
  setHeartbeat: (heartbeat: SseHeartbeat) => void
} {
  let heartbeat: SseHeartbeat | undefined
  let cleanedUp = false

  return {
    cleanup: () => {
      if (cleanedUp) return
      cleanedUp = true
      if (heartbeat) clearHeartbeat(heartbeat)
      unsubscribe()
    },
    setHeartbeat: (nextHeartbeat) => {
      if (cleanedUp) {
        clearHeartbeat(nextHeartbeat)
        return
      }
      heartbeat = nextHeartbeat
    },
  }
}

function serializeRun(run: TestRunView) {
  return {
    ...run,
    target: { ...run.target },
    baseline: { ...run.baseline },
    environment:
      run.environment.status === "captured"
        ? {
            ...run.environment,
            executionLimits: { ...run.environment.executionLimits },
            gradingLimits: { ...run.environment.gradingLimits },
            runtimeCapabilities: run.environment.runtimeCapabilities.map(
              (capability) => ({
                ...capability,
                commands: capability.commands.map((command) => ({
                  ...command,
                })),
              }),
            ),
          }
        : { ...run.environment },
    traceability: { ...run.traceability },
    progress: { ...run.progress },
    benchmark: run.benchmark
      ? {
          target: { ...run.benchmark.target },
          baseline: { ...run.benchmark.baseline },
        }
      : null,
    error: run.error
      ? {
          ...run.error,
          details: run.error.details ? { ...run.error.details } : null,
        }
      : null,
  }
}

function serializeRunDetail(run: TestRunDetailView) {
  return {
    ...serializeRun(run),
    cases: run.cases.map((runCase) => ({
      ...runCase,
      assertions: [...runCase.assertions],
      files: [...runCase.files],
      usage: runCase.usage ? { ...runCase.usage } : null,
      gradingUsage: runCase.gradingUsage
        ? { ...runCase.gradingUsage }
        : null,
      bundledScriptUses: runCase.bundledScriptUses.map((item) => ({
        ...item,
        evidenceSequences: [...item.evidenceSequences],
      })),
      executionError: runCase.executionError
        ? { ...runCase.executionError }
        : null,
      assessmentError: runCase.assessmentError
        ? { ...runCase.assessmentError }
        : null,
      assertionResults: runCase.assertionResults.map((result) => ({
        ...result,
        evidence: result.evidence.map((evidence) => ({ ...evidence })),
      })),
      artifacts: runCase.artifacts.map((artifact) => ({ ...artifact })),
    })),
  }
}

export const testRunRoutes: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const service = application.testRunService

  application.get(
    "/api/skill-workspaces/:workspaceId/test-runs",
    {
      schema: {
        tags: ["test-runs"],
        summary: "List Skill test runs for a workbench",
        params: WorkspaceTestRunParamsSchema,
        querystring: TestRunListQuerySchema,
        response: {
          200: TestRunPageSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const page = await service.list(
        request.params.workspaceId,
        request.query.page ?? 1,
        request.query.pageSize ?? 20,
      )
      return reply
        .header("Cache-Control", "private, no-store")
        .send({
          ...page,
          items: page.items.map(serializeRun),
        })
    },
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/test-runs",
    {
      schema: {
        tags: ["test-runs"],
        summary:
          "Start a traceable Target versus No-Skill Baseline test run",
        params: WorkspaceTestRunParamsSchema,
        headers: TestRunStartHeadersSchema,
        body: StartTestRunBodySchema,
        response: {
          202: TestRunDetailSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply.code(202).send(
        serializeRunDetail(
          await service.start({
            workspaceId: request.params.workspaceId,
            ...request.body,
            idempotencyKey: request.headers["idempotency-key"],
          }),
        ),
      ),
  )

  application.get(
    "/api/test-runs/:runId",
    {
      schema: {
        tags: ["test-runs"],
        summary: "Read a Skill test run and its traceable case evidence",
        params: TestRunParamsSchema,
        response: {
          200: TestRunDetailSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializeRunDetail(
            await service.getDetail(request.params.runId),
          ),
        ),
  )

  application.post(
    "/api/test-runs/:runId/cancel",
    {
      schema: {
        tags: ["test-runs"],
        summary: "Cancel an active Skill test run",
        params: TestRunParamsSchema,
        response: {
          202: TestRunSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(serializeRun(await service.cancel(request.params.runId))),
  )

  application.get(
    "/api/test-runs/:runId/logs",
    {
      schema: {
        tags: ["test-runs"],
        summary: "Read paginated normalized Skill test run logs",
        params: TestRunParamsSchema,
        querystring: TestRunLogsQuerySchema,
        response: {
          200: TestRunLogPageSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          ((page) => ({
            ...page,
            items: page.items.map((event) => ({
              ...event,
              payload: { ...event.payload },
            })),
            pagination: { ...page.pagination },
          }))(
            await service.listLogs(request.params.runId, {
              ...request.query,
              limit: request.query.limit ?? 200,
            }),
          ),
        ),
  )

  application.get(
    "/api/test-runs/:runId/events",
    {
      schema: {
        tags: ["test-runs"],
        summary: "Replay and stream normalized Skill test run logs",
        params: TestRunParamsSchema,
        headers: TestRunEventsHeaderSchema,
        querystring: TestRunEventsQuerySchema,
        produces: ["text/event-stream"],
        response: {
          200: Type.String({ contentMediaType: "text/event-stream" }),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runId = request.params.runId
      const afterSequence = Math.max(
        request.query.afterSequence ?? 0,
        Number(request.headers["last-event-id"] ?? "0"),
      )
      await service.get(runId)

      let live = false
      const pending: TestRunEvent[] = []
      let lastSequence = afterSequence
      const unsubscribe = service.subscribe(runId, (event) => {
        if (!live) {
          pending.push(event)
          return
        }
        if (event.sequence <= lastSequence) return
        writeSseEvent(reply.raw, event)
        lastSequence = event.sequence
      })
      const lifecycle = createTestRunSseCleanup(unsubscribe)
      let clientClosed = false
      const closeConnection = () => {
        clientClosed = true
        lifecycle.cleanup()
      }
      reply.raw.once("close", closeConnection)

      if (reply.raw.destroyed) {
        closeConnection()
        return
      }

      try {
        const backlog = await service.listEvents(runId, afterSequence)
        if (clientClosed || reply.raw.destroyed) {
          lifecycle.cleanup()
          return
        }
        reply.hijack()
        reply.raw.writeHead(200, {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        })
        reply.raw.flushHeaders()
        for (const event of backlog) {
          if (event.sequence <= lastSequence) continue
          writeSseEvent(reply.raw, event)
          lastSequence = event.sequence
        }
        live = true
        for (const event of pending.sort(
          (left, right) => left.sequence - right.sequence,
        )) {
          if (event.sequence <= lastSequence) continue
          writeSseEvent(reply.raw, event)
          lastSequence = event.sequence
        }
        const heartbeat = setInterval(() => {
          reply.raw.write(": keep-alive\n\n")
        }, 15_000)
        heartbeat.unref()
        lifecycle.setHeartbeat(heartbeat)
      } catch (error) {
        lifecycle.cleanup()
        if (clientClosed) return
        throw error
      }
    },
  )

  application.get(
    "/api/test-runs/:runId/artifacts/:artifactId/download",
    {
      schema: {
        tags: ["test-runs"],
        summary: "Download one integrity-checked test run Artifact",
        params: TestRunArtifactParamsSchema,
        response: {
          200: Type.Any(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const artifact = await service.getArtifactDownload(
        request.params.runId,
        request.params.artifactId,
      )
      return reply
        .header("Cache-Control", "private, no-store")
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`,
        )
        .type(artifact.mediaType)
        .send(artifact.content)
    },
  )
}
