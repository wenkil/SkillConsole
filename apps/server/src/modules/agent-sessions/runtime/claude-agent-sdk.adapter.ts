import {
  query,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"

import type {
  AgentRuntimeAdapter,
  AgentRuntimeFailure,
  AgentRuntimeSession,
  AgentSessionError,
  OpenAgentRuntimeSessionInput,
  RuntimeTurnInput,
} from "../agent-session.domain.js"
import { AsyncMessageQueue } from "./async-message-queue.js"
import {
  classifyClaudeErrorText,
  classifySdkMessageFailure,
  createClaudeError,
} from "./claude-error-classifier.js"
import { mapSdkMessage } from "./sdk-message.mapper.js"

function classifyRuntimeFailure(error: unknown): AgentRuntimeFailure {
  const classified = classifyClaudeErrorText(error)
  const failure =
    classified ?? createClaudeError("CLAUDE_PROCESS_FAILED")
  const terminalCodes = new Set([
    "CLAUDE_AUTHENTICATION_FAILED",
    "CLAUDE_ORGANIZATION_NOT_ALLOWED",
    "CLAUDE_BILLING_ERROR",
    "CLAUDE_CREDITS_EXHAUSTED",
    "CLAUDE_INVALID_REQUEST",
    "CLAUDE_MODEL_NOT_FOUND",
    "CLAUDE_CONFIGURATION_INVALID",
  ])

  return {
    ...failure,
    terminal: terminalCodes.has(failure.code),
  }
}

class ClaudeAgentSdkSession implements AgentRuntimeSession {
  private readonly inputQueue = new AsyncMessageQueue<SDKUserMessage>()
  private readonly abortController = new AbortController()
  private readonly query: Query
  private activeTurnId: string | null = null
  private failureHint: AgentSessionError | null = null
  private closing = false

  constructor(
    private readonly input: OpenAgentRuntimeSessionInput,
  ) {
    this.query = query({
      prompt: this.inputQueue,
      options: {
        abortController: this.abortController,
        cwd: input.cwd,
        settingSources: ["project"],
        ...(input.allowedTools
          ? { allowedTools: [...input.allowedTools] }
          : {}),
        ...(input.canUseTool
          ? {
              canUseTool: async (
                toolName: string,
                toolInput: Record<string, unknown>,
                options: {
                  readonly signal: AbortSignal
                  readonly blockedPath?: string
                  readonly decisionReason?: string
                  readonly title?: string
                  readonly displayName?: string
                  readonly description?: string
                  readonly toolUseID: string
                  readonly requestId: string
                },
              ) => {
                const permission = input.canUseTool
                  ? await input.canUseTool(toolName, toolInput, {
                      signal: options.signal,
                      ...(options.blockedPath
                        ? { blockedPath: options.blockedPath }
                        : {}),
                      ...(options.decisionReason
                        ? { decisionReason: options.decisionReason }
                        : {}),
                      ...(options.title ? { title: options.title } : {}),
                      ...(options.displayName
                        ? { displayName: options.displayName }
                        : {}),
                      ...(options.description
                        ? { description: options.description }
                        : {}),
                      toolUseId: options.toolUseID,
                      requestId: options.requestId,
                    })
                  : { behavior: "deny" as const, message: "Tool is not enabled." }
                if (permission.behavior === "allow") {
                  return {
                    behavior: "allow" as const,
                    ...(permission.updatedInput
                      ? { updatedInput: { ...permission.updatedInput } }
                      : {}),
                  }
                }
                return {
                  behavior: "deny" as const,
                  message: permission.message,
                  ...(permission.interrupt !== undefined
                    ? { interrupt: permission.interrupt }
                    : {}),
                }
              },
            }
          : {}),
        ...(input.maxTurns !== undefined
          ? { maxTurns: input.maxTurns }
          : {}),
        ...(input.maxBudgetUsd !== undefined
          ? { maxBudgetUsd: input.maxBudgetUsd }
          : {}),
        ...(input.canUseTool ? { permissionMode: "default" as const } : {}),
        ...(input.resumeSessionId
          ? { resume: input.resumeSessionId }
          : {}),
      },
    })

    void this.consume()
  }

  async send(input: RuntimeTurnInput): Promise<void> {
    if (this.closing) {
      throw new Error("The Claude Agent SDK session is closed.")
    }
    if (this.activeTurnId) {
      throw new Error("The Claude Agent SDK session already has an active turn.")
    }

    this.activeTurnId = input.turnId
    this.failureHint = null
    this.inputQueue.push({
      type: "user",
      message: {
        role: "user",
        content: input.prompt,
      },
      parent_tool_use_id: null,
    })
  }

  async interrupt(): Promise<void> {
    if (!this.activeTurnId) {
      throw new Error("The Claude Agent SDK session has no active turn.")
    }

    await this.query.interrupt()
  }

  close(): void {
    if (this.closing) return
    this.closing = true
    this.inputQueue.close()
    this.abortController.abort()
    this.query.close()
  }

  private async consume(): Promise<void> {
    try {
      for await (const sdkMessage of this.query) {
        this.failureHint =
          classifySdkMessageFailure(sdkMessage) ?? this.failureHint
        const runtimeEvents = mapSdkMessage(sdkMessage, {
          redactedValues: [
            this.input.cwd,
            ...this.input.redactedValues,
            process.env.ANTHROPIC_API_KEY,
            process.env.ANTHROPIC_AUTH_TOKEN,
            process.env.CLAUDE_CODE_OAUTH_TOKEN,
          ],
          workspacePath: this.input.cwd,
          priorFailure: this.failureHint,
        })

        for (const event of runtimeEvents) {
          const turnId =
            event.type === "initialized" ? null : this.activeTurnId
          await this.input.onEvent(turnId, event)

          if (event.type === "turn_result") {
            this.activeTurnId = null
            this.failureHint = null
          }
        }
      }

      if (!this.closing) {
        const failure = createClaudeError("CLAUDE_PROCESS_FAILED")
        await this.input.onFatalError({
          ...failure,
          terminal: false,
        })
      }
    } catch (error) {
      if (!this.closing) {
        await this.input.onFatalError(classifyRuntimeFailure(error))
      }
    }
  }
}

export class ClaudeAgentSdkAdapter implements AgentRuntimeAdapter {
  open(input: OpenAgentRuntimeSessionInput): AgentRuntimeSession {
    return new ClaudeAgentSdkSession(input)
  }
}
