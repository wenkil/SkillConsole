import { describe, expect, it } from "vitest"

import { buildEvalTraceEntries } from "./eval-trace"
import type { EvalGenerationEvent } from "./evals"

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
): EvalGenerationEvent {
  return {
    sequence,
    type,
    taskId: "task-1",
    occurredAt: "2026-07-30T00:00:00.000Z",
    payload,
  }
}

describe("buildEvalTraceEntries", () => {
  it("omits assistant messages and pairs tool results with tool names", () => {
    const entries = buildEvalTraceEntries([
      event(1, "task.created", {}),
      event(2, "agent.assistant", {
        content: [{ type: "text", text: "analysis" }],
      }),
      event(3, "agent.assistant", {
        content: [
          {
            type: "tool_use",
            toolUseId: "tool-1",
            name: "Write",
            input: { file_path: "/workspace/output/evals.json" },
          },
        ],
      }),
      event(4, "agent.tool", {
        toolUseId: "tool-1",
        content: "File written successfully.",
        isError: false,
      }),
    ])

    expect(entries).toEqual([
      {
        kind: "event",
        event: expect.objectContaining({ type: "task.created" }),
        sequence: 1,
      },
      {
        kind: "tool",
        event: expect.objectContaining({ type: "agent.tool" }),
        sequence: 4,
        toolName: "Write",
        output: "File written successfully.",
        isError: false,
      },
    ])
  })

  it("formats structured tool output and preserves failures", () => {
    const entries = buildEvalTraceEntries([
      event(1, "agent.tool", {
        toolUseId: "unknown-tool",
        content: { stdout: "done", exitCode: 1 },
        isError: true,
      }),
    ])

    expect(entries[0]).toMatchObject({
      kind: "tool",
      toolName: null,
      output: '{\n  "stdout": "done",\n  "exitCode": 1\n}',
      isError: true,
    })
  })
})
