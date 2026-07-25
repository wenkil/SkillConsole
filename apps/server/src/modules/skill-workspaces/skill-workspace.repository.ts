import { and, desc, eq } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
  uploadOperations,
  type Database,
  type SkillSourceType,
} from "../../infrastructure/database/index.js"

import type {
  SkillWorkspace,
  UploadOperation,
} from "./skill-workspace.contract.js"
import type { SnapshotManifest } from "./snapshot-manifest.js"

interface WorkspaceQueryRow {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly workspaceCreatedAt: Date
  readonly workspaceUpdatedAt: Date
  readonly defaultBaselineVersionId: string | null
  readonly versionId: string | null
  readonly versionNumber: number | null
  readonly sourceType: SkillSourceType | null
  readonly sourceName: string | null
  readonly publishedAt: Date | null
  readonly snapshotId: string | null
  readonly manifestHash: string | null
  readonly fileCount: number | null
  readonly totalBytes: number | null
}

function workspaceSelection() {
  return {
    workspaceId: skillWorkspaces.id,
    workspaceName: skillWorkspaces.name,
    workspaceCreatedAt: skillWorkspaces.createdAt,
    workspaceUpdatedAt: skillWorkspaces.updatedAt,
    defaultBaselineVersionId: skillWorkspaces.defaultBaselineVersionId,
    versionId: skillVersions.id,
    versionNumber: skillVersions.versionNumber,
    sourceType: skillVersions.sourceType,
    sourceName: skillVersions.sourceName,
    publishedAt: skillVersions.publishedAt,
    snapshotId: skillSnapshots.id,
    manifestHash: skillSnapshots.manifestHash,
    fileCount: skillSnapshots.fileCount,
    totalBytes: skillSnapshots.totalBytes,
  }
}

function mapWorkspaceRow(row: WorkspaceQueryRow): SkillWorkspace {
  if (
    !row.versionId ||
    row.versionNumber === null ||
    !row.sourceType ||
    !row.sourceName ||
    !row.publishedAt ||
    !row.snapshotId ||
    !row.manifestHash ||
    row.fileCount === null ||
    row.totalBytes === null
  ) {
    throw new Error(
      `Skill workspace ${row.workspaceId} does not have a complete current version.`,
    )
  }

  return {
    id: row.workspaceId,
    name: row.workspaceName,
    createdAt: row.workspaceCreatedAt.toISOString(),
    updatedAt: row.workspaceUpdatedAt.toISOString(),
    currentVersion: {
      id: row.versionId,
      versionNumber: row.versionNumber,
      sourceType: row.sourceType,
      sourceName: row.sourceName,
      publishedAt: row.publishedAt.toISOString(),
      isDefaultBaseline: row.defaultBaselineVersionId === row.versionId,
      snapshot: {
        id: row.snapshotId,
        manifestHash: row.manifestHash,
        fileCount: row.fileCount,
        totalBytes: row.totalBytes,
      },
    },
  }
}

function baseWorkspaceQuery(database: Database) {
  return database
    .select(workspaceSelection())
    .from(skillWorkspaces)
    .leftJoin(
      skillVersions,
      eq(skillVersions.id, skillWorkspaces.currentVersionId),
    )
    .leftJoin(skillSnapshots, eq(skillSnapshots.id, skillVersions.snapshotId))
}

export async function listSkillWorkspaces(
  database: Database,
): Promise<SkillWorkspace[]> {
  const rows = await baseWorkspaceQuery(database).orderBy(
    desc(skillWorkspaces.createdAt),
  )
  return rows.map(mapWorkspaceRow)
}

export async function findSkillWorkspace(
  database: Database,
  workspaceId: string,
): Promise<SkillWorkspace | null> {
  const [row] = await baseWorkspaceQuery(database)
    .where(eq(skillWorkspaces.id, workspaceId))
    .limit(1)
  return row ? mapWorkspaceRow(row) : null
}

export async function getSkillWorkspace(
  database: Database,
  workspaceId: string,
): Promise<SkillWorkspace> {
  const workspace = await findSkillWorkspace(database, workspaceId)
  if (!workspace) {
    throw new DomainError({
      code: "SKILL_WORKSPACE_NOT_FOUND",
      message: "The requested Skill testing workbench was not found.",
      kind: "not_found",
    })
  }

  return workspace
}

export interface PrepareUploadOperationInput {
  readonly id: string
  readonly workspaceName: string
  readonly sourceType: SkillSourceType
}

export type PreparedUploadOperation =
  | { readonly kind: "receiving" }
  | {
      readonly kind: "replayed"
      readonly workspaceId: string
      readonly ignoredFileCount: number
      readonly strippedRoot: string | null
    }

