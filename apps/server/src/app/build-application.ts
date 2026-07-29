import Fastify, { type FastifyInstance } from "fastify"
import { type TypeBoxTypeProvider } from "@fastify/type-provider-typebox"

import type { ApplicationConfig } from "../config/index.js"
import { configPlugin } from "../config/config.plugin.js"
import { registerErrorHandling } from "../core/http/error-handler.js"
import { databasePlugin } from "../infrastructure/database/database.plugin.js"
import { requestContextPlugin } from "../infrastructure/observability/request-context.plugin.js"
import { registerModules } from "./register-modules.js"
import type { AgentRuntimeAdapter } from "../modules/agent-sessions/agent-session.domain.js"
import { registerOpenApi } from "./openapi.js"
import { registerSecurity } from "./security.js"
import { registerStaticContent } from "./static-content.js"

export interface BuildApplicationOptions {
  readonly config: ApplicationConfig
  readonly logger?: boolean
  readonly agentRuntimeAdapter?: AgentRuntimeAdapter
}

export async function buildApplication({
  config,
  logger,
  agentRuntimeAdapter,
}: BuildApplicationOptions): Promise<FastifyInstance> {
  const application = Fastify({
    logger:
      logger ??
      ({
        level: config.logLevel,
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers['set-cookie']",
          ],
          censor: "[REDACTED]",
        },
      } as const),
    requestIdHeader: false,
    requestIdLogLabel: "requestId",
  }).withTypeProvider<TypeBoxTypeProvider>()

  application.register(configPlugin, { config })
  application.register(requestContextPlugin)
  application.register(databasePlugin)

  registerErrorHandling(application)
  registerSecurity(application, config.openApiEnabled)

  if (config.openApiEnabled) {
    registerOpenApi(application)
  }

  registerModules(application, {
    agentSessions: {
      ...(agentRuntimeAdapter ? { runtimeAdapter: agentRuntimeAdapter } : {}),
    },
  })
  registerStaticContent(application, config.staticRoot)

  return application
}
