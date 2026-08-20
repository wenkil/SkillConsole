import { randomUUID } from "node:crypto"

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"

import type { Database } from "../../infrastructure/database/index.js"
import type {
  AgentRuntimeAdapter,
  AgentRuntimeDiagnostic,
  AgentRuntimeFailure,
  AgentRuntimePermissionMode,
  AgentRuntimeSession,
  AgentSessionEvent,
  AgentSessionLogStatus,
  AgentSessionOrigin,
  AgentSessionView,
} from "./agent-session.domain.js"
import { AgentSessionEventBus } from "./agent-session-event-bus.js"
import { AgentSessionLogManager } from "./agent-session-log-manager.js"
import { AgentSessionRepository } from "./agent-session.repository.js"
import {
  AgentSystemPromptStore,
  type AgentSystemPrompt,
  type AgentSystemPromptRole,
} from "./agent-system-prompt.js"
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
  readonly agentPromptsRoot: string
  readonly runtimeAdapter: AgentRuntimeAdapter
  readonly logger: AgentSessionLogger
}

export interface CreateAgentSessionInWorkspaceInput {
  readonly origin: AgentSessionOrigin
  readonly prompt: string
  readonly workspaceLocator: string
  readonly expectedConfigurationFingerprint: string
  readonly systemPromptRole: AgentSystemPromptRole
  readonly expectedSystemPromptFingerprint: string
  readonly permissionMode?: AgentRuntimePermissionMode
  readonly tools?: readonly string[]
  readonly allowedTools?: readonly string[]
  readonly disallowedTools?: readonly string[]
  readonly canUseTool?: CanUseTool
  readonly skills?: readonly string[]
  readonly runtimeSkillNames?: readonly string[]
  readonly requiredSkills?: readonly string[]
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly protectedEnvironmentNames?: readonly string[]
  readonly additionalRedactedValues?: readonly string[]
  readonly onRuntimeDiagnostic?: (
    diagnostic: AgentRuntimeDiagnostic,
  ) => Promise<void>
}

export function resolveAgentRuntimePermissionMode(
  roleOverride: AgentRuntimePermissionMode | undefined,
  settingsDefault: AgentRuntimePermissionMode | undefined,
): AgentRuntimePermissionMode | undefined {
  return roleOverride ?? settingsDefault
}

export class AgentSessionService {
  private readonly repository: AgentSessionRepository
  private readonly workspaces: AgentSessionWorkspaceStore
  private readonly systemPrompts: AgentSystemPromptStore
  private readonly logs: AgentSessionLogManager
  private readonly registry = new ActiveAgentSessionRegistry()
  private readonly eventBus = new AgentSessionEventBus()
  private shuttingDown = false

  constructor(private readonly options: AgentSessionServiceOptions) {
    this.repository = new AgentSessionRepository(options.database)
    this.workspaces = new AgentSessionWorkspaceStore(
      options.dataRoot,
      options.claudeSettingsPath,
    )
    this.systemPrompts = new AgentSystemPromptStore(options.agentPromptsRoot)
    this.logs = new AgentSessionLogManager(
      options.dataRoot,
      options.database,
      options.logger,
    )
  }

  async initialize(): Promise<void> {
    await this.logs.initialize()
    await this.repository.reconcileInterruptedSessions()
  }

