export type TestRunStatus =
  | "PREPARING"
  | "RUNNING"
  | "SCORING"
  | "CANCELING"
  | "COMPLETED"
  | "CANCELED"
  | "INTERRUPTED"
  | "FAILED"

export type TestRunMode =
  | "target_vs_no_skill"
  | "version_vs_version"

export type TestRunExecutionPolicy =
  | "target_then_no_skill_serial_v1"
  | "paired_serial_alternating_v1"

export type TestRunLogPhase =
  | "execution"
  | "grading"
  | "orchestration"

export type SkillInvocationObservation =
  | "OBSERVED"
  | "NOT_OBSERVED"
  | "NOT_APPLICABLE"

export interface TestRunRuntimeLimitSnapshot {
  timeoutMs: number
}

export type TestRunEnvironmentSnapshot =
  | { status: "legacy_unavailable" }
  | {
      status: "captured"
      nodeVersion: string
      platform: string
      architecture: string
      sdkVersion: string
      model: string
      apiEndpointHash: string | null
      executionLimits: TestRunRuntimeLimitSnapshot
      gradingLimits: TestRunRuntimeLimitSnapshot
      executionPromptVersion: string
      graderProtocolVersion: string
      toolPermissionPolicyVersion: string
      executionPolicy: TestRunExecutionPolicy
      runtimeCapabilities: Array<{
        capability: string
        commands: Array<{
          name: string
          available: boolean
          version: string | null
        }>
      }>
    }

export type TestRunCaseExecutionStatus =
  | "PENDING"
  | "PREPARING"
  | "RUNNING"
  | "COMPLETED"
  | "CANCELED"
  | "INTERRUPTED"
  | "FAILED"

export type TestRunCaseAssessmentStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "NOT_EVALUATED"
  | "FAILED"

export type TestRunAssertionStatus =
  | "PASSED"
  | "FAILED"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_EVALUATED"

export interface TestRunUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalCostUsd: number
  durationMs: number
  durationApiMs: number
  numTurns: number
}

export interface TestRunBenchmarkSide {
  executed: number
  executionFailed: number
  passed: number
  failed: number
  insufficientEvidence: number
  notEvaluated: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
  gradingDurationMs: number
  gradingInputTokens: number
  gradingOutputTokens: number
  gradingTotalCostUsd: number
  gradingNumTurns: number
}

export interface TestRunView {
  id: string
  workspaceId: string
  mode: TestRunMode
  status: TestRunStatus
  target: {
    draftId: string | null
    draftRevisionId: string | null
    draftContentRevision: number | null
    skillVersionId: string | null
    skillVersionName: string | null
    skillVersionNumber: number | null
    skillSnapshotId: string
    evalRevisionId: string
    evalRevisionNumber: number
    evalCount: number
  }
  baseline:
    | {
        kind: "no_skill"
        skillVersionId: null
        skillSnapshotId: null
      }
    | {
        kind: "skill_version"
        skillVersionId: string
        skillVersionName: string
        skillVersionNumber: number
        skillSnapshotId: string
        skillManifestHash: string
      }
  executionPolicy: TestRunExecutionPolicy
  environment: TestRunEnvironmentSnapshot
  traceability: {
    protocolVersion: string
    sdkVersion: string
    skillCreatorCommit: string
    skillCreatorTreeHash: string
    configurationFingerprint: string
    semanticConfigurationFingerprint: string
    executionSettingsFingerprint: string
    gradingSettingsFingerprint: string
    environmentFingerprint: string
    skillManifestHash: string
    baselineSkillManifestHash: string | null
    evalManifestHash: string
    comparabilityFingerprint: string
    runInputFingerprint: string
    executionPromptVersion: string
    graderProtocolVersion: string
    toolPermissionPolicyVersion: string
  }
  progress: {
    totalCases: number
    completedCases: number
  }
  benchmark: {
    target: TestRunBenchmarkSide
    baseline: TestRunBenchmarkSide
  } | null
  error: {
    code: string
    message: string
    details: Record<string, unknown> | null
  } | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface TestRunCase {
  id: string
  evalRevisionCaseId: string
  externalId: number
  name: string
  side: "TARGET" | "BASELINE"
  executionOrder: number
  prompt: string
  expectedOutput: string
  assertions: string[]
  files: string[]
  inputFingerprint: string
  participantExecutionFingerprint: string
  skillInvocationObserved: SkillInvocationObservation | null
  skillToolCallCount: number
  bundledScriptUses: Array<{
    relativePath: string
    count: number
    evidenceSequences: number[]
  }>
  executionStatus: TestRunCaseExecutionStatus
  assessmentStatus: TestRunCaseAssessmentStatus
  finalOutput: string | null
  usage: TestRunUsage | null
  gradingUsage: TestRunUsage | null
  executionError: { code: string; message: string } | null
  assessmentError: { code: string; message: string } | null
  assertionResults: Array<{
    id: string
    assertionIndex: number
    assertion: string
    status: TestRunAssertionStatus
    reason: string
    evidence: Array<{
      source:
        | "assistant_output"
        | "tool_result"
        | "artifact"
        | "execution_error"
      reference: string
      excerpt: string | null
    }>
  }>
  artifacts: Array<{
    id: string
    relativePath: string
    sha256: string
    byteSize: number
    mediaTypeHint: string
    contentKind: "text" | "binary"
    downloadUrl: string
  }>
  createdAt: string
  updatedAt: string
  startedAt: string | null
  executionCompletedAt: string | null
  assessmentCompletedAt: string | null
}

export interface TestRunDetail extends TestRunView {
  cases: TestRunCase[]
}

export interface TestRunPage {
  items: TestRunView[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pageCount: number
  }
  summary: {
    total: number
    active: number
    completed: number
    interrupted: number
    failed: number
  }
}

export interface TestRunEvent {
  sequence: number
  type: string
  runId: string
  caseId: string | null
  occurredAt: string
  payload: Record<string, unknown>
}

export type StartTestRunInput =
  | {
      draftId: string
      draftContentRevision: number
      evalRevisionId: string
      mode: "target_vs_no_skill"
    }
  | {
      baselineVersionId: string
      candidateVersionId: string
      evalRevisionId: string
      mode: "version_vs_version"
    }

export interface TestRunLogFilters {
  side?: "TARGET" | "BASELINE"
  externalId?: number
  phase?: TestRunLogPhase
}

export interface TestRunLogPage {
  items: TestRunEvent[]
  pagination: {
    limit: number
    hasMore: boolean
    nextBeforeSequence: number | null
  }
}

export const activeTestRunStatuses: readonly TestRunStatus[] = [
  "PREPARING",
  "RUNNING",
  "SCORING",
  "CANCELING",
]

export function isActiveTestRun(status: TestRunStatus): boolean {
  return activeTestRunStatuses.includes(status)
}

export function getPassRate(side: TestRunBenchmarkSide): number | null {
  const total =
    side.passed +
    side.failed +
    side.insufficientEvidence
  return total === 0 ? null : side.passed / total
}

export function getCoverageRate(
  side: TestRunBenchmarkSide,
): number | null {
  const evaluated =
    side.passed + side.failed + side.insufficientEvidence
  const total = evaluated + side.notEvaluated
  return total === 0 ? null : evaluated / total
}

export function isBenchmarkComparable(
  benchmark: TestRunView["benchmark"],
): boolean {
  if (!benchmark) return false
  const sides = [benchmark.target, benchmark.baseline]
  return sides.every(
    (side) =>
      side.executionFailed === 0 &&
      side.notEvaluated === 0 &&
      getCoverageRate(side) === 1,
  )
}
