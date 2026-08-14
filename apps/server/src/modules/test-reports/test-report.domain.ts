import type {
  AssertionResultStatus,
  StoredTestRunUsage,
  TestReportAnalysisRevisionStatus,
  TestReportAnalysisStatus,
  TestReportCaseOutcome,
  TestReportComparabilityStatus,
  TestReportStatus,
  TestReportType,
} from "../../infrastructure/database/index.js"

export const testReportSchemaVersion = "test-report.v1"
export const testReportGeneratorVersion = "test-report-generator-v1"
export const testReportAnalysisSchemaVersion = "test-report-analysis.v1"

export type TestReportAnalysisFindingScope =
  | "SKILL"
  | "EVALS"
  | "HARNESS"
  | "ENVIRONMENT"
  | "UNKNOWN"

export interface TestReportAnalysisFinding {
  readonly id: string
  readonly kind: "FACT" | "INFERENCE" | "SUGGESTION"
  readonly scope: TestReportAnalysisFindingScope
  readonly confidence: "HIGH" | "MEDIUM" | "LOW"
  readonly title: string
  readonly statement: string
  readonly evidenceRefs: readonly ReportEvidenceRef[]
  readonly affectedEvalCaseIds: readonly string[]
  readonly suggestedAction: string | null
}

export interface TestReportAnalysisV1 {
  readonly schemaVersion: "test-report-analysis.v1"
  readonly summary: string
  readonly findings: readonly TestReportAnalysisFinding[]
  readonly priorityOrder: readonly string[]
  readonly limitations: readonly string[]
}

export interface TestReportAnalysisUsage extends StoredTestRunUsage {}

export interface TestReportAnalyzerRuntimePolicyV1 {
  readonly schemaVersion: "test-report-analyzer-runtime-policy.v1"
  readonly maxTurns: number
  readonly maxBudgetUsd: number
  readonly timeoutMs: number
  readonly cancellationGraceMs: number
  readonly maxPromptCharacters: number
  readonly maxResponseCharacters: number
  readonly sandboxPolicy: "report_analyzer_strict_v1"
  readonly persistSession: false
  readonly strictMcpConfig: true
  readonly toolsEnabled: false
  readonly skillsEnabled: false
  readonly mcpEnabled: false
}

export interface CreateTestReportAnalysisInput {
  readonly reportId: string
  readonly reportRevisionId: string
  readonly configuredModelId: string
  /** Exact source settings hash used only to prevent create-to-start TOCTOU. */
  readonly configurationFingerprint: string
  /** Secret-insensitive model/endpoint fingerprint used in input identity. */
  readonly semanticConfigurationFingerprint: string
  readonly runtimePolicy: TestReportAnalyzerRuntimePolicyV1
  readonly runtimePolicyFingerprint: string
  readonly promptVersion: string
  readonly inputFingerprint: string
  readonly selectedEvalRevisionCaseIds: readonly string[]
  readonly idempotencyKey: string
}

