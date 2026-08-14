import { createHash, randomUUID } from "node:crypto"

import type {
  AssertionResultStatus,
  StoredTestRunUsage,
  TestReportCaseOutcome,
  TestReportComparabilityStatus,
} from "../../infrastructure/database/index.js"
import type {
  TestRunCaseView,
  TestRunDetailView,
} from "../test-runs/test-run.domain.js"
import {
  type ReportAssertionRowView,
  type ReportCaseSummary,
  type ReportIssue,
  type ReportMetricValue,
  type ReportSideMetrics,
  type ReportSubject,
  type StructuredTestReportV1,
  testReportGeneratorVersion,
  testReportSchemaVersion,
} from "./test-report.domain.js"

const zeroUsage: StoredTestRunUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalCostUsd: 0,
  durationMs: 0,
  durationApiMs: 0,
  numTurns: 0,
})

type TerminalRunStatus =
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "INTERRUPTED"

function isTerminalRunStatus(status: string): status is TerminalRunStatus {
  return ["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
    status,
  )
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value))
}

function issueIdentifier(input: {
  readonly kind: string
  readonly evalRevisionCaseId: string
  readonly side: "TARGET" | "BASELINE" | null
  readonly assertionIndex: number | null
}): string {
  return `issue-${stableHash(input).slice(0, 24)}`
}

function ratio(
  numerator: number,
  denominator: number,
  emptyStatus: ReportMetricValue["status"] = "MISSING_DATA",
  emptyReason = "No eligible observations are available.",
): ReportMetricValue {
  return denominator > 0
    ? {
        value: numerator / denominator,
        numerator,
        denominator,
        status: "AVAILABLE",
        reason: null,
      }
    : {
        value: null,
        numerator,
        denominator,
        status: emptyStatus,
        reason: emptyReason,
      }
}

function addUsage(
  left: StoredTestRunUsage,
  right: StoredTestRunUsage,
): StoredTestRunUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationInputTokens:
      left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    cacheReadInputTokens:
      left.cacheReadInputTokens + right.cacheReadInputTokens,
    totalCostUsd: left.totalCostUsd + right.totalCostUsd,
    durationMs: left.durationMs + right.durationMs,
    durationApiMs: left.durationApiMs + right.durationApiMs,
    numTurns: left.numTurns + right.numTurns,
  }
}

