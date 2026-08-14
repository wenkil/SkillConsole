import type {
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultError,
  SDKResultMessage,
  TerminalReason,
} from "@anthropic-ai/claude-agent-sdk"

import type {
  AgentSessionError,
  ClaudeErrorCode,
} from "../agent-session.domain.js"

const claudeErrorMessages = {
  CLAUDE_AUTHENTICATION_FAILED:
    "Claude authentication is missing or invalid.",
  CLAUDE_ORGANIZATION_NOT_ALLOWED:
    "The Claude account is not allowed for this organization.",
  CLAUDE_BILLING_ERROR:
    "Claude billing requires attention before this request can run.",
  CLAUDE_CREDITS_EXHAUSTED:
    "Claude usage credits are exhausted.",
  CLAUDE_RATE_LIMITED:
    "Claude rate limit was reached. Try again later.",
  CLAUDE_SERVICE_OVERLOADED:
    "Claude is currently overloaded. Try again later.",
  CLAUDE_INVALID_REQUEST:
    "Claude rejected the request as invalid.",
  CLAUDE_MODEL_NOT_FOUND:
    "The requested Claude model is unavailable or does not exist.",
  CLAUDE_SERVER_ERROR:
    "Claude returned a server error. Try again later.",
  CLAUDE_API_ERROR:
    "Claude returned an unexpected API error.",
  CLAUDE_MAX_OUTPUT_TOKENS:
    "Claude reached the maximum output token limit.",
  CLAUDE_PERMISSION_DENIED:
    "Claude was denied permission to use a required tool.",
  CLAUDE_MAX_TURNS_REACHED:
    "Claude reached the maximum number of turns.",
  CLAUDE_MAX_BUDGET_EXCEEDED:
    "Claude reached the configured spending limit.",
  CLAUDE_STRUCTURED_OUTPUT_FAILED:
    "Claude could not produce valid structured output after retrying.",
  CLAUDE_BLOCKING_LIMIT_REACHED:
    "Claude stopped because a blocking usage limit was reached.",
  CLAUDE_RAPID_REFILL_BLOCKED:
    "Claude stopped because requests were refilling too quickly.",
  CLAUDE_PROMPT_TOO_LONG:
    "The request is too long for the Claude model context window.",
  CLAUDE_IMAGE_ERROR:
    "Claude could not process an image in the request.",
  CLAUDE_MODEL_ERROR:
    "The Claude model ended the request with an error.",
  CLAUDE_MALFORMED_TOOL_USE:
    "Claude repeatedly produced invalid tool input.",
  CLAUDE_STREAM_ABORTED:
    "The Claude response stream was interrupted.",
  CLAUDE_TOOLS_ABORTED:
    "Claude stopped while required tools were running.",
  CLAUDE_HOOK_BLOCKED:
    "A Claude hook prevented the request from completing.",
  CLAUDE_TOOL_DEFERRED:
    "Claude deferred a required tool call.",
  CLAUDE_TOOL_UNAVAILABLE:
    "A tool deferred by Claude is unavailable.",
  CLAUDE_TURN_SETUP_FAILED:
    "Claude could not prepare the request.",
  CLAUDE_BACKGROUND_TASK_UNSUPPORTED:
    "Claude moved the request to background execution, which is not supported here.",
  CLAUDE_MODEL_REFUSED:
    "The Claude model refused the request and no fallback was available.",
  CLAUDE_NETWORK_ERROR:
    "Claude could not be reached because of a network error.",
  CLAUDE_REQUEST_TIMEOUT:
    "The Claude request timed out.",
  CLAUDE_CONFIGURATION_INVALID:
    "Claude configuration is invalid or unavailable.",
  CLAUDE_PROCESS_FAILED:
    "The Claude Agent SDK process ended unexpectedly.",
  CLAUDE_RUNTIME_INTERRUPTED:
    "The Claude Agent SDK runtime was interrupted.",
  CLAUDE_EXECUTION_FAILED:
    "Claude could not complete the request.",
  AGENT_SESSION_LOG_PERSISTENCE_FAILED:
    "The Agent Session native logs could not be persisted.",
} satisfies Record<ClaudeErrorCode, string>

const assistantErrorCodes = {
  authentication_failed: "CLAUDE_AUTHENTICATION_FAILED",
  oauth_org_not_allowed: "CLAUDE_ORGANIZATION_NOT_ALLOWED",
  billing_error: "CLAUDE_BILLING_ERROR",
  rate_limit: "CLAUDE_RATE_LIMITED",
  overloaded: "CLAUDE_SERVICE_OVERLOADED",
  invalid_request: "CLAUDE_INVALID_REQUEST",
  model_not_found: "CLAUDE_MODEL_NOT_FOUND",
  server_error: "CLAUDE_SERVER_ERROR",
  unknown: "CLAUDE_API_ERROR",
  max_output_tokens: "CLAUDE_MAX_OUTPUT_TOKENS",
} satisfies Record<SDKAssistantMessageError, ClaudeErrorCode>