export interface TestReportAnalysisRevisionView {
  readonly id: string
  readonly reportId: string
  readonly reportRevisionId: string
  readonly revisionNumber: number
  readonly status: TestReportAnalysisRevisionStatus
  readonly agentSessionId: string | null
  readonly configuredModelId: string
  readonly actualModelId: string | null
  /** Actual SDK model when known; otherwise the frozen configured model. */
  readonly modelId: string
  readonly configurationFingerprint: string
  readonly semanticConfigurationFingerprint: string
  readonly runtimePolicy: TestReportAnalyzerRuntimePolicyV1
  readonly runtimePolicyFingerprint: string
  readonly promptVersion: string
  readonly inputFingerprint: string
  readonly selectedEvalRevisionCaseIds: readonly string[]
  readonly analysis: TestReportAnalysisV1 | null
  readonly usage: TestReportAnalysisUsage | null
  readonly error: {
    readonly code: string
    readonly message: string
  } | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface ReportMetricValue {
  readonly value: number | null
  readonly numerator: number | null
  readonly denominator: number | null
  readonly status:
    | "AVAILABLE"
    | "NOT_APPLICABLE"
    | "INSUFFICIENT_SAMPLE"
    | "MISSING_DATA"
    | "NOT_COMPARABLE"
  readonly reason: string | null
}

export interface ReportUsageBucket extends StoredTestRunUsage {}

export interface ReportSideMetrics {
  readonly caseQuality: {
    readonly expectedCaseCount: number
    readonly completedCaseCount: number
    readonly passedCaseCount: number
    readonly failedCaseCount: number
    readonly inconclusiveCaseCount: number
    readonly executionCompletionRate: ReportMetricValue
    readonly casePassRate: ReportMetricValue
  }
  readonly assertions: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly insufficientEvidence: number
    readonly notEvaluated: number
    readonly decisivePassRate: ReportMetricValue
    readonly assessmentCoverageRate: ReportMetricValue
    readonly decisiveCoverageRate: ReportMetricValue
  }
  readonly activation: {
    readonly applicableCaseCount: number
    readonly observedCaseCount: number
    readonly notObservedCaseCount: number
    readonly missingObservationCaseCount: number
    readonly observedRate: ReportMetricValue
    readonly observationCoverageRate: ReportMetricValue
    readonly skillToolCallCount: number
  }
  readonly bundledScripts: {
    readonly declaredScriptCount: number
    readonly eligibleCaseCount: number
    readonly observedCaseCount: number
    readonly callCount: number
    readonly observedDistinctScriptCount: number
    readonly observedCaseRate: ReportMetricValue
  }
  readonly usage: {
    readonly execution: ReportUsageBucket
    readonly grading: ReportUsageBucket
    readonly combined: ReportUsageBucket
    readonly wallClockDurationMs: number | null
    readonly medianCaseDurationMs: number | null
    readonly p95CaseDurationMs: number | null
    readonly distributionSampleCount: number
  }
  readonly artifacts: {
    readonly count: number
    readonly totalBytes: number
    readonly textCount: number
    readonly binaryCount: number
  }
  readonly outputConsistency: {
    readonly status: "INSUFFICIENT_SAMPLE"
    readonly sampleCount: 1
    readonly value: null
    readonly reason: string
  }
}

export type ReportAssertionTransition =
  | "STABLE_PASS"
  | "FIXED"
  | "REGRESSION"
  | "PERSISTENT_FAIL"
  | "SKILL_GAIN"
  | "SKILL_DEGRADATION"
  | "BOTH_PASS"
  | "BOTH_FAIL"
  | "INCONCLUSIVE"

export type ReportIssueKind =
  | "EXECUTION_ERROR"
  | "ASSESSMENT_ERROR"
  | "REGRESSION"
  | "SKILL_DEGRADATION"
  | "PERSISTENT_FAILURE"
  | "BOTH_FAILED"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_EVALUATED"
  | "SKILL_ACTIVATION_NOT_OBSERVED"
  | "BUNDLED_SCRIPT_NOT_OBSERVED"
  | "INPUT_MISMATCH"
  | "LEGACY_TRACEABILITY_LIMITATION"

export interface ReportEvidenceRef {
  readonly kind:
    | "RUN_CASE"
    | "ASSERTION"
    | "ARTIFACT"
    | "EVENT"
    | "RUN_ERROR"
  readonly caseId?: string
  readonly assertionResultId?: string
  readonly artifactId?: string
  readonly sequence?: number
  readonly runId?: string
}

export interface ReportIssue {
  readonly id: string
  readonly kind: ReportIssueKind
  readonly triage:
    | "BLOCKING_EVIDENCE"
    | "ACTIONABLE_RESULT"
    | "INVESTIGATE"
    | "INFORMATIONAL"
  readonly scope:
    | "SKILL"
    | "EVALS"
    | "HARNESS"
    | "ENVIRONMENT"
    | "UNKNOWN"
  readonly evalRevisionCaseId: string
  readonly externalId: number
  readonly side: "TARGET" | "BASELINE" | null
  readonly assertionIndex: number | null
  readonly title: string
  readonly evidenceRefs: readonly ReportEvidenceRef[]
}

