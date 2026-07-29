import { randomUUID } from "node:crypto"

import type { Database } from "../../infrastructure/database/index.js"
import type {
  AgentRuntimeAdapter,
  AgentRuntimeFailure,
  AgentRuntimeSession,
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
    readonly redactedValues: readonly string[]
  }): AgentRuntimeSession {
    if (this.shuttingDown) {
      throw new Error("Agent Session service is shutting down.")
    }

    let runtime: AgentRuntimeSession | undefined
    runtime = this.options.runtimeAdapter.open({
      cwd: input.cwd,
      redactedValues: input.redactedValues,
      ...(input.sdkSessionId
        ? { resumeSessionId: input.sdkSessionId }
        : {}),
      onEvent: async (turnId, event) => {
        if (event.type === "initialized") {
          await this.repository.markInitialized(
            input.sessionId,
            event.sdkSessionId,
          )
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

  private publish(events: readonly AgentSessionEvent[]): void {
    for (const event of events) {
      this.eventBus.publish(event)
    }
  }
}
