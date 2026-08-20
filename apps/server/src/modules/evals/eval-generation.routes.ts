import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"
import { Type } from "typebox"

import { ErrorResponseSchema } from "../../core/http/error.contract.js"
import type {
  EvalGenerationEvent,
  EvalGenerationTaskView,
} from "./eval-generation.domain.js"
import {
  EvalGenerationDraftSchema,
  EvalGenerationEventsHeaderSchema,
  EvalGenerationListQuerySchema,
  EvalGenerationParamsSchema,
  EvalGenerationStartHeadersSchema,
  EvalGenerationTaskPageSchema,
  EvalGenerationTaskSchema,
  EvalRevisionListSchema,
  PublishEvalRevisionResponseSchema,
  StartEvalGenerationBodySchema,
  WorkspaceEvalParamsSchema,
} from "./eval-generation.contract.js"
import type { EvalGenerationDraftView } from "./eval-generation.domain.js"

function writeSseEvent(
  response: NodeJS.WritableStream,
  event: EvalGenerationEvent,
): void {
  response.write(`id: ${event.sequence}\n`)
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

function serializeDraft(draft: EvalGenerationDraftView) {
  return {
    ...draft,
    cases: draft.cases.map((evalCase) => ({
      ...evalCase,
      assertions: [...evalCase.assertions],
      files: [...evalCase.files],
    })),
    files: draft.files.map((file) => ({ ...file })),
  }
}

function serializeTask(task: EvalGenerationTaskView) {
  return {
    ...task,
    attempts: [...task.attempts],
  }
}

export const evalGenerationRoutes: FastifyPluginAsyncTypebox = async (
  application,
) => {
  const service = application.evalGenerationService

  application.get(
    "/api/skill-workspaces/:workspaceId/eval-generations",
    {
      schema: {
        tags: ["evals"],
        summary: "List recent Evals generation tasks for a Skill workbench",
        params: WorkspaceEvalParamsSchema,
        querystring: EvalGenerationListQuerySchema,
        response: {
          200: EvalGenerationTaskPageSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.list(
        request.params.workspaceId,
        request.query.page ?? 1,
        request.query.pageSize ?? 20,
      )
      return reply
        .header("Cache-Control", "private, no-store")
        .send({ ...result, items: result.items.map(serializeTask) })
    },
  )

  application.post(
    "/api/skill-workspaces/:workspaceId/eval-generations",
    {
      schema: {
        tags: ["evals"],
        summary:
          "Start an Evals generation task from a frozen Skill target",
        params: WorkspaceEvalParamsSchema,
        headers: EvalGenerationStartHeadersSchema,
        body: StartEvalGenerationBodySchema,
        response: {
          202: EvalGenerationTaskSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply.code(202).send(
        serializeTask(
          await service.start({
            workspaceId: request.params.workspaceId,
            target: request.body.target,
            maxEvalCount: request.body.maxEvalCount,
            ...(request.body.generationBrief !== undefined
              ? { generationBrief: request.body.generationBrief }
              : {}),
            idempotencyKey: request.headers["idempotency-key"],
          }),
        ),
      ),
  )

  application.get(
    "/api/skill-workspaces/:workspaceId/eval-revisions",
    {
      schema: {
        tags: ["evals"],
        summary: "List immutable Evals revisions for a Skill workbench",
        params: WorkspaceEvalParamsSchema,
        response: {
          200: EvalRevisionListSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send([...(await service.listRevisions(request.params.workspaceId))]),
  )

  application.get(
    "/api/eval-generations/:taskId",
    {
      schema: {
        tags: ["evals"],
        summary: "Read one Evals generation task",
        params: EvalGenerationParamsSchema,
        response: {
          200: EvalGenerationTaskSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(serializeTask(await service.get(request.params.taskId))),
  )

  application.post(
    "/api/eval-generations/:taskId/cancel",
    {
      schema: {
        tags: ["evals"],
        summary: "Cancel an active Evals generation task",
        params: EvalGenerationParamsSchema,
        response: {
          202: EvalGenerationTaskSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(serializeTask(await service.cancel(request.params.taskId))),
  )

  application.post(
    "/api/eval-generations/:taskId/retry",
    {
      schema: {
        tags: ["evals"],
        summary:
          "Retry a failed Evals generation task with its frozen Skill target",
        params: EvalGenerationParamsSchema,
        headers: EvalGenerationStartHeadersSchema,
        response: {
          202: EvalGenerationTaskSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          serializeTask(
            await service.retry(
              request.params.taskId,
              request.headers["idempotency-key"],
            ),
          ),
        ),
  )

  application.get(
    "/api/eval-generations/:taskId/draft",
    {
      schema: {
        tags: ["evals"],
        summary: "Read the validated Evals review draft",
        params: EvalGenerationParamsSchema,
        response: {
          200: EvalGenerationDraftSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializeDraft(await service.getDraft(request.params.taskId)),
        ),
  )

  application.post(
    "/api/eval-generations/:taskId/draft/discard",
    {
      schema: {
        tags: ["evals"],
        summary: "Discard an unpublished Evals review draft",
        params: EvalGenerationParamsSchema,
        response: {
          200: EvalGenerationDraftSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "private, no-store")
        .send(
          serializeDraft(
            await service.discardDraft(request.params.taskId),
          ),
        ),
  )

  application.post(
    "/api/eval-generations/:taskId/publish",
    {
      schema: {
        tags: ["evals"],
        summary: "Publish a validated draft as an immutable Evals revision",
        params: EvalGenerationParamsSchema,
        response: {
          200: PublishEvalRevisionResponseSchema,
          201: PublishEvalRevisionResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await service.publish(request.params.taskId)
      return reply.code(result.replayed ? 200 : 201).send(result)
    },
  )

  application.get(
    "/api/eval-generations/:taskId/events",
    {
      schema: {
        tags: ["evals"],
        summary: "Replay and stream Evals generation events",
        params: EvalGenerationParamsSchema,
        headers: EvalGenerationEventsHeaderSchema,
        produces: ["text/event-stream"],
        response: {
          200: Type.String({ contentMediaType: "text/event-stream" }),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const taskId = request.params.taskId
      const afterSequence = Number(
        request.headers["last-event-id"] ?? "0",
      )
      await service.get(taskId)

      let live = false
      const pending: EvalGenerationEvent[] = []
      let lastSequence = afterSequence
      const unsubscribe = service.subscribe(taskId, (event) => {
        if (!live) {
          pending.push(event)
          return
        }
        if (event.sequence <= lastSequence) return
        writeSseEvent(reply.raw, event)
        lastSequence = event.sequence
      })

      try {
        const backlog = await service.listEvents(taskId, afterSequence)
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
        request.raw.once("close", () => {
          clearInterval(heartbeat)
          unsubscribe()
        })
      } catch (error) {
        unsubscribe()
        throw error
      }
    },
  )
}