export interface ReportAssertionRowView {
  readonly assertionIndex: number
  readonly assertion: string
  readonly baselineStatus: AssertionResultStatus | null
  readonly targetStatus: AssertionResultStatus | null
  readonly transition: ReportAssertionTransition
  readonly baselineAssertionResultId: string | null
  readonly targetAssertionResultId: string | null
  readonly evidenceRefs: readonly ReportEvidenceRef[]
}

export interface ReportCaseSummary {
  readonly evalRevisionCaseId: string
  readonly externalId: number
  readonly name: string
  readonly pairComparability: TestReportComparabilityStatus
  readonly classification: string
  readonly targetCaseId: string | null
  readonly baselineCaseId: string | null
  readonly targetOutcome: TestReportCaseOutcome | null
  readonly baselineOutcome: TestReportCaseOutcome | null
  readonly assertionTransitions: readonly ReportAssertionRowView[]
  readonly outputDiff: {
    readonly rawEqual: boolean | null
    readonly normalizedEqual: boolean | null
    readonly targetSha256: string | null
    readonly baselineSha256: string | null
    readonly targetCharacters: number | null
    readonly baselineCharacters: number | null
    readonly characterDelta: number | null
    readonly targetLines: number | null
    readonly baselineLines: number | null
    readonly lineDelta: number | null
  }
  readonly artifactDiff: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
    readonly changed: readonly string[]
    readonly unchanged: readonly string[]
  }
  readonly usageDelta: {
    readonly executionCostUsd: number | null
    readonly gradingCostUsd: number | null
    readonly activeDurationMs: number | null
    readonly inputTokens: number | null
    readonly outputTokens: number | null
  }
  readonly issueIds: readonly string[]
  readonly evidenceRefs: readonly ReportEvidenceRef[]
}

export interface StructuredTestReportV1 {
  readonly schemaVersion: "test-report.v1"
  readonly generatorVersion: string
  readonly reportId: string
  readonly reportRevisionId: string
  readonly reportRevisionNumber: number
  readonly runId: string
  readonly workspaceId: string
  readonly reportType: TestReportType
  readonly status: "AVAILABLE" | "PARTIAL"
  readonly sourceFingerprint: string
  readonly generatedAt: string
  readonly title: string
  readonly run: {
    readonly mode: "target_vs_no_skill" | "version_vs_version"
    readonly runStatus: "COMPLETED" | "FAILED" | "CANCELED" | "INTERRUPTED"
    readonly executionPolicy:
      | "target_then_no_skill_serial_v1"
      | "paired_serial_alternating_v1"
    readonly createdAt: string
    readonly startedAt: string | null
    readonly completedAt: string | null
    readonly wallClockDurationMs: number | null
    readonly terminalError: {
      readonly code: string
      readonly message: string
    } | null
  }
  readonly subjects: {
    readonly baseline: ReportSubject
    readonly target: ReportSubject
  }
  readonly evalRevision: {
    readonly id: string
    readonly revisionNumber: number
    readonly manifestHash: string
    readonly evalCount: number
    readonly caseIds: readonly string[]
  }
  readonly environment: import("../test-runs/test-run.domain.js").TestRunEnvironmentSnapshot
  readonly traceability: import("../test-runs/test-run.domain.js").TestRunTraceability
  readonly comparability: {
    readonly status: TestReportComparabilityStatus
    readonly reasons: readonly string[]
    readonly fingerprint: string
  }
  readonly completeness: {
    readonly expectedPairCount: number
    readonly availablePairCount: number
    readonly missingTargetCaseCount: number
    readonly missingBaselineCaseCount: number
    readonly executionErrorCount: number
    readonly assessmentErrorCount: number
    readonly notEvaluatedAssertionCount: number
    readonly status: "COMPLETE" | "PARTIAL"
    readonly reasons: readonly string[]
  }
  readonly metrics: {
    readonly target: ReportSideMetrics
    readonly baseline: ReportSideMetrics
    readonly delta: {
      readonly status: "AVAILABLE" | "PARTIAL"
      readonly assertionPassRateAbsolute: number | null
      readonly casePassRateAbsolute: number | null
      readonly activationObservedRateAbsolute: number | null
      readonly bundledScriptObservedRateAbsolute: number | null
      readonly inputTokensAbsolute: number | null
      readonly outputTokensAbsolute: number | null
      readonly costUsdAbsolute: number | null
      readonly activeDurationMsAbsolute: number | null
      readonly costPercent: number | null
      readonly activeDurationPercent: number | null
      readonly reasons: readonly string[]
    } | null
  }
  readonly transitions: {
    readonly counts: Readonly<Record<string, number>>
    readonly positiveCount: number
    readonly negativeCount: number
    readonly inconclusiveCount: number
  }
  readonly issues: {
    readonly total: number
    readonly counts: Readonly<Record<string, number>>
    readonly items: readonly ReportIssue[]
  }
  readonly cases: readonly ReportCaseSummary[]
  readonly limitations: readonly {
    readonly code: string
    readonly message: string
  }[]
  readonly analyzer: {
    readonly status: TestReportAnalysisStatus
  }
}

