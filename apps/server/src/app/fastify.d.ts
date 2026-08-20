import type { ApplicationConfig } from "../config/index.js"
import type { DatabaseClient } from "../infrastructure/database/index.js"
import type { AgentSessionService } from "../modules/agent-sessions/agent-session.service.js"
import type { EvalGenerationService } from "../modules/evals/eval-generation.service.js"
import type { TestRunService } from "../modules/test-runs/test-run.service.js"

declare module "fastify" {
  interface FastifyInstance {
    readonly appConfig: ApplicationConfig
    readonly databaseClient: DatabaseClient
    readonly agentSessionService: AgentSessionService
    readonly evalGenerationService: EvalGenerationService
    readonly testRunService: TestRunService
  }
}
