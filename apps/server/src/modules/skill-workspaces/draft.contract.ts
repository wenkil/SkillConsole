import { Type, type Static } from "typebox"

import { SkillDraftBrowserSchema } from "./version-browser.contract.js"

export const DraftWriteHeadersSchema = Type.Object(
  {
    "if-match": Type.Optional(
      Type.String({ minLength: 1, maxLength: 300 }),
    ),
    "idempotency-key": Type.Optional(
      Type.String({ minLength: 1, maxLength: 200 }),
    ),
  },
  { additionalProperties: true },
)

export const DraftConditionalHeadersSchema = Type.Object(
  {
    "if-match": Type.Optional(
      Type.String({ minLength: 1, maxLength: 300 }),
    ),
  },
  { additionalProperties: true },
)

export const DraftTextSaveSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 512 }),
    content: Type.String(),
  },
  { additionalProperties: false },
)

export const DraftMoveFileSchema = Type.Object(
  {
    fromPath: Type.String({ minLength: 1, maxLength: 512 }),
    toPath: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
)

export const DraftMutationResponseSchema = Type.Object(
  {
    draft: SkillDraftBrowserSchema,
    replayed: Type.Boolean(),
  },
  { additionalProperties: false },
)

export const DraftDiffFileSideSchema = Type.Union([
  Type.Object(
    {
      sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
      byteSize: Type.Integer({ minimum: 0 }),
      mediaTypeHint: Type.String({ minLength: 1 }),
      contentKind: Type.Union([
        Type.Literal("text"),
        Type.Literal("binary"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Null(),
])

export const DraftDiffEntrySchema = Type.Object(
  {
    relativePath: Type.String({ minLength: 1, maxLength: 512 }),
    status: Type.Union([
      Type.Literal("ADDED"),
      Type.Literal("MODIFIED"),
      Type.Literal("DELETED"),
      Type.Literal("UNCHANGED"),
      Type.Literal("IGNORED"),
    ]),
    previewable: Type.Boolean(),
    base: DraftDiffFileSideSchema,
    current: DraftDiffFileSideSchema,
    ignoredReason: Type.Union([
      Type.Literal("protected"),
      Type.Literal("skillconsoleignore"),
      Type.Literal("custom"),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
)

export const DraftDiffSummarySchema = Type.Object(
  {
    added: Type.Integer({ minimum: 0 }),
    modified: Type.Integer({ minimum: 0 }),
    deleted: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
    ignored: Type.Integer({ minimum: 0 }),
    unpreviewable: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export const DraftDiffSchema = Type.Object(
  {
    basis: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("INITIAL_IMPORT"),
          Type.Literal("FORMAL_VERSION"),
        ]),
        snapshotId: Type.String({ format: "uuid" }),
        versionId: Type.Union([
          Type.String({ format: "uuid" }),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    currentSnapshotId: Type.String({ format: "uuid" }),
    contentRevision: Type.Integer({ minimum: 1 }),
    summary: DraftDiffSummarySchema,
    entries: Type.Array(DraftDiffEntrySchema),
  },
  { additionalProperties: false },
)

export const DraftFolderReplacementPreviewSchema = Type.Object(
  {
    operationId: Type.String({ format: "uuid" }),
    draftId: Type.String({ format: "uuid" }),
    baseContentRevision: Type.Integer({ minimum: 1 }),
    sourceName: Type.String({ minLength: 1 }),
    ignoreRules: Type.Array(Type.String({ maxLength: 512 })),
    summary: Type.Intersect([
      DraftDiffSummarySchema,
      Type.Object(
        {
          conflicts: Type.Integer({ minimum: 0 }),
          totalFiles: Type.Integer({ minimum: 0 }),
          totalBytes: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ]),
    conflicts: Type.Array(Type.String({ minLength: 1 })),
    requiresDeletionConfirmation: Type.Boolean(),
    committable: Type.Boolean(),
  },
  { additionalProperties: false },
)

export const DraftFolderCommitSchema = Type.Object(
  {
    confirmDeletions: Type.Boolean(),
  },
  { additionalProperties: false },
)

export const DraftOperationParamsSchema = Type.Object(
  {
    workspaceId: Type.String({ format: "uuid" }),
    operationId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export type DraftTextSave = Static<typeof DraftTextSaveSchema>
export type DraftMoveFile = Static<typeof DraftMoveFileSchema>
export type DraftMutationResponse = Static<
  typeof DraftMutationResponseSchema
>
export type DraftDiff = Static<typeof DraftDiffSchema>
export type DraftDiffEntry = Static<typeof DraftDiffEntrySchema>
export type DraftFolderReplacementPreview = Static<
  typeof DraftFolderReplacementPreviewSchema
>
