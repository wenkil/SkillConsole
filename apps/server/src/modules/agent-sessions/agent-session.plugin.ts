import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"
import { Type } from "typebox"

import { ErrorResponseSchema } from "../../core/http/error.contract.js"
import {
  AgentMessageInputSchema,
  AgentSessionEventsHeaderSchema,
  AgentSessionParamsSchema,
  AgentSessionSchema,
} from "./agent-session.contract.js"
import type {
  AgentRuntimeAdapter,
  AgentSessionEvent,
} from "./agent-session.domain.js"
import { AgentSessionService } from "./agent-session.service.js"
import { ClaudeAgentSdkAdapter } from "./runtime/claude-agent-sdk.adapter.js"

export interface AgentSessionPluginOptions {
  readonly runtimeAdapter?: AgentRuntimeAdapter
}

function writeSseEvent(
  response: NodeJS.WritableStream,
  event: AgentSessionEvent,
): void {
  response.write(`id: ${event.sequence}\n`)
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

export const agentSessionPlugin: FastifyPluginAsyncTypebox<
  AgentSessionPluginOptions
> = async (application, options) => {
  const service = new AgentSessionService({
    database: application.databaseClient.database,
    dataRoot: application.appConfig.dataRoot,
    claudeSettingsPath: application.appConfig.claudeSettingsPath,
    runtimeAdapter: options.runtimeAdapter ?? new ClaudeAgentSdkAdapter(),
    logger: application.log,
  })
  await service.initialize()

  application.addHook("onClose", async () => {
    await service.shutdown()
  })

  application.post(
    "/api/agent-sessions",
    {
      schema: {
        tags: ["agent-sessions"],
        summary: "Start an Agent Session with its first message",
        body: AgentMessageInputSchema,
        response: {
          202: AgentSessionSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply.code(202).send(await service.create(request.body.prompt)),
  )

  application.get(
    "/api/agent-sessions/:sessionId",
    {
      schema: {
        tags: ["agent-sessions"],
        summary: "Read Agent Session state",
        params: AgentSessionParamsSchema,
        response: {
          200: AgentSessionSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request) => service.get(request.params.sessionId),
  )

  application.post(
    "/api/agent-sessions/:sessionId/messages",
    {
      schema: {
        tags: ["agent-sessions"],
        summary: "Continue an idle or interrupted Agent Session",
        params: AgentSessionParamsSchema,
        body: AgentMessageInputSchema,
        response: {
          202: AgentSessionSchema,
          400: ErrorResponseSchema,
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
          await service.sendMessage(
            request.params.sessionId,
            request.body.prompt,
          ),
        ),
  )

  application.post(
    "/api/agent-sessions/:sessionId/cancel",
    {
      schema: {
        tags: ["agent-sessions"],
        summary: "Cancel the active Agent Session turn",
        params: AgentSessionParamsSchema,
        response: {
          202: AgentSessionSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(await service.cancel(request.params.sessionId)),
  )

  application.get(
    "/api/agent-sessions/:sessionId/events",
    {
      schema: {
        tags: ["agent-sessions"],
        summary: "Replay and stream complete Agent Session events",
        params: AgentSessionParamsSchema,
        headers: AgentSessionEventsHeaderSchema,
        produces: ["text/event-stream"],
        response: {
          200: Type.String({ contentMediaType: "text/event-stream" }),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const sessionId = request.params.sessionId
      const afterSequence = Number(request.headers["last-event-id"] ?? "0")
      await service.get(sessionId)

      let live = false
      const pending: AgentSessionEvent[] = []
      let lastSequence = afterSequence
      const unsubscribe = service.subscribe(sessionId, (event) => {
        if (!live) {
          pending.push(event)
          return
        }
        if (event.sequence <= lastSequence) return
        writeSseEvent(reply.raw, event)
        lastSequence = event.sequence
      })

      try {
        const backlog = await service.listEvents(sessionId, afterSequence)

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