const resultSubtypeCodes = {
  error_during_execution: null,
  error_max_turns: "CLAUDE_MAX_TURNS_REACHED",
  error_max_budget_usd: "CLAUDE_MAX_BUDGET_EXCEEDED",
  error_max_structured_output_retries:
    "CLAUDE_STRUCTURED_OUTPUT_FAILED",
} satisfies Record<
  SDKResultError["subtype"],
  ClaudeErrorCode | null
>

const terminalReasonCodes = {
  blocking_limit: "CLAUDE_BLOCKING_LIMIT_REACHED",
  rapid_refill_breaker: "CLAUDE_RAPID_REFILL_BLOCKED",
  prompt_too_long: "CLAUDE_PROMPT_TOO_LONG",
  image_error: "CLAUDE_IMAGE_ERROR",
  model_error: "CLAUDE_MODEL_ERROR",
  api_error: "CLAUDE_API_ERROR",
  malformed_tool_use_exhausted: "CLAUDE_MALFORMED_TOOL_USE",
  aborted_streaming: "CLAUDE_STREAM_ABORTED",
  aborted_tools: "CLAUDE_TOOLS_ABORTED",
  stop_hook_prevented: "CLAUDE_HOOK_BLOCKED",
  hook_stopped: "CLAUDE_HOOK_BLOCKED",
  tool_deferred: "CLAUDE_TOOL_DEFERRED",
  max_turns: "CLAUDE_MAX_TURNS_REACHED",
  background_requested: "CLAUDE_BACKGROUND_TASK_UNSUPPORTED",
  completed: null,
  budget_exhausted: "CLAUDE_MAX_BUDGET_EXCEEDED",
  structured_output_retry_exhausted:
    "CLAUDE_STRUCTURED_OUTPUT_FAILED",
  tool_deferred_unavailable: "CLAUDE_TOOL_UNAVAILABLE",
  turn_setup_failed: "CLAUDE_TURN_SETUP_FAILED",
} satisfies Record<TerminalReason, ClaudeErrorCode | null>

export function createClaudeError(
  code: ClaudeErrorCode,
): AgentSessionError {
  return {
    code,
    message: claudeErrorMessages[code],
  }
}

export function classifyClaudeAssistantError(
  error: SDKAssistantMessageError,
): AgentSessionError {
  return createClaudeError(assistantErrorCodes[error])
}

function classifyHttpStatus(status: number | null | undefined) {
  if (status === 401) return "CLAUDE_AUTHENTICATION_FAILED"
  if (status === 402) return "CLAUDE_BILLING_ERROR"
  if (status === 403) return "CLAUDE_PERMISSION_DENIED"
  if (status === 408 || status === 504) return "CLAUDE_REQUEST_TIMEOUT"
  if (status === 413) return "CLAUDE_PROMPT_TOO_LONG"
  if (status === 429) return "CLAUDE_RATE_LIMITED"
  if (status === 503 || status === 529) {
    return "CLAUDE_SERVICE_OVERLOADED"
  }
  if (status && status >= 500) return "CLAUDE_SERVER_ERROR"
  if (status && status >= 400) return "CLAUDE_INVALID_REQUEST"
  return null
}

export function classifyClaudeErrorText(
  value: unknown,
): AgentSessionError | null {
  const details = value instanceof Error ? value.message : String(value ?? "")
  const normalized = details.toLowerCase()

  const matches = (...needles: readonly string[]) =>
    needles.some((needle) => normalized.includes(needle))

  if (
    matches(
      "oauth_org_not_allowed",
      "organization is not allowed",
      "org is not allowed",
      "organization not allowed",
    )
  ) {
    return createClaudeError("CLAUDE_ORGANIZATION_NOT_ALLOWED")
  }
  if (
    matches(
      "out_of_credits",
      "credits required",
      "credit balance",
      "insufficient credits",
    )
  ) {
    return createClaudeError("CLAUDE_CREDITS_EXHAUSTED")
  }
  if (matches("billing", "payment required", "purchase credits")) {
    return createClaudeError("CLAUDE_BILLING_ERROR")
  }
  if (
    matches(
      "not logged in",
      "please run /login",
      "authentication",
      "api key",
      "unauthorized",
      "invalid token",
      "invalid credential",
      "oauth token",
    )
  ) {
    return createClaudeError("CLAUDE_AUTHENTICATION_FAILED")
  }
  if (matches("rate limit", "too many requests", "status 429", "http 429")) {
    return createClaudeError("CLAUDE_RATE_LIMITED")
  }
  if (matches("overloaded", "status 529", "http 529")) {
    return createClaudeError("CLAUDE_SERVICE_OVERLOADED")
  }
  if (
    matches(
      "max output token",
      "maximum output token",
      "stop_reason=max_tokens",
    )
  ) {
    return createClaudeError("CLAUDE_MAX_OUTPUT_TOKENS")
  }
  if (
    matches(
      "prompt is too long",
      "prompt too long",
      "context window",
      "request too large",
    )
  ) {
    return createClaudeError("CLAUDE_PROMPT_TOO_LONG")
  }
  if (matches("model not found", "unknown model", "model_not_found")) {
    return createClaudeError("CLAUDE_MODEL_NOT_FOUND")
  }
  if (matches("permission denied", "not permitted", "tool use denied")) {
    return createClaudeError("CLAUDE_PERMISSION_DENIED")
  }
  if (matches("timed out", "timeout", "etimedout")) {
    return createClaudeError("CLAUDE_REQUEST_TIMEOUT")
  }
  if (
    matches(
      "network error",
      "connection error",
      "econnreset",
      "econnrefused",
      "enotfound",
      "socket hang up",
    )
  ) {
    return createClaudeError("CLAUDE_NETWORK_ERROR")
  }
  if (matches("model refused", "stop_reason=refusal")) {
    return createClaudeError("CLAUDE_MODEL_REFUSED")
  }
  if (
    matches(
      "invalid request",
      "invalid_request",
      "malformed request",
      "status 400",
      "http 400",
    )
  ) {
    return createClaudeError("CLAUDE_INVALID_REQUEST")
  }
  if (
    matches(
      "native cli binary",
      "invalid setting",
      "settings.json",
      "configuration",
      "enoent",
      "command not found",
    )
  ) {
    return createClaudeError("CLAUDE_CONFIGURATION_INVALID")
  }
  if (matches("server error", "internal server error")) {
    return createClaudeError("CLAUDE_SERVER_ERROR")
  }
  return null
}