export interface ReportSubject {
  readonly side: "TARGET" | "BASELINE"
  readonly kind: "draft_snapshot" | "skill_version" | "no_skill"
  readonly label: string
  readonly versionId: string | null
  readonly versionName: string | null
  readonly versionNumber: number | null
  readonly snapshotId: string | null
  readonly manifestHash: string | null
  readonly declaredBundledScripts: readonly string[]
}

export interface TestReportListItem {
  readonly id: string
  readonly workspaceId: string
  readonly runId: string
  readonly reportType: TestReportType
  readonly status: TestReportStatus
  readonly runStatus: "COMPLETED" | "FAILED" | "CANCELED" | "INTERRUPTED"
  readonly comparabilityStatus: TestReportComparabilityStatus | null
  readonly analysisStatus: TestReportAnalysisStatus
  readonly targetLabel: string
  readonly baselineLabel: string
  readonly evalRevisionId: string
  readonly evalRevisionNumber: number
  readonly evalCount: number
  readonly issueCount: number
  readonly negativeTransitionCount: number
  readonly positiveTransitionCount: number
  readonly primaryPassRate: number | null
  readonly assessmentCoverageRate: number | null
  readonly executionCostUsd: number
  readonly gradingCostUsd: number
  readonly totalCostUsd: number
  readonly wallClockDurationMs: number | null
  readonly completedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TestReportDetailView extends TestReportListItem {
  readonly currentRevisionId: string | null
  readonly generationError: {
    readonly code: string
    readonly message: string
  } | null
  readonly report: StructuredTestReportV1 | null
}

export interface TestReportPage {
  readonly items: readonly TestReportListItem[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly pageCount: number
  }
  readonly summary: {
    readonly total: number
    readonly available: number
    readonly partial: number
    readonly generationFailed: number
    readonly withNegativeTransitions: number
    readonly executionCostUsd: number
    readonly gradingCostUsd: number
  }
}

export interface TestReportListQuery {
  readonly page: number
  readonly pageSize: number
  readonly reportType?: TestReportType
  readonly status?: TestReportStatus
  readonly runStatus?: "COMPLETED" | "FAILED" | "CANCELED" | "INTERRUPTED"
  readonly comparability?: TestReportComparabilityStatus
  readonly hasNegativeTransition?: boolean
  readonly evalRevisionId?: string
  readonly versionId?: string
  readonly analysisStatus?: TestReportAnalysisStatus
  readonly completedFrom?: string
  readonly completedTo?: string
  readonly sort:
    | "completedAt"
    | "issueCount"
    | "passRate"
    | "cost"
    | "duration"
  readonly order: "asc" | "desc"
}

export interface TestReportCaseQuery {
  readonly page: number
  readonly pageSize: number
  readonly classification?: string
  readonly outcome?: TestReportCaseOutcome
  readonly issueKind?: string
  readonly side?: "TARGET" | "BASELINE"
  readonly externalId?: number
}

export interface TestReportCasePage {
  readonly items: readonly ReportCaseSummary[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly pageCount: number
  }
}

export interface TestReportCaseDetailView {
  readonly summary: ReportCaseSummary
  readonly targetCase: import("../test-runs/test-run.domain.js").TestRunCaseView | null
  readonly baselineCase: import("../test-runs/test-run.domain.js").TestRunCaseView | null
}
