import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox"

import { checkDatabaseConnection } from "../../infrastructure/database/index.js"
import {
  LivenessResponseSchema,
  ReadinessResponseSchema,
  type LivenessResponse,
  type ReadinessResponse,
} from "./health.contract.js"

const livenessResponse: LivenessResponse = {
  service: "skillconsole-server",
  status: "alive",
}

export const healthPlugin: FastifyPluginAsyncTypebox = async (application) => {
  application.get(
    "/health/live",
    {
      schema: {
        tags: ["health"],
        summary: "Check whether the server process is alive",
        response: {
          200: LivenessResponseSchema,
        },
      },
    },
    async () => livenessResponse,
  )

  application.get(
    "/health/ready",
    {
      schema: {
        tags: ["health"],
        summary: "Check whether the server and its dependencies are ready",
        response: {
          200: ReadinessResponseSchema,
          503: ReadinessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        await checkDatabaseConnection(application.databaseClient)

        const response: ReadinessResponse = {
          service: "skillconsole-server",
          status: "ready",
          checks: {
            database: "connected",
          },
        }

        return reply.code(200).send(response)
      } catch (error) {
        application.log.warn(
          { err: error },
          "Database readiness check failed",
        )

        const response: ReadinessResponse = {
          service: "skillconsole-server",
          status: "unavailable",
          checks: {
            database: "unavailable",
          },
        }

        return reply.code(503).send(response)
      }
    },
  )
}
