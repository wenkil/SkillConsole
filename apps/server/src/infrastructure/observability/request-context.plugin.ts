import type { FastifyPluginAsync } from "fastify"
import fastifyPlugin from "fastify-plugin"

const requestContextPluginImplementation: FastifyPluginAsync = async (
  application,
) => {
  application.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id)
  })
}

export const requestContextPlugin = fastifyPlugin(
  requestContextPluginImplementation,
  {
    name: "request-context",
  },
)
