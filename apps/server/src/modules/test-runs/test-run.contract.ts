import { Type, type Static } from "typebox"

const HashSchema = Type.String({ pattern: "^[0-9a-f]{64}$" })
const NullableDateTimeSchema = Type.Union([
  Type.String({ format: "date-time" }),
  Type.Null(),
])

export const TestRunModeSchema = Type.Union([
  Type.Literal("target_vs_no_skill"),
  Type.Literal("version_vs_version"),
])

const TestRunExecutionPolicySchema = Type.Union([
  Type.Literal("target_then_no_skill_serial_v1"),
  Type.Literal("paired_serial_alternating_v1"),
])

export const TestRunStatusSchema = Type.Union([
  Type.Literal("PREPARING"),
  Type.Literal("RUNNING"),
  Type.Literal("SCORING"),
  Type.Literal("CANCELING"),
  Type.Literal("COMPLETED"),
  Type.Literal("CANCELED"),
  Type.Literal("INTERRUPTED"),
  Type.Literal("FAILED"),
])

const TestRunCaseExecutionStatusSchema = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("PREPARING"),
  Type.Literal("RUNNING"),
  Type.Literal("COMPLETED"),
  Type.Literal("CANCELED"),
  Type.Literal("INTERRUPTED"),
  Type.Literal("FAILED"),
])

const TestRunCaseAssessmentStatusSchema = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("RUNNING"),
  Type.Literal("COMPLETED"),
  Type.Literal("NOT_EVALUATED"),
  Type.Literal("FAILED"),
])

const AssertionResultStatusSchema = Type.Union([
  Type.Literal("PASSED"),
  Type.Literal("FAILED"),
  Type.Literal("INSUFFICIENT_EVIDENCE"),
  Type.Literal("NOT_EVALUATED"),
])

export const WorkspaceTestRunParamsSchema = Type.Object(
  {
    workspaceId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const TestRunParamsSchema = Type.Object(
  {
    runId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const TestRunArtifactParamsSchema = Type.Object(
  {
    runId: Type.String({ format: "uuid" }),
    artifactId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const TestRunListQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    pageSize: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100 }),
    ),
  },
  { additionalProperties: false },
)

export const TestRunStartHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[\\x21-\\x7e]+$",
    }),
  },
  { additionalProperties: true },
)

export const StartTestRunBodySchema = Type.Union([
  Type.Object(
    {
      draftId: Type.String({ format: "uuid" }),
      draftContentRevision: Type.Integer({ minimum: 1 }),
      evalRevisionId: Type.String({ format: "uuid" }),
      mode: Type.Literal("target_vs_no_skill"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      baselineVersionId: Type.String({ format: "uuid" }),
      candidateVersionId: Type.String({ format: "uuid" }),
      evalRevisionId: Type.String({ format: "uuid" }),
      mode: Type.Literal("version_vs_version"),
    },
    { additionalProperties: false },
  ),
])

const TestRunErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    details: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

const TestRunTargetSchema = Type.Object(
  {
    draftId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    draftRevisionId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    draftContentRevision: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
    skillVersionId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    skillVersionName: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Null(),
    ]),
    skillVersionNumber: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
    skillSnapshotId: Type.String({ format: "uuid" }),
    evalRevisionId: Type.String({ format: "uuid" }),
    evalRevisionNumber: Type.Integer({ minimum: 1 }),
    evalCount: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
)

const TestRunBaselineSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("no_skill"),
      skillVersionId: Type.Null(),
      skillSnapshotId: Type.Null(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("skill_version"),
      skillVersionId: Type.String({ format: "uuid" }),
      skillVersionName: Type.String({ minLength: 1 }),
      skillVersionNumber: Type.Integer({ minimum: 1 }),
      skillSnapshotId: Type.String({ format: "uuid" }),
      skillManifestHash: HashSchema,
    },
    { additionalProperties: false },
  ),
])

