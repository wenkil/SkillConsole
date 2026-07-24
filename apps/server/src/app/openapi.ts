import fastifySwagger from "@fastify/swagger"
import fastifySwaggerUi from "@fastify/swagger-ui"

import type { FastifyInstance } from "fastify"

export function registerOpenApi(application: FastifyInstance): void {
  application.register(fastifySwagger, {
    openapi: {
      info: {
        title: "SkillConsole API",
        description: "Local API for the SkillConsole Skill testing workbench.",
        version: "0.1.0",
      },
      tags: [
        {
          name: "health",
          description: "Application liveness and dependency readiness.",
        },
      ],
    },
  })

  application.register(fastifySwaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  })
}
