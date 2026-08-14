import { Type } from "typebox"

import {
  AssertionResultStatusSchema,
  TestRunCaseSchema,
  TestRunEnvironmentSchema,
  TestRunTraceabilitySchema,
} from "../test-runs/test-run.contract.js"

const NullableNumberSchema = Type.Union([Type.Number(), Type.Null()])
const NullableDateTimeSchema = Type.Union([
  Type.String({ format: "date-time" }),
  Type.Null(),
])

export const TestReportTypeSchema = Type.Union([
  Type.Literal("skill_effect"),
  Type.Literal("version_comparison"),
])

export const TestReportStatusSchema = Type.Union([
  Type.Literal("GENERATION_PENDING"),
  Type.Literal("AVAILABLE"),
  Type.Literal("PARTIAL"),
  Type.Literal("GENERATION_FAILED"),
  Type.Literal("UNAVAILABLE"),
])

export const TestReportComparabilitySchema = Type.Union([
  Type.Literal("COMPARABLE"),
  Type.Literal("COMPARABLE_WITH_LIMITATIONS"),
  Type.Literal("NOT_COMPARABLE"),
  Type.Literal("UNKNOWN_LEGACY"),
])

export const TestReportAnalysisStatusSchema = Type.Union([
  Type.Literal("NOT_REQUESTED"),
  Type.Literal("PENDING"),
  Type.Literal("RUNNING"),
  Type.Literal("AVAILABLE"),
  Type.Literal("FAILED"),
])

const TerminalRunStatusSchema = Type.Union([
  Type.Literal("COMPLETED"),
  Type.Literal("FAILED"),
  Type.Literal("CANCELED"),
  Type.Literal("INTERRUPTED"),
])

