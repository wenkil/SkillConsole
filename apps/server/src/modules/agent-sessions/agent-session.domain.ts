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

export type AgentSessionStatus = (typeof agentSessionStatuses)[number]
export type AgentSessionTurnStatus =
  (typeof agentSessionTurnStatuses)[number]
export type AgentSessionEventType =
  (typeof agentSessionEventTypes)[number]

export interface AgentSessionError {
  readonly code: string
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

export interface OpenAgentRuntimeSessionInput {
  readonly cwd: string
  readonly resumeSessionId?: string
  readonly redactedValues: readonly string[]
  readonly onEvent: (
    turnId: string | null,
    event: AgentRuntimeEvent,
  ) => Promise<void>
  readonly onFatalError: (failure: AgentRuntimeFailure) => Promise<void>
}

export interface AgentRuntimeFailure {
  readonly code:
    | "CLAUDE_AUTHENTICATION_FAILED"
    | "CLAUDE_CONFIGURATION_INVALID"
    | "CLAUDE_PROCESS_FAILED"
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