  async create(prompt: string): Promise<AgentSessionView> {
    const sessionId = randomUUID()
    const turnId = randomUUID()
    const workspace = await this.workspaces.prepare(sessionId)
    const origin = { type: "generic" } as const
    await this.logs.prepare(sessionId, origin)
    const created = await this.repository.create(
      sessionId,
      workspace.locator,
      turnId,
      origin,
    )
    this.publish(created.events)

    try {
      const systemPrompt = await this.systemPrompts.load("generic-agent")
      const installedSettings = await this.workspaces.installSettings(
        workspace.absolutePath,
      )
      const runtime = this.openRuntime({
        sessionId,
        cwd: workspace.absolutePath,
        sdkSessionId: null,
        settingsPath: installedSettings.settingsPath,
        systemPrompt: systemPrompt.content,
        ...(installedSettings.defaultPermissionMode
          ? { permissionMode: installedSettings.defaultPermissionMode }
          : {}),
        redactedValues: installedSettings.redactedValues,
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
      const systemPrompt = await this.systemPrompts.load(
        input.systemPromptRole,
      )
      if (systemPrompt.sha256 !== input.expectedSystemPromptFingerprint) {
        throw new Error("Agent System Prompt changed during task preparation.")
      }
      const installedSettings = await this.workspaces.installSettings(cwd)
      await this.workspaces.assertSettingsFingerprint(
        cwd,
        input.expectedConfigurationFingerprint,
      )
      const permissionMode = resolveAgentRuntimePermissionMode(
        input.permissionMode,
        installedSettings.defaultPermissionMode,
      )
      return this.startSession({
        sessionId,
        prompt: input.prompt,
        workspaceLocator: input.workspaceLocator,
        cwd,
        settingsPath: installedSettings.settingsPath,
        systemPrompt: systemPrompt.content,
        origin: input.origin,
        ...(permissionMode ? { permissionMode } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
        ...(input.disallowedTools
          ? { disallowedTools: input.disallowedTools }
          : {}),
        ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
        ...(input.skills ? { skills: input.skills } : {}),
        ...(input.runtimeSkillNames
          ? { runtimeSkillNames: input.runtimeSkillNames }
          : {}),
        ...(input.requiredSkills
          ? { requiredSkills: input.requiredSkills }
          : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.protectedEnvironmentNames
          ? {
              protectedEnvironmentNames:
                input.protectedEnvironmentNames,
            }
          : {}),
        redactedValues: [
          ...installedSettings.redactedValues,
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

  getSystemPrompt(role: AgentSystemPromptRole): Promise<AgentSystemPrompt> {
    return this.systemPrompts.load(role)
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
    await this.logs.beginTurn(sessionId)

    const cwd = this.workspaces.resolve(started.context.workspaceLocator)
    try {
      let runtime = currentRuntime
      if (!runtime) {
        const systemPrompt = await this.systemPrompts.load("generic-agent")
        const installedSettings =
          await this.workspaces.readInstalledSettings(cwd)
        runtime = this.openRuntime({
          sessionId,
          cwd,
          sdkSessionId: started.context.sdkSessionId,
          settingsPath: installedSettings.settingsPath,
          systemPrompt: systemPrompt.content,
          ...(installedSettings.defaultPermissionMode
            ? { permissionMode: installedSettings.defaultPermissionMode }
            : {}),
          redactedValues: installedSettings.redactedValues,
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
    await this.logs.recordDiagnostic(sessionId, {
      messageType: "session.cancellation.requested",
      subtype: null,
      details: {},
    })
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

  annotateFinalOutputProtocol(
    sessionId: string,
    status: "VALID" | "INVALID" | "NOT_APPLICABLE",
  ): Promise<void> {
    return this.logs.annotateProtocol(sessionId, status)
  }

  release(sessionId: string): void {
    this.registry.closeAndDelete(sessionId)
    void this.logs.release(sessionId)
  }

  async abandon(
    sessionId: string,
    message = "The active Agent Session was abandoned by its owner.",
  ): Promise<AgentSessionView> {
    try {
      await this.finalizeLogs(sessionId, {
        kind: "runtime_failure",
        errorMessage: message,
      })
      const result = await this.repository.markRuntimeInterrupted(
        sessionId,
        new Error(message),
      )
      this.publish(result.events)
      return result.session
    } finally {
      this.registry.closeAndDelete(sessionId)
      await this.logs.release(sessionId)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.registry.closeAll()
    await this.logs.shutdown()
    await this.repository.reconcileInterruptedSessions()
  }

  private openRuntime(input: {
    readonly sessionId: string
    readonly cwd: string
    readonly sdkSessionId: string | null
    readonly settingsPath: string
    readonly permissionMode?: AgentRuntimePermissionMode
    readonly tools?: readonly string[]
    readonly allowedTools?: readonly string[]
    readonly disallowedTools?: readonly string[]
    readonly canUseTool?: CanUseTool
    readonly skills?: readonly string[]
    readonly requiredSkills?: readonly string[]
    readonly environment?: Readonly<Record<string, string | undefined>>
    readonly protectedEnvironmentNames?: readonly string[]
    readonly systemPrompt?: string
    readonly redactedValues: readonly string[]
    readonly onRuntimeDiagnostic?: (
      diagnostic: AgentRuntimeDiagnostic,
    ) => Promise<void>
  }): AgentRuntimeSession {
    if (this.shuttingDown) {
      throw new Error("Agent Session service is shutting down.")
    }

    let runtime: AgentRuntimeSession | undefined
    const logConfiguration = this.logs.getRuntimeConfiguration(
      input.sessionId,
    )
    runtime = this.options.runtimeAdapter.open({
      agentSessionId: input.sessionId,
      cwd: input.cwd,
      claudeConfigDir: logConfiguration.claudeConfigDir,
      settingsPath: input.settingsPath,
      sessionStore: logConfiguration.sessionStore,
      redactedValues: input.redactedValues,
      onRawMessage: (message) =>
        this.logs.recordRawMessage(input.sessionId, message),
      onDiagnostic: async (diagnostic) => {
        await this.logs.recordDiagnostic(input.sessionId, diagnostic)
        await input.onRuntimeDiagnostic?.(diagnostic)
      },
      ...(input.permissionMode
        ? { permissionMode: input.permissionMode }
        : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
      ...(input.disallowedTools
        ? { disallowedTools: input.disallowedTools }
        : {}),
      ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
      ...(input.skills ? { skills: input.skills } : {}),
      ...(input.requiredSkills
        ? { requiredSkills: input.requiredSkills }
        : {}),
      ...(input.environment ? { environment: input.environment } : {}),
      ...(input.protectedEnvironmentNames
        ? {
            protectedEnvironmentNames: input.protectedEnvironmentNames,
          }
        : {}),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.sdkSessionId
        ? { resumeSessionId: input.sdkSessionId }
        : {}),
      onEvent: async (turnId, event) => {
        if (event.type === "initialized") {
          await this.logs.markInitialized(
            input.sessionId,
            event.sdkSessionId,
            event.model,
          )
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
          const logResult = await this.finalizeLogs(input.sessionId, {
            kind: "result",
            ...(event.error
              ? {
                  errorCode: event.error.code,
                  errorMessage: event.error.message,
                }
              : {}),
          })
          const completedEvent =
            event.success && logResult.status === "FAILED"
              ? {
                  ...event,
                  success: false,
                  error: {
                    code: "AGENT_SESSION_LOG_PERSISTENCE_FAILED" as const,
                    message:
                      logResult.error ??
                      "Agent Session native logs could not be persisted.",
                  },
                }
              : event
          const completed = await this.repository.completeTurn(
            input.sessionId,
            turnId,
            completedEvent,
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
        const logResult = await this.finalizeLogs(input.sessionId, {
          kind: "runtime_failure",
          errorCode: failure.code,
          errorMessage: failure.message,
        })
        const effectiveFailure =
          logResult.status === "FAILED"
            ? {
                code: "AGENT_SESSION_LOG_PERSISTENCE_FAILED" as const,
                message:
                  logResult.error ??
                  "Agent Session native logs could not be persisted.",
                terminal: true,
              }
            : failure
        const result = effectiveFailure.terminal
          ? await this.repository.markRuntimeFailed(
              input.sessionId,
              effectiveFailure,
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
    readonly settingsPath: string
    readonly permissionMode?: AgentRuntimePermissionMode
    readonly tools?: readonly string[]
    readonly allowedTools?: readonly string[]
    readonly disallowedTools?: readonly string[]
    readonly canUseTool?: CanUseTool
    readonly skills?: readonly string[]
    readonly runtimeSkillNames?: readonly string[]
    readonly requiredSkills?: readonly string[]
    readonly environment?: Readonly<Record<string, string | undefined>>
    readonly protectedEnvironmentNames?: readonly string[]
    readonly systemPrompt?: string
    readonly origin: AgentSessionOrigin
    readonly redactedValues: readonly string[]
    readonly onRuntimeDiagnostic?: (
      diagnostic: AgentRuntimeDiagnostic,
    ) => Promise<void>
  }): Promise<AgentSessionView> {
    const turnId = randomUUID()
    await this.logs.prepare(input.sessionId, input.origin)
    const created = await this.repository.create(
      input.sessionId,
      input.workspaceLocator,
      turnId,
      input.origin,
    )
    this.publish(created.events)

    try {
      const runtimeConfiguration = this.logs.getRuntimeConfiguration(
        input.sessionId,
      )
      await this.workspaces.installRuntimeSkills(
        input.cwd,
        runtimeConfiguration.claudeConfigDir,
        input.runtimeSkillNames ?? [],
      )
      const runtime = this.openRuntime({
        sessionId: input.sessionId,
        cwd: input.cwd,
        sdkSessionId: null,
        settingsPath: input.settingsPath,
        redactedValues: [...new Set(input.redactedValues)],
        ...(input.onRuntimeDiagnostic
          ? { onRuntimeDiagnostic: input.onRuntimeDiagnostic }
          : {}),
        ...(input.permissionMode
          ? { permissionMode: input.permissionMode }
          : {}),
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
        ...(input.disallowedTools
          ? { disallowedTools: input.disallowedTools }
          : {}),
        ...(input.canUseTool ? { canUseTool: input.canUseTool } : {}),
        ...(input.skills ? { skills: input.skills } : {}),
        ...(input.requiredSkills
          ? { requiredSkills: input.requiredSkills }
          : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.protectedEnvironmentNames
          ? {
              protectedEnvironmentNames:
                input.protectedEnvironmentNames,
            }
          : {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
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
    const logResult = await this.finalizeLogs(sessionId, {
      kind: "startup_failure",
      errorCode: failure.code,
      errorMessage: failure.message,
    })
    const effectiveFailure =
      logResult.status === "FAILED"
        ? {
            code: "AGENT_SESSION_LOG_PERSISTENCE_FAILED" as const,
            message:
              logResult.error ??
              "Agent Session native logs could not be persisted.",
            terminal: true,
          }
        : failure
    const result = effectiveFailure.terminal
      ? await this.repository.markRuntimeFailed(sessionId, effectiveFailure)
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

  private async finalizeLogs(
    sessionId: string,
    terminal: Parameters<AgentSessionLogManager["finalize"]>[1],
  ): Promise<{ readonly status: AgentSessionLogStatus; readonly error: string | null }> {
    try {
      return await this.logs.finalize(sessionId, terminal)
    } catch (error) {
      this.options.logger.error(
        { sessionId, error },
        "Agent Session native logs could not be finalized",
      )
      return {
        status: "FAILED",
        error: "Agent Session native logs could not be finalized.",
      }
    }
  }
}