export const WorkspaceTestReportParamsSchema = Type.Object(
  { workspaceId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
)

export const TestReportParamsSchema = Type.Object(
  { reportId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
)

export const TestRunReportParamsSchema = Type.Object(
  { runId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
)

export const TestReportCaseParamsSchema = Type.Object(
  {
    reportId: Type.String({ format: "uuid" }),
    evalRevisionCaseId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const TestReportDocumentParamsSchema = Type.Object(
  {
    reportId: Type.String({ format: "uuid" }),
    revisionId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const TestReportAnalysisParamsSchema = Type.Object(
  { analysisId: Type.String({ format: "uuid" }) },
  { additionalProperties: false },
)

export const TestReportDocumentQuerySchema = Type.Object(
  {
    locale: Type.Optional(
      Type.Union([Type.Literal("en"), Type.Literal("zh-CN")]),
    ),
    download: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const TestReportListQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    reportType: Type.Optional(TestReportTypeSchema),
    status: Type.Optional(TestReportStatusSchema),
    runStatus: Type.Optional(TerminalRunStatusSchema),
    comparability: Type.Optional(TestReportComparabilitySchema),
    hasNegativeTransition: Type.Optional(Type.Boolean()),
    evalRevisionId: Type.Optional(Type.String({ format: "uuid" })),
    versionId: Type.Optional(Type.String({ format: "uuid" })),
    analysisStatus: Type.Optional(TestReportAnalysisStatusSchema),
    completedFrom: Type.Optional(Type.String({ format: "date-time" })),
    completedTo: Type.Optional(Type.String({ format: "date-time" })),
    sort: Type.Optional(
      Type.Union([
        Type.Literal("completedAt"),
        Type.Literal("issueCount"),
        Type.Literal("passRate"),
        Type.Literal("cost"),
        Type.Literal("duration"),
      ]),
    ),
    order: Type.Optional(
      Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
    ),
  },
  { additionalProperties: false },
)

const TestReportCaseOutcomeSchema = Type.Union([
  Type.Literal("PASSED"),
  Type.Literal("FAILED"),
  Type.Literal("INCONCLUSIVE"),
  Type.Literal("EXECUTION_ERROR"),
  Type.Literal("ASSESSMENT_ERROR"),
  Type.Literal("CANCELED"),
  Type.Literal("INTERRUPTED"),
])

const ReportMetricValueSchema = Type.Object(
  {
    value: NullableNumberSchema,
    numerator: NullableNumberSchema,
    denominator: NullableNumberSchema,
    status: Type.Union([
      Type.Literal("AVAILABLE"),
      Type.Literal("NOT_APPLICABLE"),
      Type.Literal("INSUFFICIENT_SAMPLE"),
      Type.Literal("MISSING_DATA"),
      Type.Literal("NOT_COMPARABLE"),
    ]),
    reason: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
)

const ReportUsageBucketSchema = Type.Object(
  {
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
    cacheCreationInputTokens: Type.Integer({ minimum: 0 }),
    cacheReadInputTokens: Type.Integer({ minimum: 0 }),
    totalCostUsd: Type.Number({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0 }),
    durationApiMs: Type.Number({ minimum: 0 }),
    numTurns: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

const ReportSideMetricsSchema = Type.Object(
  {
    caseQuality: Type.Object(
      {
        expectedCaseCount: Type.Integer({ minimum: 0 }),
        completedCaseCount: Type.Integer({ minimum: 0 }),
        passedCaseCount: Type.Integer({ minimum: 0 }),
        failedCaseCount: Type.Integer({ minimum: 0 }),
        inconclusiveCaseCount: Type.Integer({ minimum: 0 }),
        executionCompletionRate: ReportMetricValueSchema,
        casePassRate: ReportMetricValueSchema,
      },
      { additionalProperties: false },
    ),
    assertions: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        passed: Type.Integer({ minimum: 0 }),
        failed: Type.Integer({ minimum: 0 }),
        insufficientEvidence: Type.Integer({ minimum: 0 }),
        notEvaluated: Type.Integer({ minimum: 0 }),
        decisivePassRate: ReportMetricValueSchema,
        assessmentCoverageRate: ReportMetricValueSchema,
        decisiveCoverageRate: ReportMetricValueSchema,
      },
      { additionalProperties: false },
    ),
    activation: Type.Object(
      {
        applicableCaseCount: Type.Integer({ minimum: 0 }),
        observedCaseCount: Type.Integer({ minimum: 0 }),
        notObservedCaseCount: Type.Integer({ minimum: 0 }),
        missingObservationCaseCount: Type.Integer({ minimum: 0 }),
        observedRate: ReportMetricValueSchema,
        observationCoverageRate: ReportMetricValueSchema,
        skillToolCallCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    bundledScripts: Type.Object(
      {
        declaredScriptCount: Type.Integer({ minimum: 0 }),
        eligibleCaseCount: Type.Integer({ minimum: 0 }),
        observedCaseCount: Type.Integer({ minimum: 0 }),
        callCount: Type.Integer({ minimum: 0 }),
        observedDistinctScriptCount: Type.Integer({ minimum: 0 }),
        observedCaseRate: ReportMetricValueSchema,
      },
      { additionalProperties: false },
    ),
    usage: Type.Object(
      {
        execution: ReportUsageBucketSchema,
        grading: ReportUsageBucketSchema,
        combined: ReportUsageBucketSchema,
        wallClockDurationMs: NullableNumberSchema,
        medianCaseDurationMs: NullableNumberSchema,
        p95CaseDurationMs: NullableNumberSchema,
        distributionSampleCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    artifacts: Type.Object(
      {
        count: Type.Integer({ minimum: 0 }),
        totalBytes: Type.Integer({ minimum: 0 }),
        textCount: Type.Integer({ minimum: 0 }),
        binaryCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    outputConsistency: Type.Object(
      {
        status: Type.Literal("INSUFFICIENT_SAMPLE"),
        sampleCount: Type.Literal(1),
        value: Type.Null(),
        reason: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

const ReportEvidenceRefSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("RUN_CASE"),
      Type.Literal("ASSERTION"),
      Type.Literal("ARTIFACT"),
      Type.Literal("EVENT"),
      Type.Literal("RUN_ERROR"),
    ]),
    caseId: Type.Optional(Type.String({ format: "uuid" })),
    assertionResultId: Type.Optional(Type.String({ format: "uuid" })),
    artifactId: Type.Optional(Type.String({ format: "uuid" })),
    sequence: Type.Optional(Type.Integer({ minimum: 1 })),
    runId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
)

const ReportAssertionTransitionSchema = Type.Union([
  Type.Literal("STABLE_PASS"),
  Type.Literal("FIXED"),
  Type.Literal("REGRESSION"),
  Type.Literal("PERSISTENT_FAIL"),
  Type.Literal("SKILL_GAIN"),
  Type.Literal("SKILL_DEGRADATION"),
  Type.Literal("BOTH_PASS"),
  Type.Literal("BOTH_FAIL"),
  Type.Literal("INCONCLUSIVE"),
])

const ReportAssertionRowSchema = Type.Object(
  {
    assertionIndex: Type.Integer({ minimum: 0 }),
    assertion: Type.String({ minLength: 1 }),
    baselineStatus: Type.Union([AssertionResultStatusSchema, Type.Null()]),
    targetStatus: Type.Union([AssertionResultStatusSchema, Type.Null()]),
    transition: ReportAssertionTransitionSchema,
    baselineAssertionResultId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    targetAssertionResultId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    evidenceRefs: Type.Array(ReportEvidenceRefSchema),
  },
  { additionalProperties: false },
)

export const TestReportCaseSchema = Type.Object(
  {
    evalRevisionCaseId: Type.String({ format: "uuid" }),
    externalId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1 }),
    pairComparability: TestReportComparabilitySchema,
    classification: Type.String({ minLength: 1 }),
    targetCaseId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    baselineCaseId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    targetOutcome: Type.Union([TestReportCaseOutcomeSchema, Type.Null()]),
    baselineOutcome: Type.Union([TestReportCaseOutcomeSchema, Type.Null()]),
    assertionTransitions: Type.Array(ReportAssertionRowSchema),
    outputDiff: Type.Object(
      {
        rawEqual: Type.Union([Type.Boolean(), Type.Null()]),
        normalizedEqual: Type.Union([Type.Boolean(), Type.Null()]),
        targetSha256: Type.Union([
          Type.String({ pattern: "^[0-9a-f]{64}$" }),
          Type.Null(),
        ]),
        baselineSha256: Type.Union([
          Type.String({ pattern: "^[0-9a-f]{64}$" }),
          Type.Null(),
        ]),
        targetCharacters: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        baselineCharacters: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        characterDelta: Type.Union([Type.Integer(), Type.Null()]),
        targetLines: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        baselineLines: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        lineDelta: Type.Union([Type.Integer(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    artifactDiff: Type.Object(
      {
        added: Type.Array(Type.String()),
        removed: Type.Array(Type.String()),
        changed: Type.Array(Type.String()),
        unchanged: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
    usageDelta: Type.Object(
      {
        executionCostUsd: NullableNumberSchema,
        gradingCostUsd: NullableNumberSchema,
        activeDurationMs: NullableNumberSchema,
        inputTokens: NullableNumberSchema,
        outputTokens: NullableNumberSchema,
      },
      { additionalProperties: false },
    ),
    issueIds: Type.Array(Type.String({ minLength: 1 })),
    evidenceRefs: Type.Array(ReportEvidenceRefSchema),
  },
  { additionalProperties: false },
)

const ReportSubjectSchema = Type.Object(
  {
    side: Type.Union([Type.Literal("TARGET"), Type.Literal("BASELINE")]),
    kind: Type.Union([
      Type.Literal("draft_snapshot"),
      Type.Literal("skill_version"),
      Type.Literal("no_skill"),
    ]),
    label: Type.String({ minLength: 1 }),
    versionId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    versionName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    versionNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    snapshotId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    manifestHash: Type.Union([
      Type.String({ pattern: "^[0-9a-f]{64}$" }),
      Type.Null(),
    ]),
    declaredBundledScripts: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)

const ReportIssueKindSchema = Type.Union([
  Type.Literal("EXECUTION_ERROR"),
  Type.Literal("ASSESSMENT_ERROR"),
  Type.Literal("REGRESSION"),
  Type.Literal("SKILL_DEGRADATION"),
  Type.Literal("PERSISTENT_FAILURE"),
  Type.Literal("BOTH_FAILED"),
  Type.Literal("INSUFFICIENT_EVIDENCE"),
  Type.Literal("NOT_EVALUATED"),
  Type.Literal("SKILL_ACTIVATION_NOT_OBSERVED"),
  Type.Literal("BUNDLED_SCRIPT_NOT_OBSERVED"),
  Type.Literal("INPUT_MISMATCH"),
  Type.Literal("LEGACY_TRACEABILITY_LIMITATION"),
])

const ReportIssueSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: ReportIssueKindSchema,
    triage: Type.Union([
      Type.Literal("BLOCKING_EVIDENCE"),
      Type.Literal("ACTIONABLE_RESULT"),
      Type.Literal("INVESTIGATE"),
      Type.Literal("INFORMATIONAL"),
    ]),
    scope: Type.Union([
      Type.Literal("SKILL"),
      Type.Literal("EVALS"),
      Type.Literal("HARNESS"),
      Type.Literal("ENVIRONMENT"),
      Type.Literal("UNKNOWN"),
    ]),
    evalRevisionCaseId: Type.String({ format: "uuid" }),
    externalId: Type.Integer({ minimum: 1 }),
    side: Type.Union([
      Type.Literal("TARGET"),
      Type.Literal("BASELINE"),
      Type.Null(),
    ]),
    assertionIndex: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    title: Type.String({ minLength: 1 }),
    evidenceRefs: Type.Array(ReportEvidenceRefSchema),
  },
  { additionalProperties: false },
)

export const StructuredTestReportSchema = Type.Object(
  {
    schemaVersion: Type.Literal("test-report.v1"),
    generatorVersion: Type.String({ minLength: 1 }),
    reportId: Type.String({ format: "uuid" }),
    reportRevisionId: Type.String({ format: "uuid" }),
    reportRevisionNumber: Type.Integer({ minimum: 1 }),
    runId: Type.String({ format: "uuid" }),
    workspaceId: Type.String({ format: "uuid" }),
    reportType: TestReportTypeSchema,
    status: Type.Union([Type.Literal("AVAILABLE"), Type.Literal("PARTIAL")]),
    sourceFingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    generatedAt: Type.String({ format: "date-time" }),
    title: Type.String({ minLength: 1 }),
    run: Type.Object(
      {
        mode: Type.Union([
          Type.Literal("target_vs_no_skill"),
          Type.Literal("version_vs_version"),
        ]),
        runStatus: TerminalRunStatusSchema,
        executionPolicy: Type.Union([
          Type.Literal("target_then_no_skill_serial_v1"),
          Type.Literal("paired_serial_alternating_v1"),
        ]),
        createdAt: Type.String({ format: "date-time" }),
        startedAt: NullableDateTimeSchema,
        completedAt: NullableDateTimeSchema,
        wallClockDurationMs: NullableNumberSchema,
        terminalError: Type.Union([
          Type.Object(
            { code: Type.String({ minLength: 1 }), message: Type.String() },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    subjects: Type.Object(
      { baseline: ReportSubjectSchema, target: ReportSubjectSchema },
      { additionalProperties: false },
    ),
    evalRevision: Type.Object(
      {
        id: Type.String({ format: "uuid" }),
        revisionNumber: Type.Integer({ minimum: 1 }),
        manifestHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        evalCount: Type.Integer({ minimum: 1 }),
        caseIds: Type.Array(Type.String({ format: "uuid" })),
      },
      { additionalProperties: false },
    ),
    environment: TestRunEnvironmentSchema,
    traceability: TestRunTraceabilitySchema,
    comparability: Type.Object(
      {
        status: TestReportComparabilitySchema,
        reasons: Type.Array(Type.String()),
        fingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
      },
      { additionalProperties: false },
    ),
    completeness: Type.Object(
      {
        expectedPairCount: Type.Integer({ minimum: 0 }),
        availablePairCount: Type.Integer({ minimum: 0 }),
        missingTargetCaseCount: Type.Integer({ minimum: 0 }),
        missingBaselineCaseCount: Type.Integer({ minimum: 0 }),
        executionErrorCount: Type.Integer({ minimum: 0 }),
        assessmentErrorCount: Type.Integer({ minimum: 0 }),
        notEvaluatedAssertionCount: Type.Integer({ minimum: 0 }),
        status: Type.Union([Type.Literal("COMPLETE"), Type.Literal("PARTIAL")]),
        reasons: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
    metrics: Type.Object(
      {
        target: ReportSideMetricsSchema,
        baseline: ReportSideMetricsSchema,
        delta: Type.Union([
          Type.Object(
            {
              status: Type.Union([Type.Literal("AVAILABLE"), Type.Literal("PARTIAL")]),
              assertionPassRateAbsolute: NullableNumberSchema,
              casePassRateAbsolute: NullableNumberSchema,
              activationObservedRateAbsolute: NullableNumberSchema,
              bundledScriptObservedRateAbsolute: NullableNumberSchema,
              inputTokensAbsolute: NullableNumberSchema,
              outputTokensAbsolute: NullableNumberSchema,
              costUsdAbsolute: NullableNumberSchema,
              activeDurationMsAbsolute: NullableNumberSchema,
              costPercent: NullableNumberSchema,
              activeDurationPercent: NullableNumberSchema,
              reasons: Type.Array(Type.String()),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    transitions: Type.Object(
      {
        counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
        positiveCount: Type.Integer({ minimum: 0 }),
        negativeCount: Type.Integer({ minimum: 0 }),
        inconclusiveCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    issues: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        counts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
        items: Type.Array(ReportIssueSchema),
      },
      { additionalProperties: false },
    ),
    cases: Type.Array(TestReportCaseSchema),
    limitations: Type.Array(
      Type.Object(
        { code: Type.String({ minLength: 1 }), message: Type.String() },
        { additionalProperties: false },
      ),
    ),
    analyzer: Type.Object(
      { status: TestReportAnalysisStatusSchema },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const TestReportCaseQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    classification: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    outcome: Type.Optional(TestReportCaseOutcomeSchema),
    issueKind: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    side: Type.Optional(
      Type.Union([Type.Literal("TARGET"), Type.Literal("BASELINE")]),
    ),
    externalId: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
)

export const TestReportRegenerateHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[\\x21-\\x7e]+$",
    }),
  },
  { additionalProperties: true },
)

export const CreateTestReportAnalysisBodySchema = Type.Object(
  {
    evalRevisionCaseIds: Type.Array(
      Type.String({ format: "uuid" }),
      { minItems: 1, maxItems: 100, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
)

const TestReportAnalysisRevisionStatusSchema = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("RUNNING"),
  Type.Literal("AVAILABLE"),
  Type.Literal("FAILED"),
])

const TestReportAnalysisFindingSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union([
      Type.Literal("FACT"),
      Type.Literal("INFERENCE"),
      Type.Literal("SUGGESTION"),
    ]),
    scope: Type.Union([
      Type.Literal("SKILL"),
      Type.Literal("EVALS"),
      Type.Literal("HARNESS"),
      Type.Literal("ENVIRONMENT"),
      Type.Literal("UNKNOWN"),
    ]),
    confidence: Type.Union([
      Type.Literal("HIGH"),
      Type.Literal("MEDIUM"),
      Type.Literal("LOW"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 300 }),
    statement: Type.String({ minLength: 1, maxLength: 8_000 }),
    evidenceRefs: Type.Array(ReportEvidenceRefSchema, { minItems: 1 }),
    affectedEvalCaseIds: Type.Array(Type.String({ format: "uuid" }), {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    }),
    suggestedAction: Type.Union([
      Type.String({ minLength: 1, maxLength: 4_000 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

const TestReportAnalysisSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal("test-report-analysis.v1"),
    summary: Type.String({ minLength: 1, maxLength: 8_000 }),
    findings: Type.Array(TestReportAnalysisFindingSchema, { maxItems: 100 }),
    priorityOrder: Type.Array(Type.String({ minLength: 1, maxLength: 128 })),
    limitations: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 100,
    }),
  },
  { additionalProperties: false },
)

const TestReportAnalyzerRuntimePolicySchema = Type.Object(
  {
    schemaVersion: Type.Literal("test-report-analyzer-runtime-policy.v4"),
    timeoutMs: Type.Integer({ minimum: 1 }),
    cancellationGraceMs: Type.Integer({ minimum: 1 }),
    maxInputCharacters: Type.Integer({ minimum: 1 }),
    capabilitySource: Type.Literal("project_settings"),
    promptControlledFileAccess: Type.Literal(true),
  },
  { additionalProperties: false },
)

export const TestReportAnalysisRevisionSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    reportId: Type.String({ format: "uuid" }),
    reportRevisionId: Type.String({ format: "uuid" }),
    revisionNumber: Type.Integer({ minimum: 1 }),
    status: TestReportAnalysisRevisionStatusSchema,
    selectedEvalRevisionCaseIds: Type.Array(
      Type.String({ format: "uuid" }),
      { minItems: 1, maxItems: 100 },
    ),
    configuredModelId: Type.String({ minLength: 1 }),
    actualModelId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    modelId: Type.String({ minLength: 1 }),
    semanticConfigurationFingerprint: Type.String({
      pattern: "^[0-9a-f]{64}$",
    }),
    runtimePolicy: TestReportAnalyzerRuntimePolicySchema,
    runtimePolicyFingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    promptVersion: Type.String({ minLength: 1 }),
    inputFingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    analysis: Type.Union([TestReportAnalysisSnapshotSchema, Type.Null()]),
    usage: Type.Union([ReportUsageBucketSchema, Type.Null()]),
    error: Type.Union([
      Type.Object(
        {
          code: Type.String({ minLength: 1 }),
          message: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    createdAt: Type.String({ format: "date-time" }),
    startedAt: NullableDateTimeSchema,
    completedAt: NullableDateTimeSchema,
  },
  { additionalProperties: false },
)

export const TestReportAnalysisRevisionListSchema = Type.Object(
  { items: Type.Array(TestReportAnalysisRevisionSchema) },
  { additionalProperties: false },
)

export const TestReportAnalysisLogEventSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 80 }),
    analysisId: Type.String({ format: "uuid" }),
    occurredAt: Type.String({ format: "date-time" }),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
)

export const TestReportAnalysisLogsQuerySchema = Type.Object(
  {
    beforeSequence: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
)

export const TestReportAnalysisLogPageSchema = Type.Object(
  {
    items: Type.Array(TestReportAnalysisLogEventSchema),
    pagination: Type.Object(
      {
        limit: Type.Integer({ minimum: 1, maximum: 200 }),
        hasMore: Type.Boolean(),
        nextBeforeSequence: Type.Union([
          Type.Integer({ minimum: 1 }),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const TestReportAnalysisEventsQuerySchema = Type.Object(
  {
    afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
)

export const TestReportAnalysisEventsHeaderSchema = Type.Object(
  {
    "last-event-id": Type.Optional(
      Type.String({
        pattern: "^(0|[1-9][0-9]*)$",
        maxLength: 15,
      }),
    ),
  },
  { additionalProperties: true },
)

export const TestReportListItemSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    workspaceId: Type.String({ format: "uuid" }),
    runId: Type.String({ format: "uuid" }),
    reportType: TestReportTypeSchema,
    status: TestReportStatusSchema,
    runStatus: TerminalRunStatusSchema,
    comparabilityStatus: Type.Union([
      TestReportComparabilitySchema,
      Type.Null(),
    ]),
    analysisStatus: TestReportAnalysisStatusSchema,
    targetLabel: Type.String({ minLength: 1 }),
    baselineLabel: Type.String({ minLength: 1 }),
    evalRevisionId: Type.String({ format: "uuid" }),
    evalRevisionNumber: Type.Integer({ minimum: 1 }),
    evalCount: Type.Integer({ minimum: 1 }),
    issueCount: Type.Integer({ minimum: 0 }),
    negativeTransitionCount: Type.Integer({ minimum: 0 }),
    positiveTransitionCount: Type.Integer({ minimum: 0 }),
    primaryPassRate: NullableNumberSchema,
    assessmentCoverageRate: NullableNumberSchema,
    executionCostUsd: Type.Number({ minimum: 0 }),
    gradingCostUsd: Type.Number({ minimum: 0 }),
    totalCostUsd: Type.Number({ minimum: 0 }),
    wallClockDurationMs: NullableNumberSchema,
    completedAt: NullableDateTimeSchema,
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
)

export const TestReportDetailSchema = Type.Intersect([
  TestReportListItemSchema,
  Type.Object(
    {
      currentRevisionId: Type.Union([
        Type.String({ format: "uuid" }),
        Type.Null(),
      ]),
      generationError: Type.Union([
        Type.Object(
          {
            code: Type.String({ minLength: 1 }),
            message: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
      report: Type.Union([StructuredTestReportSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
])

export const TestReportPageSchema = Type.Object(
  {
    items: Type.Array(TestReportListItemSchema),
    pagination: Type.Object(
      {
        page: Type.Integer({ minimum: 1 }),
        pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
        total: Type.Integer({ minimum: 0 }),
        pageCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    summary: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        available: Type.Integer({ minimum: 0 }),
        partial: Type.Integer({ minimum: 0 }),
        generationFailed: Type.Integer({ minimum: 0 }),
        withNegativeTransitions: Type.Integer({ minimum: 0 }),
        executionCostUsd: Type.Number({ minimum: 0 }),
        gradingCostUsd: Type.Number({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const TestReportCasePageSchema = Type.Object(
  {
    items: Type.Array(TestReportCaseSchema),
    pagination: Type.Object(
      {
        page: Type.Integer({ minimum: 1 }),
        pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
        total: Type.Integer({ minimum: 0 }),
        pageCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const TestReportCaseDetailSchema = Type.Object(
  {
    summary: TestReportCaseSchema,
    targetCase: Type.Union([TestRunCaseSchema, Type.Null()]),
    baselineCase: Type.Union([TestRunCaseSchema, Type.Null()]),
  },
  { additionalProperties: false },
)
