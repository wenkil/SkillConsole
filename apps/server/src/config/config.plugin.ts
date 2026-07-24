import type { FastifyPluginAsync } from "fastify"
import fastifyPlugin from "fastify-plugin"

import type { ApplicationConfig } from "./application-config.js"

export interface ConfigPluginOptions {
  readonly config: ApplicationConfig
}

const configPluginImplementation: FastifyPluginAsync<
  ConfigPluginOptions
> = async (application, { config }) => {
  application.decorate("appConfig", config)
}

export const configPlugin = fastifyPlugin(configPluginImplementation, {
  name: "application-config",
})
