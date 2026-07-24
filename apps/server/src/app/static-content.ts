import fastifyStatic from "@fastify/static"

import { createErrorResponse } from "../core/http/error.contract.js"

import type { FastifyInstance, FastifyRequest } from "fastify"

function isApiRequest(request: FastifyRequest): boolean {
  const path = request.url.split("?", 1)[0] ?? request.url

  return (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/health" ||
    path.startsWith("/health/") ||
    path === "/documentation" ||
    path.startsWith("/documentation/")
  )
}

function acceptsHtml(request: FastifyRequest): boolean {
  return request.headers.accept?.includes("text/html") ?? false
}

export function registerStaticContent(
  application: FastifyInstance,
  staticRoot: string | undefined,
): void {
  if (staticRoot) {
    application.register(fastifyStatic, {
      root: staticRoot,
    })
  }

  application.setNotFoundHandler(async (request, reply) => {
    const canServeApplicationShell =
      staticRoot !== undefined &&
      (request.method === "GET" || request.method === "HEAD") &&
      !isApiRequest(request) &&
      acceptsHtml(request)

    if (canServeApplicationShell) {
      return reply.sendFile("index.html")
    }

    return reply.code(404).send(
      createErrorResponse(
        request.id,
        "ROUTE_NOT_FOUND",
        "The requested route does not exist.",
      ),
    )
  })
}
