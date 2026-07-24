import fastifyHelmet from "@fastify/helmet"

import type { FastifyInstance } from "fastify"

export function registerSecurity(
  application: FastifyInstance,
  openApiEnabled: boolean,
): void {
  application.register(fastifyHelmet, {
    ...(openApiEnabled ? { contentSecurityPolicy: false } : {}),
  })
}
