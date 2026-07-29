import { Type, type Static } from "typebox"

import {
  SkillSourceTypeSchema,
  SnapshotSummarySchema,
} from "./skill-workspace.contract.js"

export const SnapshotStateSchema = Type.Union([
  Type.Literal("STAGING"),
  Type.Literal("READY"),
  Type.Literal("CORRUPTED"),
])

export const VersionBrowserSnapshotSchema = Type.Intersect(
  [
    SnapshotSummarySchema,
    Type.Object(
      {
        state: SnapshotStateSchema,
        createdAt: Type.String({ format: "date-time" }),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
)

export const SkillVersionBrowserSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    sequenceNumber: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Union([
      Type.String({ maxLength: 2_000 }),
      Type.Null(),
    ]),
    labels: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
      maxItems: 20,
    }),
    sourceType: SkillSourceTypeSchema,
    sourceName: Type.String({ minLength: 1 }),
    createdAt: Type.String({ format: "date-time" }),
    frozenAt: Type.String({ format: "date-time" }),
    isOnline: Type.Boolean(),
    isComparisonBaseline: Type.Boolean(),
    snapshot: VersionBrowserSnapshotSchema,
  },
  { additionalProperties: false },
)

export const SkillVersionBrowserListSchema = Type.Array(
  SkillVersionBrowserSchema,
)

export const SkillDraftBrowserSchema = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    contentRevision: Type.Integer({ minimum: 1 }),
    status: Type.Literal("OPEN"),
    sourceType: SkillSourceTypeSchema,
    sourceName: Type.String({ minLength: 1 }),
    ignoreRules: Type.Array(Type.String({ maxLength: 512 }), {
      maxItems: 200,
    }),
    ignoredPaths: Type.Array(
      Type.Object(
        {
          relativePath: Type.String({ minLength: 1, maxLength: 512 }),
          reason: Type.Union([
            Type.Literal("protected"),
            Type.Literal("skillconsoleignore"),
            Type.Literal("custom"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    workingCopy: Type.Object(
      {
        fileCount: Type.Integer({ minimum: 1 }),
        totalBytes: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const WorkspaceVersionParamsSchema = Type.Object(
  {
    workspaceId: Type.String({ format: "uuid" }),
    versionId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const VersionFilePathQuerySchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 512 }),
  },
  { additionalProperties: false },
)

export const SnapshotFilePreviewKindSchema = Type.Union([
  Type.Literal("markdown"),
  Type.Literal("json"),
  Type.Literal("yaml"),
  Type.Literal("text"),
  Type.Literal("image"),
  Type.Literal("binary"),
])

export const SnapshotFileSchema = Type.Object(
  {
    relativePath: Type.String({ minLength: 1, maxLength: 512 }),
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    byteSize: Type.Integer({ minimum: 0 }),
    mediaTypeHint: Type.String({ minLength: 1 }),
    contentKind: Type.Union([
      Type.Literal("text"),
      Type.Literal("binary"),
    ]),
    previewKind: SnapshotFilePreviewKindSchema,
    previewable: Type.Boolean(),
  },
  { additionalProperties: false },
)

export const SnapshotFileListSchema = Type.Object(
  {
    targetId: Type.String({ format: "uuid" }),
    files: Type.Array(SnapshotFileSchema),
  },
  { additionalProperties: false },
)

export const CreateSkillVersionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Optional(
      Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    ),
    labels: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
        maxItems: 20,
      }),
    ),
    setOnline: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

export const UpdateSkillVersionMetadataSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    description: Type.Optional(
      Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    ),
    labels: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
        maxItems: 20,
      }),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
)

export const VersionComparisonQuerySchema = Type.Object(
  {
    leftVersionId: Type.String({ format: "uuid" }),
    rightVersionId: Type.String({ format: "uuid" }),
  },
  { additionalProperties: false },
)

export const VersionComparisonFileSideSchema = Type.Union([
  SnapshotFileSchema,
  Type.Null(),
])

export const VersionComparisonSchema = Type.Object(
  {
    leftVersion: SkillVersionBrowserSchema,
    rightVersion: SkillVersionBrowserSchema,
    summary: Type.Object(
      {
        added: Type.Integer({ minimum: 0 }),
        modified: Type.Integer({ minimum: 0 }),
        deleted: Type.Integer({ minimum: 0 }),
        unchanged: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    entries: Type.Array(
      Type.Object(
        {
          relativePath: Type.String({ minLength: 1, maxLength: 512 }),
          status: Type.Union([
            Type.Literal("ADDED"),
            Type.Literal("MODIFIED"),
            Type.Literal("DELETED"),
            Type.Literal("UNCHANGED"),
          ]),
          left: VersionComparisonFileSideSchema,
          right: VersionComparisonFileSideSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

export const TextFilePreviewSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("markdown"),
      Type.Literal("json"),
      Type.Literal("yaml"),
      Type.Literal("text"),
    ]),
    relativePath: Type.String({ minLength: 1, maxLength: 512 }),
    mediaType: Type.String({ minLength: 1 }),
    encoding: Type.Literal("utf-8"),
    content: Type.String(),
  },
  { additionalProperties: false },
)

export type SkillVersionBrowser = Static<
  typeof SkillVersionBrowserSchema
>
export type SkillDraftBrowser = Static<typeof SkillDraftBrowserSchema>
export type SnapshotFile = Static<typeof SnapshotFileSchema>
export type SnapshotFilePreviewKind = Static<
  typeof SnapshotFilePreviewKindSchema
>
export type TextFilePreview = Static<typeof TextFilePreviewSchema>
export type CreateSkillVersion = Static<typeof CreateSkillVersionSchema>
export type UpdateSkillVersionMetadata = Static<
  typeof UpdateSkillVersionMetadataSchema
>
export type VersionComparison = Static<typeof VersionComparisonSchema>
