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

export type EvalTraceEntry = EventTraceEntry | ToolTraceEntry

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

function indexToolNames(
  events: readonly EvalGenerationEvent[],
): ReadonlyMap<string, string> {
  const toolNames = new Map<string, string>()

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
        toolNames.set(block.toolUseId, block.name)
      }
    }
  }

  return toolNames
}

export function buildEvalTraceEntries(
  events: readonly EvalGenerationEvent[],
): EvalTraceEntry[] {
  const toolNames = indexToolNames(events)

  return events.flatMap((event): EvalTraceEntry[] => {
    if (event.type === "agent.assistant") return []

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
          toolName: toolUseId ? toolNames.get(toolUseId) ?? null : null,
          output: formatToolOutput(event.payload.content),
          isError: event.payload.isError === true,
        },
      ]
    }

    return [{ kind: "event", event, sequence: event.sequence }]
  })
}
