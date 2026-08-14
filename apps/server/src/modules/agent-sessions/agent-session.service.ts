import { randomUUID } from "node:crypto"

import type { Database } from "../../infrastructure/database/index.js"
import type {
  AgentRuntimeAdapter,
  AgentRuntimeDiagnostic,
  AgentRuntimeFailure,
  AgentRuntimeSession,
  AgentRuntimeToolPermissionHandler,
  AgentSessionEvent,
  AgentSessionView,
} from "./agent-session.domain.js"
import { AgentSessionEventBus } from "./agent-session-event-bus.js"
import { AgentSessionRepository } from "./agent-session.repository.js"
import { ActiveAgentSessionRegistry } from "./runtime/active-session-registry.js"
import {
  AgentSessionWorkspaceConfigurationError,
  AgentSessionWorkspaceStore,
} from "./session-workspace.js"

interface AgentSessionLogger {
  readonly error: (
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ) => void
}

export interface AgentSessionServiceOptions {
  readonly database: Database
  readonly dataRoot: string
  readonly claudeSettingsPath: string
  readonly runtimeAdapter: AgentRuntimeAdapter
  readonly logger: AgentSessionLogger
}

export interface CreateAgentSessionInWorkspaceInput {
  readonly prompt: string
  readonly workspaceLocator: string
  readonly expectedConfigurationFingerprint: string
  readonly allowedTools?: readonly string[]
  readonly availableTools?: readonly string[]
  readonly enabledSkills?: readonly string[]
  readonly canUseTool?: AgentRuntimeToolPermissionHandler
  readonly maxTurns?: number
  readonly maxBudgetUsd?: number
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly protectedEnvironmentNames?: readonly string[]
  readonly sandboxPolicy?:
    | "test_run_strict_v1"
    | "report_analyzer_strict_v1"
  readonly isolateSettings?: boolean
  readonly systemPrompt?: string
  readonly persistSession?: boolean
  readonly strictMcpConfig?: boolean
  readonly additionalRedactedValues?: readonly string[]
  readonly onRuntimeDiagnostic?: (
    diagnostic: AgentRuntimeDiagnostic,
  ) => Promise<void>
}

export class AgentSessionService {
  private readonly repository: AgentSessionRepository
  private readonly workspaces: AgentSessionWorkspaceStore
  private readonly registry = new ActiveAgentSessionRegistry()
  private readonly eventBus = new AgentSessionEventBus()
  private shuttingDown = false

  constructor(private readonly options: AgentSessionServiceOptions) {
    this.repository = new AgentSessionRepository(options.database)
    this.workspaces = new AgentSessionWorkspaceStore(
      options.dataRoot,
      options.claudeSettingsPath,
    )
  }

  async initialize(): Promise<void> {
    await this.repository.reconcileInterruptedSessions()
  }

  async create(prompt: string): Promise<AgentSessionView> {
    const sessionId = randomUUID()
    const turnId = randomUUID()
    const workspace = await this.workspaces.prepare(sessionId)
    const created = await this.repository.create(
      sessionId,
      workspace.locator,
      turnId,
    )
    this.publish(created.events)

    try {
      const redactedValues = await this.workspaces.installSettings(
        workspace.absolutePath,
      )
      const runtime = this.openRuntime({
        sessionId,
        cwd: workspace.absolutePath,
        sdkSessionId: null,
        redactedValues,
      })
      await runtime.send({ turnId, prompt })
      return created.session
    } catch (error) {
      return this.handleRuntimeFailure(
        sessionId,
        this.classifyOperationFailure(
          error,
          "The Claude Agent SDK process could not start.",
        ),
      )
    }
  }

