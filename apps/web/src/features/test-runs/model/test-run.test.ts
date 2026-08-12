import { describe, expect, it } from "vitest"

import {
  getCoverageRate,
  getPassRate,
  isActiveTestRun,
  isBenchmarkComparable,
  type TestRunBenchmarkSide,
} from "@/features/test-runs/model/test-run"

describe("test run model", () => {
  const partialSide: TestRunBenchmarkSide = {
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
  }

  it("separates pass rate for graded assertions from grading coverage", () => {
    expect(getPassRate(partialSide)).toBe(0.5)
    expect(getCoverageRate(partialSide)).toBe(0.6)
    expect(
      getPassRate({
        ...partialSide,
        passed: 0,
        failed: 0,
        insufficientEvidence: 2,
        notEvaluated: 4,
      }),
    ).toBe(0)
    expect(
      getPassRate({
        ...partialSide,
        passed: 0,
        failed: 0,
        insufficientEvidence: 0,
      }),
    ).toBeNull()
  })

  it("only compares benchmarks with complete execution and grading coverage", () => {
    expect(
      isBenchmarkComparable({
        target: partialSide,
        baseline: { ...partialSide, notEvaluated: 0 },
      }),
    ).toBe(false)
    expect(
      isBenchmarkComparable({
        target: { ...partialSide, notEvaluated: 0 },
        baseline: { ...partialSide, notEvaluated: 0 },
      }),
    ).toBe(true)
    expect(
      isBenchmarkComparable({
        target: { ...partialSide, notEvaluated: 0 },
        baseline: {
          ...partialSide,
          executionFailed: 1,
          notEvaluated: 0,
        },
      }),
    ).toBe(false)
  })

  it("treats preparation, execution, scoring, and cancellation as active", () => {
    expect(isActiveTestRun("PREPARING")).toBe(true)
    expect(isActiveTestRun("SCORING")).toBe(true)
    expect(isActiveTestRun("CANCELING")).toBe(true)
    expect(isActiveTestRun("COMPLETED")).toBe(false)
  })
})
