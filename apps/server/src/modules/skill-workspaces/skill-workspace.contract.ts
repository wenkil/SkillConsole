import { Type, type Static } from "typebox"

export const SkillSourceTypeSchema = Type.Union([
  Type.Literal("single_file"),
  Type.Literal("folder"),
  Type.Literal("zip"),
])

export const SnapshotSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    manifestHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    fileCount: Type.Integer({ minimum: 1 }),
    totalBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export const SkillVersionSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    versionNumber: Type.Integer({ minimum: 1 }),
    sourceType: SkillSourceTypeSchema,
    sourceName: Type.String({ minLength: 1 }),
    publishedAt: Type.String({ format: "date-time" }),
    isDefaultBaseline: Type.Boolean(),
    snapshot: SnapshotSummarySchema,
  },
  { additionalProperties: false },
)

export const SkillDraftSummarySchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    improvementCycleId: Type.String({ format: "uuid" }),
    baseVersionId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    baseSnapshotId: Type.String({ format: "uuid" }),
    contentRevision: Type.Integer({ minimum: 1 }),
    status: Type.Union([
      Type.Literal("OPEN"),
      Type.Literal("FINALIZING"),
    ]),
    sourceType: SkillSourceTypeSchema,
    sourceName: Type.String({ minLength: 1 }),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    snapshot: SnapshotSummarySchema,
  },
  { additionalProperties: false },
)

export const SkillWorkspaceSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    currentVersion: Type.Union([SkillVersionSummarySchema, Type.Null()]),
    activeDraft: Type.Union([SkillDraftSummarySchema, Type.Null()]),
  },
  { additionalProperties: false },
)

export const SkillWorkspaceListSchema = Type.Array(SkillWorkspaceSchema)

export const UploadSummarySchema = Type.Object(
  {
    operationId: Type.String({ format: "uuid" }),
    fileCount: Type.Integer({ minimum: 1 }),
    totalBytes: Type.Integer({ minimum: 0 }),
    ignoredFileCount: Type.Integer({ minimum: 0 }),
    strippedRoot: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    manifestHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
)

export const CreateSkillWorkspaceResponseSchema = Type.Object(
  {
    workspace: SkillWorkspaceSchema,
    upload: UploadSummarySchema,
    replayed: Type.Boolean(),
  },
  { additionalProperties: false },
)

export const WorkspaceIdParamsSchema = Type.Object(
  {
    workspaceId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const UploadOperationIdParamsSchema = Type.Object(
  {
    operationId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const UploadOperationSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    state: Type.Union([
      Type.Literal("RECEIVING"),
      Type.Literal("VALIDATING"),
      Type.Literal("COMMITTING"),
      Type.Literal("SUCCEEDED"),
      Type.Literal("FAILED"),
    ]),
    workspaceId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    snapshotId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    draftId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    improvementCycleId: Type.Union([
      Type.String({ format: "uuid" }),
      Type.Null(),
    ]),
    error: Type.Union([
      Type.Object(
        {
          code: Type.String({ minLength: 1 }),
          message: Type.String({ minLength: 1 }),
          details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
)

export type SkillWorkspace = Static<typeof SkillWorkspaceSchema>
export type CreateSkillWorkspaceResponse = Static<
  typeof CreateSkillWorkspaceResponseSchema
>
export type UploadOperation = Static<typeof UploadOperationSchema>
