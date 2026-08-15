import { Type, type Static } from "typebox"

const NullableUuidSchema = Type.Union([
  Type.String({ format: "uuid" }),
  Type.Null(),
])

export const EvalGenerationStatusSchema = Type.Union([
  Type.Literal("PREPARING"),
  Type.Literal("RUNNING"),
  Type.Literal("VALIDATING"),
  Type.Literal("SUCCEEDED"),
  Type.Literal("CANCELING"),
  Type.Literal("CANCELED"),
  Type.Literal("INTERRUPTED"),
  Type.Literal("FAILED"),
])

const EvalTargetInputSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("draft"),
      draftId: Type.String({ format: "uuid" }),
      contentRevision: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("version"),
      versionId: Type.String({ format: "uuid" }),
    },
    { additionalProperties: false },
  ),
])

export const StartEvalGenerationBodySchema = Type.Object(
  {
    target: EvalTargetInputSchema,
    maxEvalCount: Type.Integer({ minimum: 1, maximum: 20 }),
    generationBrief: Type.Optional(
      Type.Union([
        Type.String({ maxLength: 4_000 }),
        Type.Null(),
      ]),
    ),
  },
  { additionalProperties: false },
)

export const EvalGenerationStartHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[\\x21-\\x7e]+$",
    }),
  },
  { additionalProperties: true },
)

export const WorkspaceEvalParamsSchema = Type.Object(
  {
    workspaceId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const EvalGenerationParamsSchema = Type.Object(
  {
    taskId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const EvalGenerationListQuerySchema = Type.Object(
  {
    page: Type.Optional(
      Type.Integer({ minimum: 1 }),
    ),
    pageSize: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100 }),
    ),
  },
  { additionalProperties: false },
)

const EvalGenerationTargetSchema = Type.Object(
  {
    sourceKind: Type.Union([
      Type.Literal("DRAFT_REVISION"),
      Type.Literal("SKILL_VERSION"),
    ]),
    snapshotId: Type.String({ format: "uuid" }),
    versionId: NullableUuidSchema,
    draftRevisionId: NullableUuidSchema,
    skillName: Type.String({ minLength: 1, maxLength: 64 }),
    displayVersion: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const EvalGenerationErrorSchema = Type.Object(
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

export const EvalGenerationTaskSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    suiteId: Type.String({ format: "uuid" }),
    workspaceId: Type.String({ format: "uuid" }),
    status: EvalGenerationStatusSchema,
    target: EvalGenerationTargetSchema,
    maxEvalCount: Type.Integer({ minimum: 1, maximum: 20 }),
    generationBrief: Type.Union([
      Type.String({ maxLength: 4_000 }),
      Type.Null(),
    ]),
    error: Type.Union([EvalGenerationErrorSchema, Type.Null()]),
    usage: Type.Union([
      Type.Record(Type.String(), Type.Number({ minimum: 0 })),
      Type.Null(),
    ]),
    draftId: NullableUuidSchema,
    draftStatus: Type.Union([
      Type.Literal("READY"),
      Type.Literal("PUBLISHED"),
      Type.Literal("DISCARDED"),
      Type.Null(),
    ]),
    evalCount: Type.Union([
      Type.Integer({ minimum: 0 }),
      Type.Null(),
    ]),
    fileCount: Type.Union([
      Type.Integer({ minimum: 0 }),
      Type.Null(),
    ]),
    revisionNumber: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    startedAt: Type.Union([
      Type.String({ format: "date-time" }),
      Type.Null(),
    ]),
    completedAt: Type.Union([
      Type.String({ format: "date-time" }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

export const EvalGenerationTaskPageSchema = Type.Object(
  {
    items: Type.Array(EvalGenerationTaskSchema),
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
        running: Type.Integer({ minimum: 0 }),
        awaitingReview: Type.Integer({ minimum: 0 }),
        published: Type.Integer({ minimum: 0 }),
        failed: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const EvalGenerationFailureSummarySchema = Type.Object(
  {
    evalsJsonState: Type.Union([
      Type.Literal("MISSING"),
      Type.Literal("INVALID_JSON"),
      Type.Literal("ROOT_INVALID"),
      Type.Literal("VALID"),
    ]),
    evalCount: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    incompleteCaseIndexes: Type.Array(Type.Integer({ minimum: 1 })),
    ignoredFiles: Type.Array(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
)

const StoredEvalCaseSchema = Type.Object(
  {
    externalId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    prompt: Type.String({ minLength: 1, maxLength: 20_000 }),
    expectedOutput: Type.String({
      minLength: 1,
      maxLength: 10_000,
    }),
    assertions: Type.Array(
      Type.String({ minLength: 1, maxLength: 2_000 }),
      { minItems: 1 },
    ),
    files: Type.Array(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
  },
  { additionalProperties: false },
)

const StoredEvalFileSchema = Type.Object(
  {
    relativePath: Type.String({ minLength: 1, maxLength: 512 }),
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    byteSize: Type.Integer({ minimum: 0 }),
    mediaTypeHint: Type.String({ minLength: 1 }),
    contentKind: Type.Union([
      Type.Literal("text"),
      Type.Literal("binary"),
    ]),
  },
  { additionalProperties: false },
)

export const EvalGenerationDraftSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    taskId: Type.String({ format: "uuid" }),
    status: Type.Union([
      Type.Literal("READY"),
      Type.Literal("PUBLISHED"),
      Type.Literal("DISCARDED"),
    ]),
    sourceSchemaVariant: Type.Union([
      Type.Literal("assertions"),
      Type.Literal("expectations"),
      Type.Literal("mixed"),
    ]),
    rawEvalsSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    manifestHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    evalCount: Type.Integer({ minimum: 1 }),
    fileCount: Type.Integer({ minimum: 0 }),
    totalBytes: Type.Integer({ minimum: 0 }),
    cases: Type.Array(StoredEvalCaseSchema, { minItems: 1 }),
    files: Type.Array(StoredEvalFileSchema),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
)

export const EvalRevisionSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    suiteId: Type.String({ format: "uuid" }),
    sequenceNumber: Type.Integer({ minimum: 1 }),
    skillName: Type.String({ minLength: 1, maxLength: 64 }),
    sourceGenerationTaskId: Type.String({ format: "uuid" }),
    sourceSnapshotId: Type.String({ format: "uuid" }),
    manifestHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    rawEvalsSha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    evalCount: Type.Integer({ minimum: 1 }),
    fileCount: Type.Integer({ minimum: 0 }),
    totalBytes: Type.Integer({ minimum: 0 }),
    createdAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
)

export const EvalRevisionListSchema = Type.Array(EvalRevisionSchema)

export const PublishEvalRevisionResponseSchema = Type.Object(
  {
    replayed: Type.Boolean(),
    revision: EvalRevisionSchema,
  },
  { additionalProperties: false },
)

export const EvalGenerationEventSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 80 }),
    taskId: Type.String({ format: "uuid" }),
    occurredAt: Type.String({ format: "date-time" }),
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
)

export const EvalGenerationEventsHeaderSchema = Type.Object(
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

export type StartEvalGenerationBody = Static<
  typeof StartEvalGenerationBodySchema
>