export async function prepareUploadOperation(
  database: Database,
  input: PrepareUploadOperationInput,
): Promise<PreparedUploadOperation> {
  const [inserted] = await database
    .insert(uploadOperations)
    .values({
      id: input.id,
      workspaceName: input.workspaceName,
      sourceType: input.sourceType,
      state: "RECEIVING",
    })
    .onConflictDoNothing({ target: uploadOperations.id })
    .returning({ id: uploadOperations.id })

  if (inserted) return { kind: "receiving" }

  const [existing] = await database
    .select()
    .from(uploadOperations)
    .where(eq(uploadOperations.id, input.id))
    .limit(1)

  if (!existing) {
    throw new Error("An upload operation disappeared after a conflict.")
  }

  if (
    existing.workspaceName !== input.workspaceName ||
    existing.sourceType !== input.sourceType
  ) {
    throw new DomainError({
      code: "UPLOAD_OPERATION_CONFLICT",
      message: "This upload operation identifier belongs to another request.",
      kind: "conflict",
    })
  }

  if (existing.state === "SUCCEEDED" && existing.workspaceId) {
    return {
      kind: "replayed",
      workspaceId: existing.workspaceId,
      ignoredFileCount: existing.ignoredFileCount,
      strippedRoot: existing.strippedRoot,
    }
  }

  if (existing.state !== "FAILED") {
    throw new DomainError({
      code: "UPLOAD_OPERATION_IN_PROGRESS",
      message: "This upload operation is already in progress.",
      kind: "conflict",
    })
  }

  const [retried] = await database
    .update(uploadOperations)
    .set({
      state: "RECEIVING",
      sourceName: null,
      errorCode: null,
      errorMessage: null,
      errorDetails: null,
      updatedAt: new Date(),
      completedAt: null,
    })
    .where(
      and(
        eq(uploadOperations.id, input.id),
        eq(uploadOperations.state, "FAILED"),
      ),
    )
    .returning({ id: uploadOperations.id })

  if (!retried) {
    throw new DomainError({
      code: "UPLOAD_OPERATION_IN_PROGRESS",
      message: "This upload operation is already being retried.",
      kind: "conflict",
    })
  }

  return { kind: "receiving" }
}

export async function updateUploadOperationState(
  database: Database,
  operationId: string,
  state: "VALIDATING" | "PUBLISHING",
  sourceName?: string,
): Promise<void> {
  await database
    .update(uploadOperations)
    .set({
      state,
      ...(sourceName ? { sourceName } : {}),
      updatedAt: new Date(),
    })
    .where(eq(uploadOperations.id, operationId))
}

export async function failUploadOperation(
  database: Database,
  operationId: string,
  error: {
    readonly code: string
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await database
    .update(uploadOperations)
    .set({
      state: "FAILED",
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details ? { ...error.details } : null,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(uploadOperations.id, operationId))
}

export interface PublishInitialVersionInput {
  readonly operationId: string
  readonly workspaceId: string
  readonly workspaceName: string
  readonly snapshotId: string
  readonly versionId: string
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly ignoredFileCount: number
  readonly strippedRoot: string | null
  readonly storageLocator: string
  readonly manifest: SnapshotManifest
}

export async function publishInitialVersion(
  database: Database,
  input: PublishInitialVersionInput,
): Promise<void> {
  const now = new Date()

  await database.transaction(async (transaction) => {
    await transaction.insert(skillWorkspaces).values({
      id: input.workspaceId,
      name: input.workspaceName,
      createdAt: now,
      updatedAt: now,
    })

    await transaction.insert(skillSnapshots).values({
      id: input.snapshotId,
      workspaceId: input.workspaceId,
      kind: "VERSION",
      state: "READY",
      manifestHash: input.manifest.manifestHash,
      storageLocator: input.storageLocator,
      fileCount: input.manifest.fileCount,
      totalBytes: input.manifest.totalBytes,
      createdAt: now,
    })

    await transaction.insert(skillSnapshotFiles).values(
      input.manifest.files.map((file) => ({
        snapshotId: input.snapshotId,
        relativePath: file.relativePath,
        sha256: file.sha256,
        byteSize: file.byteSize,
        mediaTypeHint: file.mediaTypeHint,
        contentKind: file.contentKind,
      })),
    )

    await transaction.insert(skillVersions).values({
      id: input.versionId,
      workspaceId: input.workspaceId,
      snapshotId: input.snapshotId,
      versionNumber: 1,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      createdAt: now,
      publishedAt: now,
    })

    await transaction
      .update(skillWorkspaces)
      .set({
        currentVersionId: input.versionId,
        defaultBaselineVersionId: input.versionId,
        updatedAt: now,
      })
      .where(eq(skillWorkspaces.id, input.workspaceId))

    await transaction
      .update(uploadOperations)
      .set({
        workspaceId: input.workspaceId,
        snapshotId: input.snapshotId,
        versionId: input.versionId,
        sourceName: input.sourceName,
        ignoredFileCount: input.ignoredFileCount,
        strippedRoot: input.strippedRoot,
        state: "SUCCEEDED",
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(uploadOperations.id, input.operationId))
  })
}

export async function getUploadOperation(
  database: Database,
  operationId: string,
): Promise<UploadOperation> {
  const [operation] = await database
    .select()
    .from(uploadOperations)
    .where(eq(uploadOperations.id, operationId))
    .limit(1)

  if (!operation) {
    throw new DomainError({
      code: "UPLOAD_OPERATION_NOT_FOUND",
      message: "The requested upload operation was not found.",
      kind: "not_found",
    })
  }

  return {
    id: operation.id,
    state: operation.state,
    workspaceId: operation.workspaceId,
    error:
      operation.errorCode && operation.errorMessage
        ? {
            code: operation.errorCode,
            message: operation.errorMessage,
            ...(operation.errorDetails
              ? { details: operation.errorDetails }
              : {}),
          }
        : null,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  }
}