const RuntimeLimitSnapshotSchema = Type.Object(
  {
    maxTurns: Type.Integer({ minimum: 1 }),
    maxBudgetUsd: Type.Number({ minimum: 0 }),
    timeoutMs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
)

const RuntimeCapabilitySnapshotSchema = Type.Object(
  {
    capability: Type.String({ minLength: 1 }),
    commands: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1 }),
          available: Type.Boolean(),
          version: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

const TestRunEnvironmentSchema = Type.Union([
  Type.Object(
    { status: Type.Literal("legacy_unavailable") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("captured"),
      nodeVersion: Type.String({ minLength: 1 }),
      platform: Type.String({ minLength: 1 }),
      architecture: Type.String({ minLength: 1 }),
      sdkVersion: Type.String({ minLength: 1 }),
      model: Type.String({ minLength: 1 }),
      apiEndpointHash: Type.Union([HashSchema, Type.Null()]),
      executionLimits: RuntimeLimitSnapshotSchema,
      gradingLimits: RuntimeLimitSnapshotSchema,
      executionPromptVersion: Type.String({ minLength: 1 }),
      graderProtocolVersion: Type.String({ minLength: 1 }),
      toolPermissionPolicyVersion: Type.String({ minLength: 1 }),
      executionPolicy: TestRunExecutionPolicySchema,
      runtimeCapabilities: Type.Array(RuntimeCapabilitySnapshotSchema),
    },
    { additionalProperties: false },
  ),
])

const TestRunTraceabilitySchema = Type.Object(
  {
    protocolVersion: Type.String({ minLength: 1 }),
    sdkVersion: Type.String({ minLength: 1 }),
    skillCreatorCommit: Type.String({ pattern: "^[0-9a-f]{40}$" }),
    skillCreatorTreeHash: HashSchema,
    configurationFingerprint: HashSchema,
    semanticConfigurationFingerprint: HashSchema,
    executionSettingsFingerprint: HashSchema,
    gradingSettingsFingerprint: HashSchema,
    environmentFingerprint: HashSchema,
    skillManifestHash: HashSchema,
    baselineSkillManifestHash: Type.Union([HashSchema, Type.Null()]),
    evalManifestHash: HashSchema,
    comparabilityFingerprint: HashSchema,
    runInputFingerprint: HashSchema,
    executionPromptVersion: Type.String({ minLength: 1 }),
    graderProtocolVersion: Type.String({ minLength: 1 }),
    toolPermissionPolicyVersion: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const BenchmarkSideSchema = Type.Object(
  {
    executed: Type.Integer({ minimum: 0 }),
    executionFailed: Type.Integer({ minimum: 0 }),
    passed: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    insufficientEvidence: Type.Integer({ minimum: 0 }),
    notEvaluated: Type.Integer({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0 }),
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
    totalCostUsd: Type.Number({ minimum: 0 }),
    gradingDurationMs: Type.Number({ minimum: 0 }),
    gradingInputTokens: Type.Integer({ minimum: 0 }),
    gradingOutputTokens: Type.Integer({ minimum: 0 }),
    gradingTotalCostUsd: Type.Number({ minimum: 0 }),
    gradingNumTurns: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

const TestRunBenchmarkSchema = Type.Object(
  {
    target: BenchmarkSideSchema,
    baseline: BenchmarkSideSchema,
  },
  { additionalProperties: false },
)

export const TestRunSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    workspaceId: Type.String({ format: "uuid" }),
    mode: TestRunModeSchema,
    executionPolicy: TestRunExecutionPolicySchema,
    status: TestRunStatusSchema,
    target: TestRunTargetSchema,
    baseline: TestRunBaselineSchema,
    environment: TestRunEnvironmentSchema,
    traceability: TestRunTraceabilitySchema,
    progress: Type.Object(
      {
        totalCases: Type.Integer({ minimum: 2 }),
        completedCases: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    benchmark: Type.Union([TestRunBenchmarkSchema, Type.Null()]),
    error: Type.Union([TestRunErrorSchema, Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    startedAt: NullableDateTimeSchema,
    completedAt: NullableDateTimeSchema,
  },
  { additionalProperties: false },
)

const TestRunUsageSchema = Type.Object(
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

const AssertionEvidenceSchema = Type.Object(
  {
    source: Type.Union([
      Type.Literal("assistant_output"),
      Type.Literal("tool_result"),
      Type.Literal("artifact"),
      Type.Literal("execution_error"),
    ]),
    reference: Type.String({ minLength: 1 }),
    excerpt: Type.Union([
      Type.String({ maxLength: 4_000 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

const AssertionResultSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    assertionIndex: Type.Integer({ minimum: 0 }),
    assertion: Type.String({ minLength: 1, maxLength: 2_000 }),
    status: AssertionResultStatusSchema,
    reason: Type.String({ minLength: 1, maxLength: 10_000 }),
    evidence: Type.Array(AssertionEvidenceSchema),
  },
  { additionalProperties: false },
)

const TestRunArtifactSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    relativePath: Type.String({ minLength: 1, maxLength: 512 }),
    sha256: HashSchema,
    byteSize: Type.Integer({ minimum: 0 }),
    mediaTypeHint: Type.String({ minLength: 1 }),
    contentKind: Type.Union([
      Type.Literal("text"),
      Type.Literal("binary"),
    ]),
    downloadUrl: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const CaseErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const TestRunCaseSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    evalRevisionCaseId: Type.String({ format: "uuid" }),
    externalId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    side: Type.Union([
      Type.Literal("TARGET"),
      Type.Literal("BASELINE"),
    ]),
    executionOrder: Type.Integer({ minimum: 1 }),
    prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
    expectedOutput: Type.String({ minLength: 1, maxLength: 10_000 }),
    assertions: Type.Array(
      Type.String({ minLength: 1, maxLength: 2_000 }),
      { minItems: 1 },
    ),
    files: Type.Array(Type.String({ minLength: 1, maxLength: 512 })),
    inputFingerprint: HashSchema,
    participantExecutionFingerprint: HashSchema,
    executionStatus: TestRunCaseExecutionStatusSchema,
    assessmentStatus: TestRunCaseAssessmentStatusSchema,
    finalOutput: Type.Union([
      Type.String({ maxLength: 200_000 }),
      Type.Null(),
    ]),
    usage: Type.Union([TestRunUsageSchema, Type.Null()]),
    gradingUsage: Type.Union([TestRunUsageSchema, Type.Null()]),
    skillInvocationObserved: Type.Union([
      Type.Literal("OBSERVED"),
      Type.Literal("NOT_OBSERVED"),
      Type.Literal("NOT_APPLICABLE"),
      Type.Null(),
    ]),
    skillToolCallCount: Type.Integer({ minimum: 0 }),
    bundledScriptUses: Type.Array(
      Type.Object(
        {
          relativePath: Type.String({ minLength: 1, maxLength: 512 }),
          count: Type.Integer({ minimum: 1 }),
          evidenceSequences: Type.Array(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
    ),
    executionError: Type.Union([CaseErrorSchema, Type.Null()]),
    assessmentError: Type.Union([CaseErrorSchema, Type.Null()]),
    assertionResults: Type.Array(AssertionResultSchema),
    artifacts: Type.Array(TestRunArtifactSchema),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    startedAt: NullableDateTimeSchema,
    executionCompletedAt: NullableDateTimeSchema,
    assessmentCompletedAt: NullableDateTimeSchema,
  },
  { additionalProperties: false },
)

export const TestRunDetailSchema = Type.Intersect([
  TestRunSchema,
  Type.Object(
    {
      cases: Type.Array(TestRunCaseSchema),
    },
    { additionalProperties: false },
  ),
])

export const TestRunPageSchema = Type.Object(
  {
    items: Type.Array(TestRunSchema),
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
        active: Type.Integer({ minimum: 0 }),
        completed: Type.Integer({ minimum: 0 }),
        interrupted: Type.Integer({ minimum: 0 }),
        failed: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const TestRunEventSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 80 }),
    runId: Type.String({ format: "uuid" }),
    caseId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    occurredAt: Type.String({ format: "date-time" }),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
)

export const TestRunLogsQuerySchema = Type.Object(
  {
    beforeSequence: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    side: Type.Optional(
      Type.Union([Type.Literal("TARGET"), Type.Literal("BASELINE")]),
    ),
    externalId: Type.Optional(Type.Integer({ minimum: 1 })),
    phase: Type.Optional(
      Type.Union([
        Type.Literal("execution"),
        Type.Literal("grading"),
        Type.Literal("orchestration"),
      ]),
    ),
  },
  { additionalProperties: false },
)

export const TestRunLogPageSchema = Type.Object(
  {
    items: Type.Array(TestRunEventSchema),
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

export const TestRunEventsQuerySchema = Type.Object(
  {
    afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
)

export const TestRunEventsHeaderSchema = Type.Object(
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

export type StartTestRunBody = Static<typeof StartTestRunBodySchema>
