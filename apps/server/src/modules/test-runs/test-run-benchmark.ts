import type {
  StoredBenchmarkSide,
  TestRunCaseSide,
} from "../../infrastructure/database/index.js"
import type {
  TestRunCaseView,
  TestRunDetailView,
} from "./test-run.domain.js"

function emptySide(): StoredBenchmarkSide {
  return {
    executed: 0,
    executionFailed: 0,
    passed: 0,
    failed: 0,
    insufficientEvidence: 0,
    notEvaluated: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
  }
}

function summarizeSide(
  cases: readonly TestRunCaseView[],
  side: TestRunCaseSide,
): StoredBenchmarkSide {
  const summary = { ...emptySide() }
  for (const runCase of cases) {
    if (runCase.side !== side) continue
    if (runCase.executionStatus === "COMPLETED") {
      summary.executed += 1
    } else {
      summary.executionFailed += 1
    }
    if (runCase.usage) {
      summary.durationMs += runCase.usage.durationMs
      summary.inputTokens += runCase.usage.inputTokens
      summary.outputTokens += runCase.usage.outputTokens
      summary.totalCostUsd += runCase.usage.totalCostUsd
    }
    for (const result of runCase.assertionResults) {
      if (result.status === "PASSED") summary.passed += 1
      if (result.status === "FAILED") summary.failed += 1
      if (result.status === "INSUFFICIENT_EVIDENCE") {
        summary.insufficientEvidence += 1
      }
      if (result.status === "NOT_EVALUATED") {
        summary.notEvaluated += 1
      }
    }
  }
  return summary
}

export function calculateTestRunBenchmark(
  run: TestRunDetailView,
): {
  readonly target: StoredBenchmarkSide
  readonly baseline: StoredBenchmarkSide
} {
  return {
    target: summarizeSide(run.cases, "TARGET"),
    baseline: summarizeSide(run.cases, "BASELINE"),
  }
}
