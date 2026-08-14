export const claudeAgentSdkVersion = "0.3.220"

export const agentSessionStatuses = [
  "STARTING",
  "RUNNING",
  "IDLE",
  "CANCELING",
  "INTERRUPTED",
  "FAILED",
] as const

export const agentSessionTurnStatuses = [
  "RUNNING",
  "COMPLETED",
  "CANCELED",
  "INTERRUPTED",
  "FAILED",
] as const

export const agentSessionEventTypes = [
  "session.started",
  "session.initialized",
  "turn.started",
  "assistant.message",
  "tool.completed",
  "usage.updated",
  "turn.completed",
  "turn.canceled",
  "turn.interrupted",
  "turn.failed",
  "session.failed",
] as const

export const claudeErrorCodes = [
  "CLAUDE_AUTHENTICATION_FAILED",
  "CLAUDE_ORGANIZATION_NOT_ALLOWED",
  "CLAUDE_BILLING_ERROR",
  "CLAUDE_CREDITS_EXHAUSTED",
  "CLAUDE_RATE_LIMITED",
  "CLAUDE_SERVICE_OVERLOADED",
  "CLAUDE_INVALID_REQUEST",
  "CLAUDE_MODEL_NOT_FOUND",
  "CLAUDE_SERVER_ERROR",
  "CLAUDE_API_ERROR",
  "CLAUDE_MAX_OUTPUT_TOKENS",
  "CLAUDE_PERMISSION_DENIED",
  "CLAUDE_MAX_TURNS_REACHED",
  "CLAUDE_MAX_BUDGET_EXCEEDED",
  "CLAUDE_STRUCTURED_OUTPUT_FAILED",
  "CLAUDE_BLOCKING_LIMIT_REACHED",
  "CLAUDE_RAPID_REFILL_BLOCKED",
  "CLAUDE_PROMPT_TOO_LONG",
  "CLAUDE_IMAGE_ERROR",
  "CLAUDE_MODEL_ERROR",
  "CLAUDE_MALFORMED_TOOL_USE",
  "CLAUDE_STREAM_ABORTED",
  "CLAUDE_TOOLS_ABORTED",
  "CLAUDE_HOOK_BLOCKED",
  "CLAUDE_TOOL_DEFERRED",
  "CLAUDE_TOOL_UNAVAILABLE",
  "CLAUDE_TURN_SETUP_FAILED",
  "CLAUDE_BACKGROUND_TASK_UNSUPPORTED",
  "CLAUDE_MODEL_REFUSED",
  "CLAUDE_NETWORK_ERROR",
  "CLAUDE_REQUEST_TIMEOUT",
  "CLAUDE_CONFIGURATION_INVALID",
  "CLAUDE_PROCESS_FAILED",
  "CLAUDE_RUNTIME_INTERRUPTED",
  "CLAUDE_EXECUTION_FAILED",
  "AGENT_SESSION_LOG_PERSISTENCE_FAILED",
] as const

export type AgentSessionStatus = (typeof agentSessionStatuses)[number]
export type AgentSessionTurnStatus =
  (typeof agentSessionTurnStatuses)[number]
export type AgentSessionEventType =
  (typeof agentSessionEventTypes)[number]
export type ClaudeErrorCode = (typeof claudeErrorCodes)[number]

export interface AgentSessionError {
  readonly code: ClaudeErrorCode
  readonly message: string
}

export interface AgentSessionTurnSummary {
  readonly id: string
  readonly status: AgentSessionTurnStatus
  readonly error: AgentSessionError | null
  readonly startedAt: string
  readonly completedAt: string | null
}

