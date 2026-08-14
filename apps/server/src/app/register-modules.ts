import {
  agentSessionPlugin,
  type AgentSessionPluginOptions,
} from "../modules/agent-sessions/agent-session.plugin.js"
import { healthPlugin } from "../modules/health/health.plugin.js"
import { skillWorkspacePlugin } from "../modules/skill-workspaces/skill-workspace.plugin.js"
import { evalGenerationPlugin } from "../modules/evals/eval-generation.plugin.js"
import { testRunPlugin } from "../modules/test-runs/test-run.plugin.js"
import { testReportPlugin } from "../modules/test-reports/test-report.plugin.js"

import type { FastifyInstance } from "fastify"

export interface RegisterModulesOptions {
  readonly agentSessions?: AgentSessionPluginOptions
}

export function registerModules(
  application: FastifyInstance,
  options: RegisterModulesOptions = {},
): void {
  application.register(healthPlugin)
  application.register(skillWorkspacePlugin)
  application.register(agentSessionPlugin, options.agentSessions ?? {})
  application.register(evalGenerationPlugin)
  application.register(testRunPlugin)
  application.register(testReportPlugin)
}
