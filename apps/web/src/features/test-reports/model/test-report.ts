export type TestReportType = "skill_effect" | "version_comparison"
export type TestReportStatus =
  | "GENERATION_PENDING"
  | "AVAILABLE"
  | "PARTIAL"
  | "GENERATION_FAILED"
  | "UNAVAILABLE"
export type TestReportRunStatus =
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "INTERRUPTED"
export type TestReportComparability =
  | "COMPARABLE"
  | "COMPARABLE_WITH_LIMITATIONS"
  | "NOT_COMPARABLE"
  | "UNKNOWN_LEGACY"

export type TestReportAnalysisStatus =
  | "PENDING"
  | "RUNNING"
  | "AVAILABLE"
  | "FAILED"

export type TestReportAnalysisSummaryStatus =
  | "NOT_REQUESTED"
  | TestReportAnalysisStatus

export type TestReportAnalysisFindingKind =
  | "FACT"
  | "INFERENCE"
  | "SUGGESTION"

export interface TestReportSelectableCase {
  readonly evalRevisionCaseId: string
  readonly externalId: number
  readonly name: string
  readonly issueIds: readonly string[]
}

export interface TestReportAnalysisFinding {
  readonly id: string
  readonly kind: TestReportAnalysisFindingKind
  readonly scope: "SKILL" | "EVALS" | "HARNESS" | "ENVIRONMENT" | "UNKNOWN"
  readonly confidence: "HIGH" | "MEDIUM" | "LOW"
  readonly title: string
  readonly statement: string
  readonly evidenceRefs: readonly Record<string, unknown>[]
  readonly affectedEvalCaseIds: readonly string[]
  readonly suggestedAction: string | null
}

export interface TestReportAnalysisSnapshot {
  readonly schemaVersion: "test-report-analysis.v1"
  readonly summary: string
  readonly findings: readonly TestReportAnalysisFinding[]
  readonly priorityOrder: readonly string[]
  readonly limitations: readonly string[]
}

export interface TestReportAnalysisUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationInputTokens: number
  readonly cacheReadInputTokens: number
  readonly totalCostUsd: number
  readonly durationMs: number
  readonly durationApiMs: number
  readonly numTurns: number
}

export interface TestReportAnalysis {
  readonly id: string
  readonly reportId: string
  readonly reportRevisionId: string
  readonly revisionNumber: number
  readonly status: TestReportAnalysisStatus
  readonly selectedEvalRevisionCaseIds: readonly string[]
  readonly modelId: string
  readonly configuredModelId: string
  readonly actualModelId: string | null
  readonly semanticConfigurationFingerprint: string
  readonly promptVersion: string
  readonly inputFingerprint: string
  readonly runtimePolicy: {
    readonly schemaVersion: string
    readonly maxTurns: number
    readonly maxBudgetUsd: number
    readonly timeoutMs: number
    readonly cancellationGraceMs: number
    readonly capabilitySource: "project_settings"
    readonly promptControlledFileAccess: boolean
    readonly persistSession?: boolean
    readonly maxInputCharacters: number
    readonly maxResponseCharacters: number
  }
  readonly runtimePolicyFingerprint: string
  readonly analysis: TestReportAnalysisSnapshot | null
  readonly usage: TestReportAnalysisUsage | null
  readonly error: {
    readonly code: string
    readonly message: string
  } | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface TestReportAnalysisList {
  readonly items: readonly TestReportAnalysis[]
}

export interface TestReportAnalysisLogEvent {
  readonly sequence: number
  readonly type: string
  readonly analysisId: string
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface TestReportAnalysisLogPage {
  readonly items: readonly TestReportAnalysisLogEvent[]
  readonly pagination: {
    readonly limit: number
    readonly hasMore: boolean
    readonly nextBeforeSequence: number | null
  }
}

export interface TestReportListItem {
  readonly id: string
  readonly workspaceId: string
  readonly runId: string
  readonly reportType: TestReportType
  readonly status: TestReportStatus
  readonly runStatus: TestReportRunStatus
  readonly comparabilityStatus: TestReportComparability | null
  readonly analysisStatus: TestReportAnalysisSummaryStatus
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

export interface TestReportDetail extends TestReportListItem {
  readonly currentRevisionId: string | null
  readonly generationError: {
    readonly code: string
    readonly message: string
  } | null
  readonly report: {
    readonly title: string
    readonly reportRevisionNumber: number
    readonly generatedAt: string
    readonly schemaVersion: string
    readonly generatorVersion: string
    readonly cases?: readonly TestReportSelectableCase[]
  } | null
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

export interface TestReportListFilters {
  readonly page: number
  readonly pageSize: number
  readonly reportType: "" | TestReportType
  readonly status: "" | TestReportStatus
  readonly runStatus: "" | TestReportRunStatus
  readonly comparability: "" | TestReportComparability
  readonly analysisStatus: "" | TestReportAnalysisSummaryStatus
  readonly hasNegativeTransition: "" | "true" | "false"
  readonly sort: "completedAt" | "issueCount" | "passRate" | "cost" | "duration"
  readonly order: "asc" | "desc"
}

export const defaultTestReportListFilters: TestReportListFilters = {
  page: 1,
  pageSize: 20,
  reportType: "",
  status: "",
  runStatus: "",
  comparability: "",
  analysisStatus: "",
  hasNegativeTransition: "",
  sort: "completedAt",
  order: "desc",
}

export function isTestReportDocumentReady(
  report: Pick<TestReportDetail, "status" | "currentRevisionId">,
): boolean {
  return (
    (report.status === "AVAILABLE" || report.status === "PARTIAL") &&
    report.currentRevisionId !== null
  )
}

export function getDefaultAnalysisCaseIds(
  cases: readonly TestReportSelectableCase[],
): string[] {
  const casesWithIssues = cases.filter((item) => item.issueIds.length > 0)
  return (casesWithIssues.length > 0 ? casesWithIssues : cases).map(
    (item) => item.evalRevisionCaseId,
  )
}

export function isTestReportAnalysisAvailable(
  analysis: Pick<TestReportAnalysis, "status" | "analysis"> | null,
): boolean {
  return analysis?.status === "AVAILABLE" && analysis.analysis !== null
}
