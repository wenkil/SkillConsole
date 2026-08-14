import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import { existsSync } from "node:fs"
import path from "node:path"

import type {
  AgentRuntimeAdapter,
  AgentRuntimeDiagnostic,
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

function diagnosticScalar(
  value: unknown,
): string | number | boolean | null | undefined {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined
}

function numericRecord(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function summarizeContentBlocks(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return []
  return value.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      return { type: typeof block }
    }
    const record = block as Readonly<Record<string, unknown>>
    const type = typeof record.type === "string" ? record.type : "unknown"
    const textValue =
      typeof record.text === "string"
        ? record.text
        : typeof record.thinking === "string"
          ? record.thinking
          : null
    return {
      type,
      ...(textValue !== null ? { characterCount: textValue.length } : {}),
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(typeof record.id === "string" ? { id: record.id } : {}),
    }
  })
}

function summarizeSdkMessage(message: SDKMessage): AgentRuntimeDiagnostic {
  const record = message as unknown as Readonly<Record<string, unknown>>
  const nestedMessage =
    record.message && typeof record.message === "object" && !Array.isArray(record.message)
      ? (record.message as Readonly<Record<string, unknown>>)
      : null
  const streamEvent =
    record.event && typeof record.event === "object" && !Array.isArray(record.event)
      ? (record.event as Readonly<Record<string, unknown>>)
      : null
  const scalarKeys = [
    "uuid",
    "session_id",
    "request_id",
    "error",
    "error_status",
    "attempt",
    "max_retries",
    "retry_delay_ms",
    "state",
    "model",
    "stop_reason",
    "duration_ms",
    "duration_api_ms",
    "num_turns",
    "total_cost_usd",
    "terminal_reason",
    "is_error",
    "aborted",
  ] as const
  const details: Record<string, unknown> = {}
  for (const key of scalarKeys) {
    const value = diagnosticScalar(record[key])
    if (value !== undefined) details[key] = value
  }
  if (nestedMessage) {
    for (const key of ["id", "model", "stop_reason"] as const) {
      const value = diagnosticScalar(nestedMessage[key])
      if (value !== undefined) details[`message_${key}`] = value
    }
    details.contentBlocks = summarizeContentBlocks(nestedMessage.content)
    const nestedUsage = numericRecord(nestedMessage.usage)
    if (nestedUsage) details.messageUsage = nestedUsage
  }
  const usage = numericRecord(record.usage)
  if (usage) details.usage = usage
  if (typeof record.result === "string") {
    details.resultCharacterCount = record.result.length
  }
  if (streamEvent) {
    details.streamEventType =
      typeof streamEvent.type === "string" ? streamEvent.type : "unknown"
  }
  return {
    messageType: typeof record.type === "string" ? record.type : "unknown",
    subtype: typeof record.subtype === "string" ? record.subtype : null,
    details,
  }
}

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

export function strictTestRunSandbox(
  input: OpenAgentRuntimeSessionInput,
) {
  const roots =
    process.platform === "win32"
      ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
          .split("")
          .map((drive) => `${drive}:\\`)
          .filter((root) => existsSync(root))
      : ["/"]
  const runtimeReadCandidates =
    process.platform === "win32"
      ? [
          input.cwd,
          path.dirname(process.execPath),
          input.environment?.SystemRoot,
          input.environment?.SystemRoot
            ? path.join(input.environment.SystemRoot, "System32")
            : undefined,
          ...(input.environment?.PATH ?? input.environment?.Path ?? "")
            .split(path.delimiter)
            .filter(Boolean),
        ]
      : [
          input.cwd,
          path.dirname(process.execPath),
          "/bin",
          "/lib",
          "/lib64",
          "/usr/bin",
          "/usr/lib",
          "/usr/lib64",
          "/usr/local/bin",
          "/usr/local/lib",
          "/usr/share",
          "/nix/store",
          "/etc/ssl/certs",
          "/etc/alternatives",
          "/dev/null",
          ...(input.environment?.PATH ?? "").split(path.delimiter),
        ]
  const runtimeReadPaths = runtimeReadCandidates
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value))
    .filter((value) => path.parse(value).root !== value)
    .filter((value) => existsSync(value))
  const protectedEnvironmentNames = [
    ...new Set([
      ...(input.protectedEnvironmentNames ?? []),
      ...Object.keys(input.environment ?? {}).filter((name) =>
        /(?:api[_-]?key|auth|authorization|credential|password|secret|token|oauth)/iu.test(
          name,
        ),
      ),
    ]),
  ]
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    enableWeakerNestedSandbox: false,
    network: {
      allowedDomains: [],
      deniedDomains: ["*"],
      strictAllowlist: true,
      allowLocalBinding: false,
      allowAllUnixSockets: false,
    },
    filesystem: {
      denyRead: roots,
      allowRead: [...new Set(runtimeReadPaths.map((value) => path.resolve(value)))],
      denyWrite: roots,
      allowWrite: [path.join(input.cwd, "outputs")],
    },
    credentials: {
      envVars: protectedEnvironmentNames.map((name) => ({
        name,
        mode: "deny" as const,
      })),
    },
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
        ...(input.environment ? { env: { ...input.environment } } : {}),
        ...(input.sandboxPolicy === "test_run_strict_v1" ||
        input.sandboxPolicy === "report_analyzer_strict_v1"
          ? { sandbox: strictTestRunSandbox(input) }
          : {}),
        settingSources: input.isolateSettings ? [] : ["project"],
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        ...(input.persistSession !== undefined
          ? { persistSession: input.persistSession }
          : {}),
        ...(input.strictMcpConfig !== undefined
          ? { strictMcpConfig: input.strictMcpConfig }
          : {}),
        ...(input.availableTools
          ? { tools: [...input.availableTools] }
          : {}),
        ...(input.enabledSkills
          ? { skills: [...input.enabledSkills] }
          : {}),
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
        await this.input.onDiagnostic?.(summarizeSdkMessage(sdkMessage))
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
        await this.input
          .onDiagnostic?.({
            messageType: "runtime.error",
            subtype: "stream_ended_unexpectedly",
            details: { code: failure.code, message: failure.message },
          })
          .catch(() => undefined)
        await this.input.onFatalError({
          ...failure,
          terminal: false,
        })
      }
    } catch (error) {
      if (!this.closing) {
        const failure = classifyRuntimeFailure(error)
        await this.input
          .onDiagnostic?.({
            messageType: "runtime.error",
            subtype: "exception",
            details: { code: failure.code, message: failure.message },
          })
          .catch(() => undefined)
        await this.input.onFatalError(failure)
      }
    }
  }
}

export class ClaudeAgentSdkAdapter implements AgentRuntimeAdapter {
  open(input: OpenAgentRuntimeSessionInput): AgentRuntimeSession {
    return new ClaudeAgentSdkSession(input)
  }
}
