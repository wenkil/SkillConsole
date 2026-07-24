import type { ApplicationConfig } from "../config/index.js"
import type { DatabaseClient } from "../infrastructure/database/index.js"

declare module "fastify" {
  interface FastifyInstance {
    readonly appConfig: ApplicationConfig
    readonly databaseClient: DatabaseClient
  }
}
