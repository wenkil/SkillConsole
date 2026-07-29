import type {
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk"

import type {
  AgentSessionError,
  AgentRuntimeEvent,
  AssistantContent,
} from "../agent-session.domain.js"

export interface SdkMessageMappingOptions {
  readonly redactedValues?: readonly (string | undefined)[]
}

function createSanitizer(options: SdkMessageMappingOptions) {
  const redactedValues = [
    ...new Set(
      (options.redactedValues ?? []).filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ].sort((left, right) => right.length - left.length)

  const sanitize = (value: unknown): unknown => {
    if (typeof value === "string") {
      return redactedValues.reduce(
        (result, redacted) =>
          result.split(redacted).join("[REDACTED]"),
        value,
      )
    }
    if (Array.isArray(value)) return value.map(sanitize)
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
          key,
          sanitize(nestedValue),
        ]),
      )
    }
    return value
  }

  return sanitize
}

function mapAssistantContent(
  message: Extract<SDKMessage, { type: "assistant" }>,
  sanitize: (value: unknown) => unknown,
) {
  const content: AssistantContent[] = []

  for (const block of message.message.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: String(sanitize(block.text)) })
      continue
    }

    if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        toolUseId: block.id,
        name: block.name,
        input: sanitize(block.input),
      })
    }
  }

  return content
}

function mapToolResults(
  message: Extract<SDKMessage, { type: "user" }>,
  sanitize: (value: unknown) => unknown,
): AgentRuntimeEvent[] {
  if ("isReplay" in message && message.isReplay) return []
  if (!Array.isArray(message.message.content)) return []

  return message.message.content.flatMap((block) => {
    if (block.type !== "tool_result") return []

    return [
      {
        type: "tool_completed" as const,
        toolUseId: block.tool_use_id,
        content: sanitize(block.content ?? null),
        isError: block.is_error === true,
      },
    ]
  })
}

function classifyResultError(
  message: SDKResultMessage,
): AgentSessionError | null {
  if (message.subtype === "success") return null
  const details = message.errors.join(" ").toLowerCase()

  if (
    details.includes("authentication") ||
    details.includes("api key") ||
    details.includes("unauthorized") ||
    details.includes("not logged in") ||
    details.includes("oauth") ||
    details.includes("credential")
  ) {
    return {
      code: "CLAUDE_AUTHENTICATION_FAILED",
      message: "Claude Agent SDK authentication failed.",
    }
  }
  if (
    details.includes("configuration") ||
    details.includes("invalid setting") ||
    details.includes("settings.json")
  ) {
    return {
      code: "CLAUDE_CONFIGURATION_INVALID",
      message: "Claude Agent SDK configuration is invalid.",
    }
  }
  return {
    code: "CLAUDE_EXECUTION_FAILED",
    message: `Claude Agent SDK ended with ${message.subtype}.`,
  }
}

function mapResult(message: SDKResultMessage): AgentRuntimeEvent {
  return {
    type: "turn_result",
    success: message.subtype === "success",
    subtype: message.subtype,
    durationMs: message.duration_ms,
    durationApiMs: message.duration_api_ms,
    numTurns: message.num_turns,
    totalCostUsd: message.total_cost_usd,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens:
        message.usage.cache_creation_input_tokens,
      cacheReadInputTokens: message.usage.cache_read_input_tokens,
    },
    error: classifyResultError(message),
  }
}

export function mapSdkMessage(
  message: SDKMessage,
  options: SdkMessageMappingOptions = {},
): AgentRuntimeEvent[] {
  const sanitize = createSanitizer(options)

  if (message.type === "system" && message.subtype === "init") {
    return [
      {
        type: "initialized",
        sdkSessionId: message.session_id,
      },
    ]
  }

  if (message.type === "assistant") {
    if (message.aborted) return []

    return [
      {
        type: "assistant_message",
        messageId: message.uuid,
        content: mapAssistantContent(message, sanitize),
      },
    ]
  }

  if (message.type === "user") {
    return mapToolResults(message, sanitize)
  }

  if (message.type === "result") {
    return [mapResult(message)]
  }

  return []
}