  async createInWorkspace(
    input: CreateAgentSessionInWorkspaceInput,
  ): Promise<AgentSessionView> {
    const sessionId = randomUUID()
    const cwd = this.workspaces.resolve(input.workspaceLocator)
    try {
      const settingsValues = input.isolateSettings
        ? []
        : await this.workspaces.installSettings(cwd)
      if (input.isolateSettings) {
        await this.workspaces.assertSourceSettingsFingerprint(
          input.expectedConfigurationFingerprint,
        )
      } else {
        await this.workspaces.assertSettingsFingerprint(
          cwd,
          input.expectedConfigurationFingerprint,
        )
      }
      return this.startSession({
        sessionId,
        prompt: input.prompt,
        workspaceLocator: input.workspaceLocator,
        cwd,
        ...(input.allowedTools
          ? { allowedTools: input.allowedTools }
          : {}),
        ...(input.availableTools
          ? { availableTools: input.availableTools }
          : {}),
        ...(input.enabledSkills
          ? { enabledSkills: input.enabledSkills }
          : {}),
        ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
        ...(input.maxTurns !== undefined
          ? { maxTurns: input.maxTurns }
          : {}),
        ...(input.maxBudgetUsd !== undefined
          ? { maxBudgetUsd: input.maxBudgetUsd }
          : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.protectedEnvironmentNames
          ? {
              protectedEnvironmentNames:
                input.protectedEnvironmentNames,
            }
          : {}),
        ...(input.sandboxPolicy
          ? { sandboxPolicy: input.sandboxPolicy }
          : {}),
        ...(input.isolateSettings !== undefined
          ? { isolateSettings: input.isolateSettings }
          : {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.persistSession !== undefined
          ? { persistSession: input.persistSession }
          : {}),
        ...(input.strictMcpConfig !== undefined
          ? { strictMcpConfig: input.strictMcpConfig }
          : {}),
        redactedValues: [
          ...settingsValues,
          cwd,
          ...(input.additionalRedactedValues ?? []),
        ],
        ...(input.onRuntimeDiagnostic
          ? { onRuntimeDiagnostic: input.onRuntimeDiagnostic }
          : {}),
      })
    } catch (error) {
      throw this.classifyWorkspacePreparationFailure(error)
    }
  }

  async get(sessionId: string): Promise<AgentSessionView> {
    return this.repository.get(sessionId)
  }

  async sendMessage(
    sessionId: string,
    prompt: string,
  ): Promise<AgentSessionView> {
    const turnId = randomUUID()
    const currentRuntime = this.registry.get(sessionId)
    const started = await this.repository.beginTurn(
      sessionId,
      turnId,
      !currentRuntime,
    )
    this.publish(started.events)

    const cwd = this.workspaces.resolve(started.context.workspaceLocator)
    try {
      let runtime = currentRuntime
      if (!runtime) {
        const redactedValues =
          await this.workspaces.readRedactedValues(cwd)
        runtime = this.openRuntime({
          sessionId,
          cwd,
          sdkSessionId: started.context.sdkSessionId,
          redactedValues,
        })
      }
      await runtime.send({ turnId, prompt })
      return started.session
    } catch (error) {
      return this.handleRuntimeFailure(
        sessionId,
        this.classifyOperationFailure(
          error,
          "The Claude Agent SDK process could not accept the message.",
        ),
      )
    }
  }

  async cancel(sessionId: string): Promise<AgentSessionView> {
    const cancellation =
      await this.repository.requestCancellation(sessionId)
    if (!cancellation.newlyRequested) {
      return cancellation.session
    }
    const runtime = this.registry.get(sessionId)

    if (!runtime) {
      return this.handleRuntimeFailure(sessionId, {
        code: "CLAUDE_PROCESS_FAILED",
        message: "The active Claude Agent SDK process is unavailable.",
        terminal: false,
      })
    }

    try {
      await runtime.interrupt()
      return this.repository.get(sessionId)
    } catch {
      return this.handleRuntimeFailure(sessionId, {
        code: "CLAUDE_PROCESS_FAILED",
        message: "The Claude Agent SDK process could not be interrupted.",
        terminal: false,
      })
    }
  }

  async listEvents(
    sessionId: string,
    afterSequence: number,
  ): Promise<readonly AgentSessionEvent[]> {
    return this.repository.listEvents(sessionId, afterSequence)
  }

  subscribe(
    sessionId: string,
    listener: (event: AgentSessionEvent) => void,
  ): () => void {
    return this.eventBus.subscribe(sessionId, listener)
  }

  async getWorkspaceSensitiveValues(
    workspaceLocator: string,
  ): Promise<readonly string[]> {
    const workspace = this.workspaces.resolve(workspaceLocator)
    return this.workspaces.readRedactedValues(workspace)
  }

  async assertWorkspaceConfigurationFingerprint(
    workspaceLocator: string,
    expectedFingerprint: string,
  ): Promise<void> {
    const workspace = this.workspaces.resolve(workspaceLocator)
    await this.workspaces.assertSettingsFingerprint(
      workspace,
      expectedFingerprint,
    )
  }

  async assertSourceConfigurationFingerprint(
    expectedFingerprint: string,
  ): Promise<void> {
    await this.workspaces.assertSourceSettingsFingerprint(
      expectedFingerprint,
    )
  }

  release(sessionId: string): void {
    this.registry.closeAndDelete(sessionId)
  }

  async abandon(
    sessionId: string,
    message = "The active Agent Session was abandoned by its owner.",
  ): Promise<AgentSessionView> {
    try {
      const result = await this.repository.markRuntimeInterrupted(
        sessionId,
        new Error(message),
      )
      this.publish(result.events)
      return result.session
    } finally {
      this.registry.closeAndDelete(sessionId)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.registry.closeAll()
    await this.repository.reconcileInterruptedSessions()
  }

  private openRuntime(input: {
    readonly sessionId: string
    readonly cwd: string
    readonly sdkSessionId: string | null
    readonly allowedTools?: readonly string[]
    readonly availableTools?: readonly string[]
    readonly enabledSkills?: readonly string[]
    readonly canUseTool?: AgentRuntimeToolPermissionHandler
    readonly maxTurns?: number
    readonly maxBudgetUsd?: number
    readonly environment?: Readonly<Record<string, string | undefined>>
    readonly protectedEnvironmentNames?: readonly string[]
    readonly sandboxPolicy?:
      | "test_run_strict_v1"
      | "report_analyzer_strict_v1"
    readonly isolateSettings?: boolean
    readonly systemPrompt?: string
    readonly persistSession?: boolean
    readonly strictMcpConfig?: boolean
    readonly redactedValues: readonly string[]
    readonly onRuntimeDiagnostic?: (
      diagnostic: AgentRuntimeDiagnostic,
    ) => Promise<void>
  }): AgentRuntimeSession {
    if (this.shuttingDown) {
      throw new Error("Agent Session service is shutting down.")
    }

    let runtime: AgentRuntimeSession | undefined
    runtime = this.options.runtimeAdapter.open({
      cwd: input.cwd,
      redactedValues: input.redactedValues,
      ...(input.onRuntimeDiagnostic
        ? { onDiagnostic: input.onRuntimeDiagnostic }
        : {}),
      ...(input.allowedTools
        ? { allowedTools: input.allowedTools }
        : {}),
      ...(input.availableTools
        ? { availableTools: input.availableTools }
        : {}),
      ...(input.enabledSkills
        ? { enabledSkills: input.enabledSkills }
        : {}),
      ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
      ...(input.maxTurns !== undefined
        ? { maxTurns: input.maxTurns }
        : {}),
      ...(input.maxBudgetUsd !== undefined
        ? { maxBudgetUsd: input.maxBudgetUsd }
        : {}),
      ...(input.environment ? { environment: input.environment } : {}),
      ...(input.protectedEnvironmentNames
        ? {
            protectedEnvironmentNames: input.protectedEnvironmentNames,
          }
        : {}),
      ...(input.sandboxPolicy
        ? { sandboxPolicy: input.sandboxPolicy }
        : {}),
      ...(input.isolateSettings !== undefined
        ? { isolateSettings: input.isolateSettings }
        : {}),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.persistSession !== undefined
        ? { persistSession: input.persistSession }
        : {}),
      ...(input.strictMcpConfig !== undefined
        ? { strictMcpConfig: input.strictMcpConfig }
        : {}),
      ...(input.sdkSessionId
        ? { resumeSessionId: input.sdkSessionId }
        : {}),
      onEvent: async (turnId, event) => {
        if (event.type === "initialized") {
          const stored = await this.repository.markInitialized(
            input.sessionId,
            event,
          )
          this.eventBus.publish(stored)
          return
        }
        if (!turnId) {
          throw new Error("Claude runtime event did not identify its turn.")
        }

        if (event.type === "turn_result") {
          const completed = await this.repository.completeTurn(
            input.sessionId,
            turnId,
            event,
          )
          this.publish(completed.events)
          return
        }

        const stored = await this.repository.recordRuntimeEvent(
          input.sessionId,
          turnId,
          event,
        )
        this.eventBus.publish(stored)
      },
      onFatalError: async (failure) => {
        this.options.logger.error(
          { sessionId: input.sessionId },
          "Claude Agent SDK runtime ended unexpectedly",
        )
        if (failure.terminal) runtime?.close()
        this.registry.delete(input.sessionId, runtime)
        const result = failure.terminal
          ? await this.repository.markRuntimeFailed(
              input.sessionId,
              failure,
            )
          : await this.repository.markRuntimeInterrupted(input.sessionId)
        this.publish(result.events)
      },
    })
    this.registry.set(input.sessionId, runtime)
    return runtime
  }

  private async startSession(input: {
    readonly sessionId: string
    readonly prompt: string
    readonly workspaceLocator: string
    readonly cwd: string
    readonly allowedTools?: readonly string[]
    readonly availableTools?: readonly string[]
    readonly enabledSkills?: readonly string[]
    readonly canUseTool?: AgentRuntimeToolPermissionHandler
    readonly maxTurns?: number
    readonly maxBudgetUsd?: number
    readonly environment?: Readonly<Record<string, string | undefined>>
    readonly protectedEnvironmentNames?: readonly string[]
    readonly sandboxPolicy?:
      | "test_run_strict_v1"
      | "report_analyzer_strict_v1"
    readonly isolateSettings?: boolean
    readonly systemPrompt?: string
    readonly persistSession?: boolean
    readonly strictMcpConfig?: boolean
    readonly redactedValues: readonly string[]
    readonly onRuntimeDiagnostic?: (
      diagnostic: AgentRuntimeDiagnostic,
    ) => Promise<void>
  }): Promise<AgentSessionView> {
    const turnId = randomUUID()
    const created = await this.repository.create(
      input.sessionId,
      input.workspaceLocator,
      turnId,
    )
    this.publish(created.events)

    try {
      const runtime = this.openRuntime({
        sessionId: input.sessionId,
        cwd: input.cwd,
        sdkSessionId: null,
        redactedValues: [...new Set(input.redactedValues)],
        ...(input.onRuntimeDiagnostic
          ? { onRuntimeDiagnostic: input.onRuntimeDiagnostic }
          : {}),
        ...(input.allowedTools
          ? { allowedTools: input.allowedTools }
          : {}),
        ...(input.availableTools
          ? { availableTools: input.availableTools }
          : {}),
        ...(input.enabledSkills
          ? { enabledSkills: input.enabledSkills }
          : {}),
        ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
        ...(input.maxTurns !== undefined
          ? { maxTurns: input.maxTurns }
          : {}),
        ...(input.maxBudgetUsd !== undefined
          ? { maxBudgetUsd: input.maxBudgetUsd }
          : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.protectedEnvironmentNames
          ? {
              protectedEnvironmentNames:
                input.protectedEnvironmentNames,
            }
          : {}),
        ...(input.sandboxPolicy
          ? { sandboxPolicy: input.sandboxPolicy }
          : {}),
        ...(input.isolateSettings !== undefined
          ? { isolateSettings: input.isolateSettings }
          : {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.persistSession !== undefined
          ? { persistSession: input.persistSession }
          : {}),
        ...(input.strictMcpConfig !== undefined
          ? { strictMcpConfig: input.strictMcpConfig }
          : {}),
      })
      await runtime.send({ turnId, prompt: input.prompt })
      return created.session
    } catch (error) {
      return this.handleRuntimeFailure(
        input.sessionId,
        this.classifyOperationFailure(
          error,
          "The Claude Agent SDK process could not start.",
        ),
      )
    }
  }

  private async handleRuntimeFailure(
    sessionId: string,
    failure: AgentRuntimeFailure,
  ): Promise<AgentSessionView> {
    this.options.logger.error(
      { sessionId },
      "Claude Agent SDK runtime operation failed",
    )
    this.registry.closeAndDelete(sessionId)
    const result = failure.terminal
      ? await this.repository.markRuntimeFailed(sessionId, failure)
      : await this.repository.markRuntimeInterrupted(sessionId)
    this.publish(result.events)
    return result.session
  }

  private classifyOperationFailure(
    error: unknown,
    processMessage: string,
  ): AgentRuntimeFailure {
    if (error instanceof AgentSessionWorkspaceConfigurationError) {
      return {
        code: "CLAUDE_CONFIGURATION_INVALID",
        message: "Claude workspace settings are unavailable.",
        terminal: true,
      }
    }

    return {
      code: "CLAUDE_PROCESS_FAILED",
      message: processMessage,
      terminal: false,
    }
  }

  private classifyWorkspacePreparationFailure(error: unknown): Error {
    if (error instanceof AgentSessionWorkspaceConfigurationError) {
      return error
    }
    return new AgentSessionWorkspaceConfigurationError({ cause: error })
  }

  private publish(events: readonly AgentSessionEvent[]): void {
    for (const event of events) {
      this.eventBus.publish(event)
    }
  }
}
