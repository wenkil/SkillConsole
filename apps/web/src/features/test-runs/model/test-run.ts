export type TestRunStatus =
  | "PREPARING"
  | "RUNNING"
  | "SCORING"
  | "CANCELING"
  | "COMPLETED"
  | "CANCELED"
  | "INTERRUPTED"
  | "FAILED"

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
}

export interface TestRunView {
  id: string
  workspaceId: string
  mode: "target_vs_no_skill"
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
  traceability: {
    protocolVersion: string
    sdkVersion: string
    skillCreatorCommit: string
    skillCreatorTreeHash: string
    configurationFingerprint: string
    environmentFingerprint: string
    skillManifestHash: string
    evalManifestHash: string
    comparabilityFingerprint: string
    runInputFingerprint: string
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
  executionStatus: TestRunCaseExecutionStatus
  assessmentStatus: TestRunCaseAssessmentStatus
  finalOutput: string | null
  usage: TestRunUsage | null
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

export interface StartTestRunInput {
  draftId: string
  draftContentRevision: number
  evalRevisionId: string
  mode: "target_vs_no_skill"
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
    side.insufficientEvidence +
    side.notEvaluated
  return total === 0 ? null : side.passed / total
}
