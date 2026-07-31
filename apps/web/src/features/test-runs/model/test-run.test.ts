import { describe, expect, it } from "vitest"

import {
  getPassRate,
  isActiveTestRun,
} from "@/features/test-runs/model/test-run"

describe("test run model", () => {
  it("keeps inconclusive and unevaluated assertions in the pass-rate denominator", () => {
    expect(
      getPassRate({
        executed: 2,
        executionFailed: 0,
        passed: 3,
        failed: 1,
        insufficientEvidence: 2,
        notEvaluated: 4,
        durationMs: 1,
        inputTokens: 1,
        outputTokens: 1,
        totalCostUsd: 0,
      }),
    ).toBe(0.3)
    expect(
      getPassRate({
        executed: 0,
        executionFailed: 0,
        passed: 0,
        failed: 0,
        insufficientEvidence: 2,
        notEvaluated: 4,
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsd: 0,
      }),
    ).toBe(0)
  })

  it("treats preparation, execution, scoring, and cancellation as active", () => {
    expect(isActiveTestRun("PREPARING")).toBe(true)
    expect(isActiveTestRun("SCORING")).toBe(true)
    expect(isActiveTestRun("CANCELING")).toBe(true)
    expect(isActiveTestRun("COMPLETED")).toBe(false)
  })
})
