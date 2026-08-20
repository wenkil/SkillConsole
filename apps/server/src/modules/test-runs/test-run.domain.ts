import type {
  AssertionResultStatus,
  StoredAssertionEvidence,
  StoredBenchmarkSide,
  StoredBundledScriptUse,
  StoredTestRunUsage,
  SkillInvocationObservation,
  TestRunCaseAssessmentStatus,
  TestRunCaseExecutionStatus,
  TestRunCaseSide,
  TestRunExecutionPolicy,
  TestRunMode,
  TestRunStatus,
} from "../../infrastructure/database/index.js"

export const testRunModes = [
  "target_vs_no_skill",
  "version_vs_version",
] as const satisfies readonly TestRunMode[]

export const testRunExecutionPolicies = [
  "target_then_no_skill_serial_v1",
  "paired_serial_alternating_v1",
] as const satisfies readonly TestRunExecutionPolicy[]

export interface TestRunRuntimeLimitSnapshot {
  readonly timeoutMs: number
}

export interface TestRunRuntimeCapabilitySnapshot {
  readonly capability: string
  readonly commands: readonly {
    readonly name: string
    readonly available: boolean
    readonly version: string | null
  }[]
}

export type TestRunEnvironmentSnapshot =
  | {
      readonly status: "captured"
      readonly nodeVersion: string
      readonly platform: string
      readonly architecture: string
      readonly sdkVersion: string
      readonly model: string
      readonly apiEndpointHash: string | null
      readonly executionLimits: TestRunRuntimeLimitSnapshot
      readonly gradingLimits: TestRunRuntimeLimitSnapshot
      readonly executionPromptVersion: string
      readonly graderProtocolVersion: string
      readonly toolPermissionPolicyVersion: string
      readonly executionPolicy: TestRunExecutionPolicy
      readonly runtimeCapabilities: readonly TestRunRuntimeCapabilitySnapshot[]
    }
  | {
      readonly status: "legacy_unavailable"
    }

export interface TestRunError {
  readonly code: string
  readonly message: string
  readonly details: Readonly<Record<string, unknown>> | null
}

export interface TestRunTraceability {
  readonly protocolVersion: string
  readonly sdkVersion: string
  readonly configurationFingerprint: string
  readonly semanticConfigurationFingerprint: string
  readonly executionSettingsFingerprint: string
  readonly gradingSettingsFingerprint: string
  readonly environmentFingerprint: string
  readonly skillManifestHash: string
  readonly baselineSkillManifestHash: string | null
  readonly evalManifestHash: string
  readonly comparabilityFingerprint: string
  readonly runInputFingerprint: string
  readonly executionPromptVersion: string
  readonly graderProtocolVersion: string
  readonly toolPermissionPolicyVersion: string
}

export interface TestRunTargetView {
  readonly draftId: string | null
  readonly draftRevisionId: string | null
  readonly draftContentRevision: number | null
  readonly skillVersionId: string | null
  readonly skillVersionName: string | null
  readonly skillVersionNumber: number | null
  readonly skillSnapshotId: string
  readonly evalRevisionId: string
  readonly evalRevisionNumber: number
  readonly evalCount: number
}

export type TestRunBaselineView =
  | {
      readonly kind: "no_skill"
      readonly skillVersionId: null
      readonly skillSnapshotId: null
    }
  | {
      readonly kind: "skill_version"
      readonly skillVersionId: string
      readonly skillVersionName: string
      readonly skillVersionNumber: number
      readonly skillSnapshotId: string
      readonly skillManifestHash: string
    }

export interface TestRunBenchmarkView {
  readonly target: StoredBenchmarkSide
  readonly baseline: StoredBenchmarkSide
}

export interface TestRunView {
  readonly id: string
  readonly workspaceId: string
  readonly mode: TestRunMode
  readonly executionPolicy: TestRunExecutionPolicy
  readonly status: TestRunStatus
  readonly target: TestRunTargetView
  readonly baseline: TestRunBaselineView
  readonly environment: TestRunEnvironmentSnapshot
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
  readonly participantExecutionFingerprint: string
  readonly executionStatus: TestRunCaseExecutionStatus
  readonly assessmentStatus: TestRunCaseAssessmentStatus
  readonly finalOutput: string | null
  readonly assertionAgentSessionId: string | null
  readonly assertionAgentRawResponse: string | null
  readonly assertionAgentJson: unknown | null
  readonly assertionJsonParseError: string | null
  readonly usage: StoredTestRunUsage | null
  readonly gradingUsage: StoredTestRunUsage | null
  readonly skillInvocationObserved: SkillInvocationObservation | null
  readonly skillToolCallCount: number
  readonly bundledScriptUses: readonly StoredBundledScriptUse[]
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

export interface TestRunSkillScoreReportView {
  readonly id: string
  readonly status: "PENDING" | "RUNNING" | "AVAILABLE" | "FAILED"
  readonly documentUrl: string | null
  readonly error: {
    readonly code: string
    readonly message: string
  } | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface SkillScoreReportView extends TestRunSkillScoreReportView {
  readonly runId: string
  readonly workspaceId: string
}

export interface SkillScoreReportEvent {
  readonly sequence: number
  readonly type: string
  readonly reportId: string
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface SkillScoreReportPage {
  readonly items: readonly SkillScoreReportView[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly pageCount: number
  }
}

export interface SkillScoreReportEventPage {
  readonly items: readonly SkillScoreReportEvent[]
  readonly pagination: {
    readonly limit: number
    readonly hasMore: boolean
    readonly nextBeforeSequence: number | null
  }
}

export interface TestRunDetailView extends TestRunView {
  readonly cases: readonly TestRunCaseView[]
  readonly skillScoreReport: TestRunSkillScoreReportView | null
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

export interface TestRunLogPage {
  readonly items: readonly TestRunEvent[]
  readonly pagination: {
    readonly limit: number
    readonly hasMore: boolean
    readonly nextBeforeSequence: number | null
  }
}

export interface TestRunLogQuery {
  readonly beforeSequence?: number
  readonly limit: number
  readonly side?: TestRunCaseSide
  readonly externalId?: number
  readonly phase?:
    | "execution"
    | "assertion"
    | "orchestration"
}

interface CreateTestRunInputBase {
  readonly workspaceId: string
  readonly evalRevisionId: string
  readonly idempotencyKey: string
}

export type CreateTestRunInput =
  | (CreateTestRunInputBase & {
      readonly mode: "target_vs_no_skill"
      readonly draftId: string
      readonly draftContentRevision: number
    })
  | (CreateTestRunInputBase & {
      readonly mode: "version_vs_version"
      readonly baselineVersionId: string
      readonly candidateVersionId: string
    })
