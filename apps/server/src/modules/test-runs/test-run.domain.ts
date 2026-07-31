import type {
  AssertionResultStatus,
  StoredAssertionEvidence,
  StoredBenchmarkSide,
  StoredTestRunUsage,
  TestRunCaseAssessmentStatus,
  TestRunCaseExecutionStatus,
  TestRunCaseSide,
  TestRunStatus,
} from "../../infrastructure/database/index.js"

export const testRunMode = "target_vs_no_skill" as const

export interface TestRunError {
  readonly code: string
  readonly message: string
  readonly details: Readonly<Record<string, unknown>> | null
}

export interface TestRunTraceability {
  readonly protocolVersion: string
  readonly sdkVersion: string
  readonly skillCreatorCommit: string
  readonly skillCreatorTreeHash: string
  readonly configurationFingerprint: string
  readonly environmentFingerprint: string
  readonly skillManifestHash: string
  readonly evalManifestHash: string
  readonly comparabilityFingerprint: string
  readonly runInputFingerprint: string
}

export interface TestRunTargetView {
  readonly skillVersionId: string
  readonly skillVersionName: string
  readonly skillVersionNumber: number
  readonly skillSnapshotId: string
  readonly evalRevisionId: string
  readonly evalRevisionNumber: number
  readonly evalCount: number
}

export interface TestRunBenchmarkView {
  readonly target: StoredBenchmarkSide
  readonly baseline: StoredBenchmarkSide
}

export interface TestRunView {
  readonly id: string
  readonly workspaceId: string
  readonly mode: typeof testRunMode
  readonly status: TestRunStatus
  readonly target: TestRunTargetView
  readonly traceability: TestRunTraceability
  readonly progress: {
    readonly totalCases: number
    readonly completedCases: number
  }
  readonly benchmark: TestRunBenchmarkView | null
  readonly error: TestRunError | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface TestRunAssertionResultView {
  readonly id: string
  readonly assertionIndex: number
  readonly assertion: string
  readonly status: AssertionResultStatus
  readonly reason: string
  readonly evidence: readonly StoredAssertionEvidence[]
}

export interface TestRunArtifactView {
  readonly id: string
  readonly relativePath: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: "text" | "binary"
  readonly downloadUrl: string
}

export interface TestRunCaseView {
  readonly id: string
  readonly evalRevisionCaseId: string
  readonly externalId: number
  readonly name: string
  readonly side: TestRunCaseSide
  readonly executionOrder: number
  readonly prompt: string
  readonly expectedOutput: string
  readonly assertions: readonly string[]
  readonly files: readonly string[]
  readonly inputFingerprint: string
  readonly executionStatus: TestRunCaseExecutionStatus
  readonly assessmentStatus: TestRunCaseAssessmentStatus
  readonly finalOutput: string | null
  readonly usage: StoredTestRunUsage | null
  readonly executionError: {
    readonly code: string
    readonly message: string
  } | null
  readonly assessmentError: {
    readonly code: string
    readonly message: string
  } | null
  readonly assertionResults: readonly TestRunAssertionResultView[]
  readonly artifacts: readonly TestRunArtifactView[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt: string | null
  readonly executionCompletedAt: string | null
  readonly assessmentCompletedAt: string | null
}

export interface TestRunDetailView extends TestRunView {
  readonly cases: readonly TestRunCaseView[]
}

export interface TestRunPage {
  readonly items: readonly TestRunView[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly pageCount: number
  }
  readonly summary: {
    readonly total: number
    readonly active: number
    readonly completed: number
    readonly interrupted: number
    readonly failed: number
  }
}

export interface TestRunEvent {
  readonly sequence: number
  readonly type: string
  readonly runId: string
  readonly caseId: string | null
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface CreateTestRunInput {
  readonly workspaceId: string
  readonly skillVersionId: string
  readonly evalRevisionId: string
  readonly mode: typeof testRunMode
  readonly idempotencyKey: string
}
