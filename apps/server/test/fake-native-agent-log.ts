import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"

import type { OpenAgentRuntimeSessionInput } from "../src/modules/agent-sessions/agent-session.domain.js"

export async function recordFakeNativeTurn(
  input: OpenAgentRuntimeSessionInput,
  sdkSessionId: string,
  turnId: string,
  success: boolean,
  text = "Fake assistant output.",
): Promise<void> {
  const assistant = {
    type: "assistant",
    uuid: `assistant-${turnId}`,
    session_id: sdkSessionId,
    parent_tool_use_id: null,
    message: {
      id: `message-${turnId}`,
      model: "claude-fake",
      role: "assistant",
      stop_reason: success ? "end_turn" : null,
      content: [{ type: "text", text }],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    ...(!success ? { aborted: true } : {}),
  } as unknown as SDKMessage
  await input.onRawMessage(assistant)
  await input.sessionStore.append(
    { projectKey: input.cwd, sessionId: sdkSessionId },
    [
      {
        type: "assistant",
        uuid: `transcript-${turnId}`,
        timestamp: new Date().toISOString(),
        message: (assistant as unknown as { message: unknown }).message,
      },
    ],
  )
  await input.onRawMessage({
    type: "result",
    subtype: success ? "success" : "error_during_execution",
    session_id: sdkSessionId,
    duration_ms: 10,
    duration_api_ms: 8,
    is_error: !success,
    num_turns: 1,
    result: text,
    stop_reason: success ? "end_turn" : null,
    total_cost_usd: 0.001,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
  } as unknown as SDKMessage)
}