function sumUsage(
  cases: readonly TestRunCaseView[],
  field: "usage" | "gradingUsage",
): StoredTestRunUsage {
  return cases.reduce(
    (total, runCase) =>
      addUsage(total, runCase[field] ?? zeroUsage),
    zeroUsage,
  )
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function p95(values: readonly number[]): number | null {
  if (values.length < 5) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null
}

function resultStatus(
  runCase: TestRunCaseView | null,
  index: number,
): AssertionResultStatus | null {
  if (!runCase) return null
  if (
    runCase.executionStatus !== "COMPLETED" ||
    runCase.assessmentStatus !== "COMPLETED"
  ) {
    return "NOT_EVALUATED"
  }
  return (
    runCase.assertionResults.find(
      (result) => result.assertionIndex === index,
    )?.status ?? "NOT_EVALUATED"
  )
}

function caseOutcome(
  runCase: TestRunCaseView | null,
): TestReportCaseOutcome | null {
  if (!runCase) return null
  if (runCase.executionStatus === "CANCELED") return "CANCELED"
  if (runCase.executionStatus === "INTERRUPTED") return "INTERRUPTED"
  if (runCase.executionStatus === "FAILED") return "EXECUTION_ERROR"
  if (runCase.executionStatus !== "COMPLETED") return "INCONCLUSIVE"
  if (runCase.assessmentStatus === "FAILED") return "ASSESSMENT_ERROR"
  if (runCase.assessmentStatus !== "COMPLETED") return "INCONCLUSIVE"
  const statuses = runCase.assertions.map((_, index) =>
    resultStatus(runCase, index),
  )
  if (statuses.some((status) => status === "FAILED")) return "FAILED"
  if (
    statuses.length === 0 ||
    statuses.some(
      (status) =>
        status === "INSUFFICIENT_EVIDENCE" ||
        status === "NOT_EVALUATED",
    )
  ) {
    return "INCONCLUSIVE"
  }
  return statuses.every((status) => status === "PASSED")
    ? "PASSED"
    : "INCONCLUSIVE"
}

function assertionTransition(
  mode: TestRunDetailView["mode"],
  baseline: AssertionResultStatus | null,
  target: AssertionResultStatus | null,
): ReportAssertionRowView["transition"] {
  if (
    !baseline ||
    !target ||
    !["PASSED", "FAILED"].includes(baseline) ||
    !["PASSED", "FAILED"].includes(target)
  ) {
    return "INCONCLUSIVE"
  }
  if (mode === "version_vs_version") {
    if (baseline === "PASSED" && target === "PASSED") {
      return "STABLE_PASS"
    }
    if (baseline === "FAILED" && target === "PASSED") return "FIXED"
    if (baseline === "PASSED" && target === "FAILED") {
      return "REGRESSION"
    }
    return "PERSISTENT_FAIL"
  }
  if (baseline === "FAILED" && target === "PASSED") {
    return "SKILL_GAIN"
  }
  if (baseline === "PASSED" && target === "FAILED") {
    return "SKILL_DEGRADATION"
  }
  return baseline === "PASSED" ? "BOTH_PASS" : "BOTH_FAIL"
}

function normalizeOutput(value: string): string {
  return value.replaceAll("\r\n", "\n").replace(/[ \t]+$/gmu, "")
}

function observedBundledScriptUses(
  runCase: TestRunCaseView,
  declaredScripts: readonly string[],
) {
  const declared = new Set(
    declaredScripts.map((path) => path.replaceAll("\\", "/")),
  )
  return runCase.bundledScriptUses.filter((item) =>
    declared.has(item.relativePath.replaceAll("\\", "/")),
  )
}

function outputDiff(
  target: TestRunCaseView | null,
  baseline: TestRunCaseView | null,
): ReportCaseSummary["outputDiff"] {
  const targetOutput = target?.finalOutput ?? null
  const baselineOutput = baseline?.finalOutput ?? null
  return {
    rawEqual:
      targetOutput === null || baselineOutput === null
        ? null
        : targetOutput === baselineOutput,
    normalizedEqual:
      targetOutput === null || baselineOutput === null
        ? null
        : normalizeOutput(targetOutput) === normalizeOutput(baselineOutput),
    targetSha256: targetOutput === null ? null : sha256(targetOutput),
    baselineSha256:
      baselineOutput === null ? null : sha256(baselineOutput),
    targetCharacters: targetOutput?.length ?? null,
    baselineCharacters: baselineOutput?.length ?? null,
    characterDelta:
      targetOutput === null || baselineOutput === null
        ? null
        : targetOutput.length - baselineOutput.length,
    targetLines: targetOutput === null ? null : targetOutput.split("\n").length,
    baselineLines:
      baselineOutput === null ? null : baselineOutput.split("\n").length,
    lineDelta:
      targetOutput === null || baselineOutput === null
        ? null
        : targetOutput.split("\n").length -
          baselineOutput.split("\n").length,
  }
}

function artifactDiff(
  target: TestRunCaseView | null,
  baseline: TestRunCaseView | null,
): ReportCaseSummary["artifactDiff"] {
  const targetByPath = new Map(
    (target?.artifacts ?? []).map((item) => [item.relativePath, item.sha256]),
  )
  const baselineByPath = new Map(
    (baseline?.artifacts ?? []).map((item) => [item.relativePath, item.sha256]),
  )
  const paths = [...new Set([...targetByPath.keys(), ...baselineByPath.keys()])]
    .sort()
  return {
    added: paths.filter(
      (path) => targetByPath.has(path) && !baselineByPath.has(path),
    ),
    removed: paths.filter(
      (path) => !targetByPath.has(path) && baselineByPath.has(path),
    ),
    changed: paths.filter(
      (path) =>
        targetByPath.has(path) &&
        baselineByPath.has(path) &&
        targetByPath.get(path) !== baselineByPath.get(path),
    ),
    unchanged: paths.filter(
      (path) =>
        targetByPath.has(path) &&
        baselineByPath.has(path) &&
        targetByPath.get(path) === baselineByPath.get(path),
    ),
  }
}

function caseUsageDelta(
  target: TestRunCaseView | null,
  baseline: TestRunCaseView | null,
): ReportCaseSummary["usageDelta"] {
  if (!target || !baseline) {
    return {
      executionCostUsd: null,
      gradingCostUsd: null,
      activeDurationMs: null,
      inputTokens: null,
      outputTokens: null,
    }
  }
  const targetExecution = target.usage
  const baselineExecution = baseline.usage
  const targetGrading = target.gradingUsage
  const baselineGrading = baseline.gradingUsage
  const hasCompleteCombinedUsage =
    targetExecution !== null &&
    baselineExecution !== null &&
    targetGrading !== null &&
    baselineGrading !== null
  return {
    executionCostUsd:
      targetExecution && baselineExecution
        ? targetExecution.totalCostUsd - baselineExecution.totalCostUsd
        : null,
    gradingCostUsd:
      targetGrading && baselineGrading
        ? targetGrading.totalCostUsd - baselineGrading.totalCostUsd
        : null,
    activeDurationMs:
      hasCompleteCombinedUsage
        ? targetExecution.durationMs +
          targetGrading.durationMs -
          baselineExecution.durationMs -
          baselineGrading.durationMs
        : null,
    inputTokens:
      hasCompleteCombinedUsage
        ? targetExecution.inputTokens +
          targetGrading.inputTokens -
          baselineExecution.inputTokens -
          baselineGrading.inputTokens
        : null,
    outputTokens:
      hasCompleteCombinedUsage
        ? targetExecution.outputTokens +
          targetGrading.outputTokens -
          baselineExecution.outputTokens -
          baselineGrading.outputTokens
        : null,
  }
}

function caseClassification(
  transitions: readonly ReportAssertionRowView["transition"][],
): string {
  const negative = transitions.filter((transition) =>
    ["REGRESSION", "SKILL_DEGRADATION"].includes(transition),
  )
  const positive = transitions.filter((transition) =>
    ["FIXED", "SKILL_GAIN"].includes(transition),
  )
  if (negative.length > 0 && positive.length > 0) return "MIXED"
  if (negative.length > 0) return negative[0]!
  if (positive.length > 0) return positive[0]!
  const decisive = transitions.filter(
    (transition) => transition !== "INCONCLUSIVE",
  )
  if (decisive.length === 0) return "INCONCLUSIVE"
  return decisive.every((transition) => transition === decisive[0])
    ? decisive[0]!
    : "INCONCLUSIVE"
}

function buildSideMetrics(
  cases: readonly TestRunCaseView[],
  evalCases: readonly {
    readonly id: string
    readonly assertions: readonly string[]
  }[],
  declaredScripts: readonly string[],
  installsSkill: boolean,
  wallClockDurationMs: number | null,
): ReportSideMetrics {
  const outcomes = cases.map(caseOutcome)
  const casesByEval = new Map(
    cases.map((runCase) => [runCase.evalRevisionCaseId, runCase]),
  )
  const assertionStatuses = evalCases.flatMap((evalCase) =>
    evalCase.assertions.map(
      (_, index) =>
        resultStatus(casesByEval.get(evalCase.id) ?? null, index) ??
        "NOT_EVALUATED",
    ),
  )
  const passed = assertionStatuses.filter((status) => status === "PASSED").length
  const failed = assertionStatuses.filter((status) => status === "FAILED").length
  const insufficientEvidence = assertionStatuses.filter(
    (status) => status === "INSUFFICIENT_EVIDENCE",
  ).length
  const notEvaluated = assertionStatuses.filter(
    (status) => status === "NOT_EVALUATED",
  ).length
  const applicable = cases.filter(
    (runCase) =>
      runCase.executionStatus === "COMPLETED" &&
      runCase.skillInvocationObserved !== "NOT_APPLICABLE",
  )
  const observed = applicable.filter(
    (runCase) => runCase.skillInvocationObserved === "OBSERVED",
  ).length
  const notObserved = applicable.filter(
    (runCase) => runCase.skillInvocationObserved === "NOT_OBSERVED",
  ).length
  const eligibleScriptCases = declaredScripts.length > 0 ? applicable : []
  const scriptObservedCases = eligibleScriptCases.filter(
    (runCase) =>
      observedBundledScriptUses(runCase, declaredScripts).length > 0,
  ).length
  const execution = sumUsage(cases, "usage")
  const grading = sumUsage(cases, "gradingUsage")
  const activeDurations = cases
    .filter((runCase) => runCase.usage || runCase.gradingUsage)
    .map(
      (runCase) =>
        (runCase.usage?.durationMs ?? 0) +
        (runCase.gradingUsage?.durationMs ?? 0),
    )
  const artifacts = cases.flatMap((runCase) => runCase.artifacts)
  return {
    caseQuality: {
      expectedCaseCount: evalCases.length,
      completedCaseCount: cases.filter(
        (runCase) => runCase.executionStatus === "COMPLETED",
      ).length,
      passedCaseCount: outcomes.filter((outcome) => outcome === "PASSED").length,
      failedCaseCount: outcomes.filter((outcome) => outcome === "FAILED").length,
      inconclusiveCaseCount: outcomes.filter(
        (outcome) =>
          outcome !== null && outcome !== "PASSED" && outcome !== "FAILED",
      ).length,
      executionCompletionRate: ratio(
        cases.filter((runCase) => runCase.executionStatus === "COMPLETED").length,
        evalCases.length,
      ),
      casePassRate: ratio(
        outcomes.filter((outcome) => outcome === "PASSED").length,
        outcomes.filter(
          (outcome) => outcome === "PASSED" || outcome === "FAILED",
        ).length,
      ),
    },
    assertions: {
      total: assertionStatuses.length,
      passed,
      failed,
      insufficientEvidence,
      notEvaluated,
      decisivePassRate: ratio(passed, passed + failed),
      assessmentCoverageRate: ratio(
        passed + failed + insufficientEvidence,
        assertionStatuses.length,
      ),
      decisiveCoverageRate: ratio(passed + failed, assertionStatuses.length),
    },
    activation: {
      applicableCaseCount: applicable.length,
      observedCaseCount: observed,
      notObservedCaseCount: notObserved,
      missingObservationCaseCount: applicable.length - observed - notObserved,
      observedRate: ratio(
        observed,
        observed + notObserved,
        installsSkill ? "MISSING_DATA" : "NOT_APPLICABLE",
        !installsSkill
          ? "This side does not install a Skill."
          : "No completed Skill Case has an invocation observation fact.",
      ),
      observationCoverageRate: ratio(
        observed + notObserved,
        applicable.length,
        installsSkill ? "MISSING_DATA" : "NOT_APPLICABLE",
        !installsSkill
          ? "This side does not install a Skill."
          : "No completed Skill Cases are available.",
      ),
      skillToolCallCount: applicable.reduce(
        (total, runCase) => total + runCase.skillToolCallCount,
        0,
      ),
    },
    bundledScripts: {
      declaredScriptCount: declaredScripts.length,
      eligibleCaseCount: eligibleScriptCases.length,
      observedCaseCount: scriptObservedCases,
      callCount: eligibleScriptCases.reduce(
        (total, runCase) =>
          total +
          observedBundledScriptUses(runCase, declaredScripts).reduce(
            (caseTotal, item) => caseTotal + item.count,
            0,
          ),
        0,
      ),
      observedDistinctScriptCount: new Set(
        eligibleScriptCases.flatMap((runCase) =>
          observedBundledScriptUses(runCase, declaredScripts).map((item) =>
            item.relativePath.replaceAll("\\", "/"),
          ),
        ),
      ).size,
      observedCaseRate: ratio(
        scriptObservedCases,
        eligibleScriptCases.length,
        declaredScripts.length === 0 ? "NOT_APPLICABLE" : "MISSING_DATA",
        declaredScripts.length === 0
          ? "The frozen Skill Snapshot declares no bundled scripts."
          : "No completed Skill Cases are eligible for script observation.",
      ),
    },
    usage: {
      execution,
      grading,
      combined: addUsage(execution, grading),
      wallClockDurationMs,
      medianCaseDurationMs: median(activeDurations),
      p95CaseDurationMs: p95(activeDurations),
      distributionSampleCount: activeDurations.length,
    },
    artifacts: {
      count: artifacts.length,
      totalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
      textCount: artifacts.filter((artifact) => artifact.contentKind === "text").length,
      binaryCount: artifacts.filter((artifact) => artifact.contentKind === "binary").length,
    },
    outputConsistency: {
      status: "INSUFFICIENT_SAMPLE",
      sampleCount: 1,
      value: null,
      reason: "At least two comparable repetitions are required.",
    },
  }
}

function subjectForSide(
  run: TestRunDetailView,
  side: "TARGET" | "BASELINE",
  declaredBundledScripts: readonly string[],
): ReportSubject {
  if (side === "BASELINE" && run.baseline.kind === "no_skill") {
    return {
      side,
      kind: "no_skill",
      label: "No-Skill Baseline",
      versionId: null,
      versionName: null,
      versionNumber: null,
      snapshotId: null,
      manifestHash: null,
      declaredBundledScripts: [],
    }
  }
  if (side === "BASELINE") {
    if (run.baseline.kind !== "skill_version") {
      throw new Error("A version comparison Baseline must be a Skill version.")
    }
    return {
      side,
      kind: "skill_version",
      label: `${run.baseline.skillVersionName} R${run.baseline.skillVersionNumber}`,
      versionId: run.baseline.skillVersionId,
      versionName: run.baseline.skillVersionName,
      versionNumber: run.baseline.skillVersionNumber,
      snapshotId: run.baseline.skillSnapshotId,
      manifestHash: run.baseline.skillManifestHash,
      declaredBundledScripts,
    }
  }
  const isDraftSnapshot = run.target.draftRevisionId !== null
  return {
    side,
    kind: isDraftSnapshot ? "draft_snapshot" : "skill_version",
    label:
      !isDraftSnapshot && run.target.skillVersionName
        ? `${run.target.skillVersionName} R${run.target.skillVersionNumber}`
        : "Frozen working copy",
    versionId: isDraftSnapshot ? null : run.target.skillVersionId,
    versionName: isDraftSnapshot ? null : run.target.skillVersionName,
    versionNumber: isDraftSnapshot ? null : run.target.skillVersionNumber,
    snapshotId: run.target.skillSnapshotId,
    manifestHash: run.traceability.skillManifestHash,
    declaredBundledScripts,
  }
}

export interface BuildTestReportInput {
  readonly run: TestRunDetailView
  readonly reportId: string
  readonly revisionId: string
  readonly revisionNumber: number
  readonly generatedAt: string
  readonly targetBundledScripts: readonly string[]
  readonly baselineBundledScripts: readonly string[]
  readonly lastEventSequence: number | null
  readonly evalCases: readonly {
    readonly id: string
    readonly externalId: number
    readonly name: string
    readonly assertions: readonly string[]
  }[]
}

export function buildStructuredTestReport(
  input: BuildTestReportInput,
): StructuredTestReportV1 {
  const { run } = input
  if (!isTerminalRunStatus(run.status)) {
    throw new Error("A structured report requires a terminal test Run.")
  }
  const wallClockDurationMs =
    run.startedAt && run.completedAt
      ? Math.max(
          0,
          new Date(run.completedAt).getTime() -
            new Date(run.startedAt).getTime(),
        )
      : null
  const targetCases = run.cases.filter((runCase) => runCase.side === "TARGET")
  const baselineCases = run.cases.filter(
    (runCase) => runCase.side === "BASELINE",
  )
  const evalCases = [...input.evalCases].sort(
    (left, right) => left.externalId - right.externalId,
  )
  const caseIds = evalCases.map((evalCase) => evalCase.id)
  const evalCaseIds = new Set(caseIds)
  const unexpectedRunCaseCount = run.cases.filter(
    (runCase) => !evalCaseIds.has(runCase.evalRevisionCaseId),
  ).length
  const caseCardinalityMismatch =
    evalCases.length !== run.target.evalCount || unexpectedRunCaseCount > 0
  const targetByEval = new Map(
    targetCases.map((runCase) => [runCase.evalRevisionCaseId, runCase]),
  )
  const baselineByEval = new Map(
    baselineCases.map((runCase) => [runCase.evalRevisionCaseId, runCase]),
  )
  const missingTargetCaseCount = caseIds.filter(
    (id) => !targetByEval.has(id),
  ).length
  const missingBaselineCaseCount = caseIds.filter(
    (id) => !baselineByEval.has(id),
  ).length
  const hasNotEvaluatedAssertion = evalCases.some((evalCase) =>
    [targetByEval.get(evalCase.id) ?? null, baselineByEval.get(evalCase.id) ?? null]
      .some((runCase) =>
        evalCase.assertions.some(
          (_, index) =>
            (resultStatus(runCase, index) ?? "NOT_EVALUATED") ===
            "NOT_EVALUATED",
        ),
      ),
  )
  const inputMismatch = caseIds.some((id) => {
    const target = targetByEval.get(id)
    const baseline = baselineByEval.get(id)
    return target && baseline && target.inputFingerprint !== baseline.inputFingerprint
  })
  const missingExecutionUsageCount = run.cases.filter(
    (runCase) =>
      runCase.executionStatus === "COMPLETED" && runCase.usage === null,
  ).length
  const missingGradingUsageCount = run.cases.filter(
    (runCase) =>
      runCase.assessmentStatus === "COMPLETED" &&
      runCase.gradingUsage === null,
  ).length
  const partialFacts =
    run.status !== "COMPLETED" ||
    caseCardinalityMismatch ||
    missingTargetCaseCount > 0 ||
    missingBaselineCaseCount > 0 ||
    hasNotEvaluatedAssertion ||
    missingExecutionUsageCount > 0 ||
    missingGradingUsageCount > 0 ||
    run.cases.some(
      (runCase) =>
        runCase.executionStatus !== "COMPLETED" ||
        runCase.assessmentStatus !== "COMPLETED",
    )
  let comparabilityStatus: TestReportComparabilityStatus
  const comparabilityReasons: string[] = []
  if (inputMismatch) {
    comparabilityStatus = "NOT_COMPARABLE"
    comparabilityReasons.push("Paired Cases do not share the same input fingerprint.")
  } else if (run.environment.status === "legacy_unavailable") {
    comparabilityStatus = "UNKNOWN_LEGACY"
    comparabilityReasons.push("The historical Run has no frozen environment snapshot.")
  } else if (partialFacts) {
    comparabilityStatus = "COMPARABLE_WITH_LIMITATIONS"
    comparabilityReasons.push("One or more paired execution or grading facts are incomplete.")
  } else {
    comparabilityStatus = "COMPARABLE"
  }

  const issues: ReportIssue[] = []
  const transitionCounts: Record<string, number> = {}
  const cases: ReportCaseSummary[] = evalCases
    .map((evalCase) => {
      const evalRevisionCaseId = evalCase.id
      const target = targetByEval.get(evalRevisionCaseId) ?? null
      const baseline = baselineByEval.get(evalRevisionCaseId) ?? null
      const assertionCount = Math.max(
        evalCase.assertions.length,
        target?.assertions.length ?? 0,
        baseline?.assertions.length ?? 0,
      )
      const pairEvidenceRefs = [
        ...(baseline
          ? [{ kind: "RUN_CASE" as const, caseId: baseline.id }]
          : []),
        ...(target
          ? [{ kind: "RUN_CASE" as const, caseId: target.id }]
          : []),
      ]
      for (const [side, runCase] of [
        ["BASELINE", baseline],
        ["TARGET", target],
      ] as const) {
        if (runCase) continue
        issues.push({
          id: issueIdentifier({
            kind: "NOT_EVALUATED",
            evalRevisionCaseId,
            side,
            assertionIndex: null,
          }),
          kind: "NOT_EVALUATED",
          triage: "BLOCKING_EVIDENCE",
          scope: "HARNESS",
          evalRevisionCaseId,
          externalId: evalCase.externalId,
          side,
          assertionIndex: null,
          title: `${side} Case is missing from the terminal Run`,
          evidenceRefs: [],
        })
      }
      if (
        target &&
        baseline &&
        target.inputFingerprint !== baseline.inputFingerprint
      ) {
        issues.push({
          id: issueIdentifier({
            kind: "INPUT_MISMATCH",
            evalRevisionCaseId,
            side: null,
            assertionIndex: null,
          }),
          kind: "INPUT_MISMATCH",
          triage: "BLOCKING_EVIDENCE",
          scope: "HARNESS",
          evalRevisionCaseId,
          externalId: evalCase.externalId,
          side: null,
          assertionIndex: null,
          title: "Paired Cases do not share the same input fingerprint",
          evidenceRefs: pairEvidenceRefs,
        })
      }
      if (run.environment.status === "legacy_unavailable") {
        issues.push({
          id: issueIdentifier({
            kind: "LEGACY_TRACEABILITY_LIMITATION",
            evalRevisionCaseId,
            side: null,
            assertionIndex: null,
          }),
          kind: "LEGACY_TRACEABILITY_LIMITATION",
          triage: "INFORMATIONAL",
          scope: "ENVIRONMENT",
          evalRevisionCaseId,
          externalId: evalCase.externalId,
          side: null,
          assertionIndex: null,
          title: "Historical environment and protocol facts are unavailable",
          evidenceRefs: pairEvidenceRefs,
        })
      }
      const transitions: ReportAssertionRowView[] = Array.from(
        { length: assertionCount },
        (_, assertionIndex) => {
          const baselineStatus = resultStatus(baseline, assertionIndex)
          const targetStatus = resultStatus(target, assertionIndex)
          const baselineResult = baseline?.assertionResults.find(
            (result) => result.assertionIndex === assertionIndex,
          )
          const targetResult = target?.assertionResults.find(
            (result) => result.assertionIndex === assertionIndex,
          )
          const transition =
            comparabilityStatus === "NOT_COMPARABLE"
              ? "INCONCLUSIVE"
              : assertionTransition(run.mode, baselineStatus, targetStatus)
          transitionCounts[transition] = (transitionCounts[transition] ?? 0) + 1
          const evidenceRefs = [
            ...(baselineResult
              ? [
                  {
                    kind: "ASSERTION" as const,
                    assertionResultId: baselineResult.id,
                  },
                ]
              : []),
            ...(targetResult
              ? [
                  {
                    kind: "ASSERTION" as const,
                    assertionResultId: targetResult.id,
                  },
                ]
              : []),
          ]
          if (
            [
              "REGRESSION",
              "SKILL_DEGRADATION",
              "PERSISTENT_FAIL",
              "BOTH_FAIL",
            ].includes(transition)
          ) {
            const kind =
              transition === "REGRESSION"
                ? "REGRESSION"
                : transition === "SKILL_DEGRADATION"
                  ? "SKILL_DEGRADATION"
                  : transition === "BOTH_FAIL"
                    ? "BOTH_FAILED"
                    : "PERSISTENT_FAILURE"
            issues.push({
              id: issueIdentifier({
                kind,
                evalRevisionCaseId,
                side: transition === "PERSISTENT_FAIL" || transition === "BOTH_FAIL" ? null : "TARGET",
                assertionIndex,
              }),
              kind,
              triage: "ACTIONABLE_RESULT",
              scope: "UNKNOWN",
              evalRevisionCaseId,
              externalId: evalCase.externalId,
              side:
                transition === "PERSISTENT_FAIL" || transition === "BOTH_FAIL"
                  ? null
                  : "TARGET",
              assertionIndex,
              title: `Assertion ${assertionIndex + 1}: ${transition}`,
              evidenceRefs,
            })
          }
          for (const [side, status, result] of [
            ["BASELINE", baselineStatus, baselineResult],
            ["TARGET", targetStatus, targetResult],
          ] as const) {
            if (
              status !== "INSUFFICIENT_EVIDENCE" &&
              status !== "NOT_EVALUATED"
            ) {
              continue
            }
            const kind =
              status === "NOT_EVALUATED"
                ? "NOT_EVALUATED"
                : "INSUFFICIENT_EVIDENCE"
            issues.push({
              id: issueIdentifier({
                kind,
                evalRevisionCaseId,
                side,
                assertionIndex,
              }),
              kind,
              triage:
                kind === "NOT_EVALUATED"
                  ? "BLOCKING_EVIDENCE"
                  : "INVESTIGATE",
              scope: "UNKNOWN",
              evalRevisionCaseId,
              externalId: evalCase.externalId,
              side,
              assertionIndex,
              title:
                kind === "NOT_EVALUATED"
                  ? `${side} Assertion ${assertionIndex + 1} was not evaluated`
                  : `${side} Assertion ${assertionIndex + 1} has insufficient evidence`,
              evidenceRefs: result
                ? [{ kind: "ASSERTION", assertionResultId: result.id }]
                : pairEvidenceRefs.filter(
                    (reference) =>
                      reference.caseId ===
                      (side === "TARGET" ? target?.id : baseline?.id),
                  ),
            })
          }
          return {
            assertionIndex,
            assertion:
              evalCase.assertions[assertionIndex] ??
              target?.assertions[assertionIndex] ??
              baseline?.assertions[assertionIndex] ??
              "Assertion",
            baselineStatus,
            targetStatus,
            transition,
            baselineAssertionResultId: baselineResult?.id ?? null,
            targetAssertionResultId: targetResult?.id ?? null,
            evidenceRefs,
          }
        },
      )
      for (const [side, runCase] of [
        ["BASELINE", baseline],
        ["TARGET", target],
      ] as const) {
        if (!runCase) continue
        if (runCase.executionStatus === "FAILED") {
          const bothSidesFailed =
            target?.executionStatus === "FAILED" &&
            baseline?.executionStatus === "FAILED"
          issues.push({
            id: issueIdentifier({
              kind: "EXECUTION_ERROR",
              evalRevisionCaseId,
              side,
              assertionIndex: null,
            }),
            kind: "EXECUTION_ERROR",
            triage: "BLOCKING_EVIDENCE",
            scope: bothSidesFailed ? "HARNESS" : "UNKNOWN",
            evalRevisionCaseId,
            externalId: runCase.externalId,
            side,
            assertionIndex: null,
            title: `${side} execution did not complete`,
            evidenceRefs: [{ kind: "RUN_CASE", caseId: runCase.id }],
          })
        } else if (runCase.assessmentStatus === "FAILED") {
          const bothSidesFailed =
            target?.assessmentStatus === "FAILED" &&
            baseline?.assessmentStatus === "FAILED"
          issues.push({
            id: issueIdentifier({
              kind: "ASSESSMENT_ERROR",
              evalRevisionCaseId,
              side,
              assertionIndex: null,
            }),
            kind: "ASSESSMENT_ERROR",
            triage: "BLOCKING_EVIDENCE",
            scope: bothSidesFailed ? "HARNESS" : "UNKNOWN",
            evalRevisionCaseId,
            externalId: runCase.externalId,
            side,
            assertionIndex: null,
            title: `${side} assessment did not complete`,
            evidenceRefs: [{ kind: "RUN_CASE", caseId: runCase.id }],
          })
        }
        if (
          runCase.executionStatus === "COMPLETED" &&
          runCase.skillInvocationObserved === "NOT_OBSERVED"
        ) {
          issues.push({
            id: issueIdentifier({
              kind: "SKILL_ACTIVATION_NOT_OBSERVED",
              evalRevisionCaseId,
              side,
              assertionIndex: null,
            }),
            kind: "SKILL_ACTIVATION_NOT_OBSERVED",
            triage: "INVESTIGATE",
            scope: "UNKNOWN",
            evalRevisionCaseId,
            externalId: runCase.externalId,
            side,
            assertionIndex: null,
            title: `${side} Skill invocation was not observed`,
            evidenceRefs: [{ kind: "RUN_CASE", caseId: runCase.id }],
          })
        }
        const declaredScripts =
          side === "TARGET"
            ? input.targetBundledScripts
            : input.baselineBundledScripts
        if (
          runCase.executionStatus === "COMPLETED" &&
          declaredScripts.length > 0 &&
          observedBundledScriptUses(runCase, declaredScripts).length === 0
        ) {
          issues.push({
            id: issueIdentifier({
              kind: "BUNDLED_SCRIPT_NOT_OBSERVED",
              evalRevisionCaseId,
              side,
              assertionIndex: null,
            }),
            kind: "BUNDLED_SCRIPT_NOT_OBSERVED",
            triage: "INVESTIGATE",
            scope: "UNKNOWN",
            evalRevisionCaseId,
            externalId: runCase.externalId,
            side,
            assertionIndex: null,
            title: `${side} bundled script use was not observed`,
            evidenceRefs: [{ kind: "RUN_CASE", caseId: runCase.id }],
          })
        }
      }
      const classification = caseClassification(
        transitions.map((item) => item.transition),
      )
      const pairHasIncompleteFacts = [target, baseline].some(
        (runCase) =>
          runCase !== null &&
          (runCase.executionStatus !== "COMPLETED" ||
            runCase.assessmentStatus !== "COMPLETED" ||
            runCase.usage === null ||
            runCase.gradingUsage === null ||
            runCase.assertions.some(
              (_, index) =>
                resultStatus(runCase, index) === "NOT_EVALUATED",
            )),
      )
      const pairComparability: TestReportComparabilityStatus =
        !target || !baseline
          ? "COMPARABLE_WITH_LIMITATIONS"
          : target.inputFingerprint !== baseline.inputFingerprint
            ? "NOT_COMPARABLE"
            : run.environment.status === "legacy_unavailable"
              ? "UNKNOWN_LEGACY"
              : pairHasIncompleteFacts
                ? "COMPARABLE_WITH_LIMITATIONS"
                : "COMPARABLE"
      return {
        evalRevisionCaseId,
        externalId: evalCase.externalId,
        name: evalCase.name,
        pairComparability,
        classification,
        targetCaseId: target?.id ?? null,
        baselineCaseId: baseline?.id ?? null,
        targetOutcome: caseOutcome(target),
        baselineOutcome: caseOutcome(baseline),
        assertionTransitions: transitions,
        outputDiff: outputDiff(target, baseline),
        artifactDiff: artifactDiff(target, baseline),
        usageDelta: caseUsageDelta(target, baseline),
        issueIds: [],
        evidenceRefs: pairEvidenceRefs,
      }
    })
    .sort((left, right) => left.externalId - right.externalId)

  const issuesByCase = new Map<string, string[]>()
  for (const issue of issues) {
    const values = issuesByCase.get(issue.evalRevisionCaseId) ?? []
    values.push(issue.id)
    issuesByCase.set(issue.evalRevisionCaseId, values)
  }
  const hydratedCases = cases.map((item) => ({
    ...item,
    issueIds: issuesByCase.get(item.evalRevisionCaseId) ?? [],
  }))
  const targetMetrics = buildSideMetrics(
    targetCases,
    evalCases,
    input.targetBundledScripts,
    true,
    wallClockDurationMs,
  )
  const baselineMetrics = buildSideMetrics(
    baselineCases,
    evalCases,
    input.baselineBundledScripts,
    run.mode === "version_vs_version",
    wallClockDurationMs,
  )
  const executionErrorCount = run.cases.filter(
    (runCase) => runCase.executionStatus === "FAILED",
  ).length
  const assessmentErrorCount = run.cases.filter(
    (runCase) => runCase.assessmentStatus === "FAILED",
  ).length
  const notEvaluatedAssertionCount =
    targetMetrics.assertions.notEvaluated +
    baselineMetrics.assertions.notEvaluated
  const completenessReasons = [
    ...(run.status !== "COMPLETED" ? [`Run ended as ${run.status}.`] : []),
    ...(caseCardinalityMismatch
      ? [
          `The frozen EvalRevision contains ${evalCases.length} Cases, the Run declares ${run.target.evalCount}, and ${unexpectedRunCaseCount} Run Cases reference an unexpected Eval identity.`,
        ]
      : []),
    ...(missingTargetCaseCount > 0
      ? [`${missingTargetCaseCount} Target Cases are missing.`]
      : []),
    ...(missingBaselineCaseCount > 0
      ? [`${missingBaselineCaseCount} Baseline Cases are missing.`]
      : []),
    ...(executionErrorCount > 0
      ? [`${executionErrorCount} executions failed.`]
      : []),
    ...(assessmentErrorCount > 0
      ? [`${assessmentErrorCount} assessments failed.`]
      : []),
    ...(hasNotEvaluatedAssertion
      ? ["One or more Assertions were not evaluated."]
      : []),
    ...(missingExecutionUsageCount > 0
      ? [
          `${missingExecutionUsageCount} completed executions have no Usage facts; execution totals only include observed Usage.`,
        ]
      : []),
    ...(missingGradingUsageCount > 0
      ? [
          `${missingGradingUsageCount} completed assessments have no grading Usage facts; grading totals only include observed Usage.`,
        ]
      : []),
  ]
  const reportStatus = partialFacts ? "PARTIAL" : "AVAILABLE"
  const targetSubject = subjectForSide(run, "TARGET", input.targetBundledScripts)
  const baselineSubject = subjectForSide(
    run,
    "BASELINE",
    input.baselineBundledScripts,
  )
  const sourceFingerprint = stableHash({
    runId: run.id,
    mode: run.mode,
    status: run.status,
    completedAt: run.completedAt,
    traceability: run.traceability,
    environment: run.environment,
    targetSubject,
    baselineSubject,
    evalCases,
    cases: run.cases.map((runCase) => ({
      id: runCase.id,
      side: runCase.side,
      evalRevisionCaseId: runCase.evalRevisionCaseId,
      inputFingerprint: runCase.inputFingerprint,
      participantExecutionFingerprint: runCase.participantExecutionFingerprint,
      executionStatus: runCase.executionStatus,
      assessmentStatus: runCase.assessmentStatus,
      finalOutputHash:
        runCase.finalOutput === null ? null : sha256(runCase.finalOutput),
      usage: runCase.usage,
      gradingUsage: runCase.gradingUsage,
      skillInvocationObserved: runCase.skillInvocationObserved,
      skillToolCallCount: runCase.skillToolCallCount,
      bundledScriptUses: runCase.bundledScriptUses,
      assertions: runCase.assertionResults.map((result) => ({
        index: result.assertionIndex,
        status: result.status,
        reasonHash: sha256(result.reason),
        evidence: result.evidence,
      })),
      artifacts: runCase.artifacts.map((artifact) => ({
        id: artifact.id,
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
        contentKind: artifact.contentKind,
      })),
    })),
    terminalError: run.error,
    lastEventSequence: input.lastEventSequence,
  })
  const positiveCount =
    (transitionCounts.FIXED ?? 0) + (transitionCounts.SKILL_GAIN ?? 0)
  const negativeCount =
    (transitionCounts.REGRESSION ?? 0) +
    (transitionCounts.SKILL_DEGRADATION ?? 0)
  const issueCounts = issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1
    return counts
  }, {})
  const canCompare =
    comparabilityStatus === "COMPARABLE" ||
    comparabilityStatus === "COMPARABLE_WITH_LIMITATIONS"
  const targetCombined = targetMetrics.usage.combined
  const baselineCombined = baselineMetrics.usage.combined
  const hasCompleteUsageDelta =
    targetCases.length === evalCases.length &&
    baselineCases.length === evalCases.length &&
    [...targetCases, ...baselineCases].every(
      (runCase) => runCase.usage !== null && runCase.gradingUsage !== null,
    )
  return {
    schemaVersion: testReportSchemaVersion,
    generatorVersion: testReportGeneratorVersion,
    reportId: input.reportId,
    reportRevisionId: input.revisionId,
    reportRevisionNumber: input.revisionNumber,
    runId: run.id,
    workspaceId: run.workspaceId,
    reportType:
      run.mode === "version_vs_version"
        ? "version_comparison"
        : "skill_effect",
    status: reportStatus,
    sourceFingerprint,
    generatedAt: input.generatedAt,
    title:
      run.mode === "version_vs_version"
        ? `${targetSubject.label} vs ${baselineSubject.label}`
        : `${targetSubject.label} vs No-Skill Baseline`,
    run: {
      mode: run.mode,
      runStatus: run.status,
      executionPolicy: run.executionPolicy,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      wallClockDurationMs,
      terminalError: run.error
        ? { code: run.error.code, message: run.error.message }
        : null,
    },
    subjects: { baseline: baselineSubject, target: targetSubject },
    evalRevision: {
      id: run.target.evalRevisionId,
      revisionNumber: run.target.evalRevisionNumber,
      manifestHash: run.traceability.evalManifestHash,
      evalCount: evalCases.length,
      caseIds,
    },
    environment: run.environment,
    traceability: run.traceability,
    comparability: {
      status: comparabilityStatus,
      reasons: comparabilityReasons,
      fingerprint: run.traceability.comparabilityFingerprint,
    },
    completeness: {
      expectedPairCount: evalCases.length,
      availablePairCount: caseIds.filter(
        (id) => targetByEval.has(id) && baselineByEval.has(id),
      ).length,
      missingTargetCaseCount,
      missingBaselineCaseCount,
      executionErrorCount,
      assessmentErrorCount,
      notEvaluatedAssertionCount,
      status: partialFacts ? "PARTIAL" : "COMPLETE",
      reasons: completenessReasons,
    },
    metrics: {
      target: targetMetrics,
      baseline: baselineMetrics,
      delta: canCompare
        ? {
            status:
              comparabilityStatus === "COMPARABLE" ? "AVAILABLE" : "PARTIAL",
            assertionPassRateAbsolute:
              targetMetrics.assertions.decisivePassRate.value === null ||
              baselineMetrics.assertions.decisivePassRate.value === null
                ? null
                : targetMetrics.assertions.decisivePassRate.value -
                  baselineMetrics.assertions.decisivePassRate.value,
            casePassRateAbsolute:
              targetMetrics.caseQuality.casePassRate.value === null ||
              baselineMetrics.caseQuality.casePassRate.value === null
                ? null
                : targetMetrics.caseQuality.casePassRate.value -
                  baselineMetrics.caseQuality.casePassRate.value,
            activationObservedRateAbsolute:
              targetMetrics.activation.observedRate.value === null ||
              baselineMetrics.activation.observedRate.value === null
                ? null
                : targetMetrics.activation.observedRate.value -
                  baselineMetrics.activation.observedRate.value,
            bundledScriptObservedRateAbsolute:
              targetMetrics.bundledScripts.observedCaseRate.value === null ||
              baselineMetrics.bundledScripts.observedCaseRate.value === null
                ? null
                : targetMetrics.bundledScripts.observedCaseRate.value -
                  baselineMetrics.bundledScripts.observedCaseRate.value,
            inputTokensAbsolute:
              hasCompleteUsageDelta
                ? targetCombined.inputTokens - baselineCombined.inputTokens
                : null,
            outputTokensAbsolute:
              hasCompleteUsageDelta
                ? targetCombined.outputTokens - baselineCombined.outputTokens
                : null,
            costUsdAbsolute:
              hasCompleteUsageDelta
                ? targetCombined.totalCostUsd - baselineCombined.totalCostUsd
                : null,
            activeDurationMsAbsolute:
              hasCompleteUsageDelta
                ? targetCombined.durationMs - baselineCombined.durationMs
                : null,
            costPercent:
              hasCompleteUsageDelta && baselineCombined.totalCostUsd > 0
                ? (targetCombined.totalCostUsd - baselineCombined.totalCostUsd) /
                  baselineCombined.totalCostUsd
                : null,
            activeDurationPercent:
              hasCompleteUsageDelta && baselineCombined.durationMs > 0
                ? (targetCombined.durationMs - baselineCombined.durationMs) /
                  baselineCombined.durationMs
                : null,
            reasons: comparabilityReasons,
          }
        : null,
    },
    transitions: {
      counts: transitionCounts,
      positiveCount,
      negativeCount,
      inconclusiveCount: transitionCounts.INCONCLUSIVE ?? 0,
    },
    issues: { total: issues.length, counts: issueCounts, items: issues },
    cases: hydratedCases,
    limitations: [
      ...comparabilityReasons.map((message, index) => ({
        code: `COMPARABILITY_${index + 1}`,
        message,
      })),
      ...completenessReasons.map((message, index) => ({
        code: `COMPLETENESS_${index + 1}`,
        message,
      })),
    ],
    analyzer: { status: "NOT_REQUESTED" },
  }
}

export function createReportRevisionIdentity(): {
  readonly revisionId: string
  readonly generatedAt: string
} {
  return { revisionId: randomUUID(), generatedAt: new Date().toISOString() }
}