export interface AgentSessionView {
  readonly id: string
  readonly status: AgentSessionStatus
  readonly resumable: boolean
  readonly latestTurn: AgentSessionTurnSummary | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AgentSessionEvent {
  readonly sequence: number
  readonly type: AgentSessionEventType
  readonly sessionId: string
  readonly turnId: string | null
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export const agentSessionLogStatuses = [
  "WRITING",
  "COMPLETE",
  "DEGRADED",
  "FAILED",
  "RECOVERY_REQUIRED",
] as const

export type AgentSessionLogStatus =
  (typeof agentSessionLogStatuses)[number]

export type AgentSessionOrigin =
  | { readonly type: "eval_generation"; readonly taskId: string }
  | {
      readonly type: "test_run_execution"
      readonly runId: string
      readonly caseId: string
      readonly externalId: number
      readonly side: "TARGET" | "BASELINE"
      readonly phase: "execution"
    }
  | {
      readonly type: "test_run_grader"
      readonly runId: string
      readonly caseId: string
      readonly externalId: number
      readonly side: "TARGET" | "BASELINE"
      readonly phase: "grading"
    }
  | {
      readonly type: "report_analyzer"
      readonly runId: string
      readonly reportId: string
      readonly analysisId: string
      readonly revisionId: string
      readonly phase: "analysis"
    }
  | { readonly type: "generic" }

export type AssistantContent =
  | {
      readonly type: "text"
      readonly text: string
    }
  | {
      readonly type: "tool_use"
      readonly toolUseId: string
      readonly name: string
      readonly input: unknown
    }

export interface AgentUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationInputTokens: number
  readonly cacheReadInputTokens: number
}

export type AgentRuntimeEvent =
  | {
      readonly type: "initialized"
      readonly sdkSessionId: string
      readonly model: string
      readonly tools: readonly string[]
      readonly skills: readonly string[]
      readonly mcpServers: readonly {
        readonly name: string
        readonly status: string
      }[]
    }
  | {
      readonly type: "assistant_message"
      readonly messageId: string
      readonly content: readonly AssistantContent[]
    }
  | {
      readonly type: "tool_completed"
      readonly toolUseId: string
      readonly content: unknown
      readonly isError: boolean
    }
  | {
      readonly type: "turn_result"
      readonly success: boolean
      readonly subtype: string
      readonly durationMs: number
      readonly durationApiMs: number
      readonly numTurns: number
      readonly totalCostUsd: number
      readonly usage: AgentUsage
      readonly error: AgentSessionError | null
    }

export interface RuntimeTurnInput {
  readonly turnId: string
  readonly prompt: string
}

export interface AgentRuntimeDiagnostic {
  readonly messageType: string
  readonly subtype: string | null
  readonly details: Readonly<Record<string, unknown>>
}

export interface OpenAgentRuntimeSessionInput {
  readonly agentSessionId: string
  readonly cwd: string
  readonly claudeConfigDir: string
  readonly sessionStore: SessionStore
  readonly resumeSessionId?: string
  readonly maxTurns?: number
  readonly permissionMode?: AgentRuntimePermissionMode
  readonly tools?: readonly string[]
  readonly allowedTools?: readonly string[]
  readonly disallowedTools?: readonly string[]
  readonly skills?: readonly string[]
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly protectedEnvironmentNames?: readonly string[]
  readonly systemPrompt?: string
  readonly redactedValues: readonly string[]
  readonly onRawMessage: (message: SDKMessage) => Promise<void>
  readonly onDiagnostic?: (diagnostic: AgentRuntimeDiagnostic) => Promise<void>
  readonly onEvent: (
    turnId: string | null,
    event: AgentRuntimeEvent,
  ) => Promise<void>
  readonly onFatalError: (failure: AgentRuntimeFailure) => Promise<void>
}

export interface AgentRuntimeFailure {
  readonly code: ClaudeErrorCode
  readonly message: string
  readonly terminal: boolean
}

export interface AgentRuntimeSession {
  readonly send: (input: RuntimeTurnInput) => Promise<void>
  readonly interrupt: () => Promise<void>
  readonly close: () => void
}

export interface AgentRuntimeAdapter {
  readonly open: (
    input: OpenAgentRuntimeSessionInput,
  ) => AgentRuntimeSession
}
import type {
  PermissionMode,
  SDKMessage,
  SessionStore,
} from "@anthropic-ai/claude-agent-sdk"

export type AgentRuntimePermissionMode = PermissionMode
