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
    versionNumber: Type.Integer({ minimum: 1 }),
    sourceType: SkillSourceTypeSchema,
    sourceName: Type.String({ minLength: 1 }),
    createdAt: Type.String({ format: "date-time" }),
    publishedAt: Type.String({ format: "date-time" }),
    isCurrent: Type.Boolean(),
    isDefaultBaseline: Type.Boolean(),
    snapshot: VersionBrowserSnapshotSchema,
  },
  { additionalProperties: false },
)

export const SkillVersionBrowserListSchema = Type.Array(
  SkillVersionBrowserSchema,
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
    snapshotId: Type.String({ format: "uuid" }),
    files: Type.Array(SnapshotFileSchema),
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
export type SnapshotFile = Static<typeof SnapshotFileSchema>
export type SnapshotFilePreviewKind = Static<
  typeof SnapshotFilePreviewKindSchema
>
export type TextFilePreview = Static<typeof TextFilePreviewSchema>
