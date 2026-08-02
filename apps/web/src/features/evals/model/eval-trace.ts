import type { EvalGenerationEvent } from "./evals"

interface EventTraceEntry {
  readonly kind: "event"
  readonly event: EvalGenerationEvent
  readonly sequence: number
}

interface ToolTraceEntry {
  readonly kind: "tool"
  readonly event: EvalGenerationEvent
  readonly sequence: number
  readonly toolName: string | null
  readonly output: string | null
  readonly isError: boolean
}

interface MessageTraceEntry {
  readonly kind: "message"
  readonly event: EvalGenerationEvent
  readonly sequence: number
  readonly content: string
}

export type EvalTraceEntry =
  | EventTraceEntry
  | ToolTraceEntry
  | MessageTraceEntry

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
}

function formatToolOutput(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value.trim() || null

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function readToolPath(input: unknown): string | null {
  if (!isRecord(input)) return null
  const value = input.file_path ?? input.path
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function formatAssistantMessage(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const text = value
    .filter(
      (block): block is { readonly type: "text"; readonly text: string } =>
        isRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string",
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
  return text || null
}

interface ToolCallDetails {
  readonly name: string
  readonly input: unknown
}

function indexToolNames(
  events: readonly EvalGenerationEvent[],
): ReadonlyMap<string, ToolCallDetails> {
  const toolCalls = new Map<string, ToolCallDetails>()

  for (const event of events) {
    if (event.type !== "agent.assistant") continue
    const content = event.payload.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_use") continue
      if (
        typeof block.toolUseId === "string" &&
        typeof block.name === "string"
      ) {
        toolCalls.set(block.toolUseId, {
          name: block.name,
          input: block.input,
        })
      }
    }
  }

  return toolCalls
}

export function buildEvalTraceEntries(
  events: readonly EvalGenerationEvent[],
): EvalTraceEntry[] {
  const toolNames = indexToolNames(events)

  return events.flatMap((event): EvalTraceEntry[] => {
    if (event.type === "agent.assistant") {
      const content = formatAssistantMessage(event.payload.content)
      return content
        ? [
            {
              kind: "message",
              event,
              sequence: event.sequence,
              content,
            },
          ]
        : []
    }

    if (event.type === "agent.tool") {
      const toolUseId =
        typeof event.payload.toolUseId === "string"
          ? event.payload.toolUseId
          : null
      return [
        {
          kind: "tool",
          event,
          sequence: event.sequence,
          toolName: toolUseId
            ? toolNames.get(toolUseId)?.name ?? null
            : null,
          output:
            toolUseId && toolNames.get(toolUseId)?.name === "Read"
              ? readToolPath(toolNames.get(toolUseId)?.input)
              : formatToolOutput(event.payload.content),
          isError: event.payload.isError === true,
        },
      ]
    }

    return [{ kind: "event", event, sequence: event.sequence }]
  })
}
