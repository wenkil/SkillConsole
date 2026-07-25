import { healthPlugin } from "../modules/health/health.plugin.js"
import { skillWorkspacePlugin } from "../modules/skill-workspaces/skill-workspace.plugin.js"

import type { FastifyInstance } from "fastify"

export function registerModules(application: FastifyInstance): void {
  application.register(healthPlugin)
  application.register(skillWorkspacePlugin)
}