function classifyStopReason(
  stopReason: string | null,
): AgentSessionError | null {
  if (stopReason === "max_tokens") {
    return createClaudeError("CLAUDE_MAX_OUTPUT_TOKENS")
  }
  if (stopReason === "refusal") {
    return createClaudeError("CLAUDE_MODEL_REFUSED")
  }
  return classifyClaudeErrorText(stopReason)
}

function classifyTerminalReason(
  terminalReason: TerminalReason | undefined,
): AgentSessionError | null {
  if (!terminalReason) return null
  const code = terminalReasonCodes[terminalReason]
  return code ? createClaudeError(code) : null
}

function hasNoUsage(message: SDKResultMessage) {
  return (
    message.usage.input_tokens === 0 &&
    message.usage.output_tokens === 0 &&
    message.usage.cache_creation_input_tokens === 0 &&
    message.usage.cache_read_input_tokens === 0
  )
}

export function classifyClaudeResult(
  message: SDKResultMessage,
  priorFailure: AgentSessionError | null = null,
): AgentSessionError | null {
  if (message.subtype !== "success") {
    const subtypeCode = resultSubtypeCodes[message.subtype]
    if (subtypeCode) return createClaudeError(subtypeCode)
  }

  const terminalError = classifyTerminalReason(message.terminal_reason)
  if (terminalError) return terminalError

  const stopError = classifyStopReason(message.stop_reason)
  if (stopError) return stopError

  if (message.subtype === "success") {
    const statusError = classifyHttpStatus(message.api_error_status)
    if (statusError) return createClaudeError(statusError)

    const resultError = classifyClaudeErrorText(message.result)
    if (resultError && (message.is_error || hasNoUsage(message))) {
      return resultError
    }

    if (!message.is_error) {
      return priorFailure && hasNoUsage(message) ? priorFailure : null
    }
    if (priorFailure) return priorFailure
    if (message.permission_denials.length > 0) {
      return createClaudeError("CLAUDE_PERMISSION_DENIED")
    }
    return resultError ?? createClaudeError("CLAUDE_EXECUTION_FAILED")
  }

  const detailsError = classifyClaudeErrorText(message.errors.join(" "))
  if (detailsError) return detailsError
  if (priorFailure) return priorFailure
  if (message.permission_denials.length > 0) {
    return createClaudeError("CLAUDE_PERMISSION_DENIED")
  }
  return createClaudeError("CLAUDE_EXECUTION_FAILED")
}

export function classifySdkMessageFailure(
  message: SDKMessage,
): AgentSessionError | null {
  if (message.type === "assistant" && message.error) {
    return classifyClaudeAssistantError(message.error)
  }
  if (message.type === "auth_status") {
    const authError = classifyClaudeErrorText([
      message.error,
      ...message.output,
    ].join(" "))
    if (authError) return authError
    if (message.error) {
      return createClaudeError("CLAUDE_AUTHENTICATION_FAILED")
    }
  }
  if (message.type === "system" && message.subtype === "api_retry") {
    return classifyClaudeAssistantError(message.error)
  }
  if (
    message.type === "system" &&
    message.subtype === "model_refusal_no_fallback"
  ) {
    return createClaudeError("CLAUDE_MODEL_REFUSED")
  }
  if (
    message.type === "system" &&
    message.subtype === "permission_denied"
  ) {
    return createClaudeError("CLAUDE_PERMISSION_DENIED")
  }
  if (
    message.type === "rate_limit_event" &&
    message.rate_limit_info.status === "rejected"
  ) {
    const info = message.rate_limit_info
    return createClaudeError(
      info.errorCode === "credits_required" ||
        info.overageDisabledReason === "out_of_credits"
        ? "CLAUDE_CREDITS_EXHAUSTED"
        : "CLAUDE_RATE_LIMITED",
    )
  }
  return null
}
