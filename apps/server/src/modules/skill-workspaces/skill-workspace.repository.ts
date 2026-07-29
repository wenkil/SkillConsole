import { and, count, desc, eq, inArray } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDrafts,
  skillDraftFiles,
  skillImprovementCycles,
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

async function mapWorkspace(
  database: Database,
  row: typeof skillWorkspaces.$inferSelect,
): Promise<SkillWorkspace> {
  const [onlineRow, draftRow, versionCountRow] = await Promise.all([
    row.currentOnlineVersionId
      ? database
          .select({
            id: skillVersions.id,
            sequenceNumber: skillVersions.sequenceNumber,
            name: skillVersions.name,
            labels: skillVersions.labels,
            sourceType: skillVersions.sourceType,
            sourceName: skillVersions.sourceName,
            frozenAt: skillVersions.frozenAt,
            snapshotId: skillSnapshots.id,
            manifestHash: skillSnapshots.manifestHash,
            fileCount: skillSnapshots.fileCount,
            totalBytes: skillSnapshots.totalBytes,
          })
          .from(skillVersions)
          .innerJoin(
            skillSnapshots,
            eq(skillSnapshots.id, skillVersions.snapshotId),
          )
          .where(eq(skillVersions.id, row.currentOnlineVersionId))
          .limit(1)
      : Promise.resolve([]),
    database
      .select()
      .from(skillDrafts)
      .where(
        and(
          eq(skillDrafts.workspaceId, row.id),
          inArray(skillDrafts.status, ["OPEN", "FINALIZING"]),
        ),
      )
      .limit(1),
    database
      .select({ value: count() })
      .from(skillVersions)
      .where(eq(skillVersions.workspaceId, row.id)),
  ])
  const online = onlineRow[0]
  const draft = draftRow[0]

  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versionCount: Number(versionCountRow[0]?.value ?? 0),
    onlineVersion: online
      ? {
          id: online.id,
          sequenceNumber: online.sequenceNumber,
          name: online.name,
          labels: [...online.labels],
          sourceType: online.sourceType,
          sourceName: online.sourceName,
          frozenAt: online.frozenAt.toISOString(),
          isComparisonBaseline:
            row.comparisonBaselineVersionId === online.id,
          snapshot: {
            id: online.snapshotId,
            manifestHash: online.manifestHash,
            fileCount: online.fileCount,
            totalBytes: online.totalBytes,
          },
        }
      : null,
    activeDraft:
      draft && draft.status === "OPEN"
        ? {
            id: draft.id,
            contentRevision: draft.contentRevision,
            status: "OPEN",
            sourceType: draft.sourceType,
            sourceName: draft.sourceName,
            createdAt: draft.createdAt.toISOString(),
            updatedAt: draft.updatedAt.toISOString(),
            workingCopy: {
              fileCount: draft.fileCount,
              totalBytes: draft.totalBytes,
            },
          }
        : null,
  }
}

export async function listSkillWorkspaces(
  database: Database,
): Promise<SkillWorkspace[]> {
  const rows = await database
    .select()
    .from(skillWorkspaces)
    .orderBy(desc(skillWorkspaces.createdAt))
  return Promise.all(rows.map((row) => mapWorkspace(database, row)))
}

export async function findSkillWorkspace(
  database: Database,
  workspaceId: string,
): Promise<SkillWorkspace | null> {
  const [row] = await database
    .select()
    .from(skillWorkspaces)
    .where(eq(skillWorkspaces.id, workspaceId))
    .limit(1)
  return row ? mapWorkspace(database, row) : null
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
      readonly fileCount: number
      readonly totalBytes: number
      readonly manifestHash: string
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

  if (
    existing.state === "SUCCEEDED" &&
    existing.workspaceId &&
    existing.draftId &&
    existing.manifestHash
  ) {
    const [draft] = await database
      .select({
        fileCount: skillDrafts.fileCount,
        totalBytes: skillDrafts.totalBytes,
      })
      .from(skillDrafts)
      .where(eq(skillDrafts.id, existing.draftId))
      .limit(1)
    if (!draft) {
      throw new Error(
        `Succeeded upload operation ${existing.id} has no persisted working copy.`,
      )
    }

    return {
      kind: "replayed",
      workspaceId: existing.workspaceId,
      fileCount: draft.fileCount,
      totalBytes: draft.totalBytes,
      manifestHash: existing.manifestHash,
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
  state: "VALIDATING" | "COMMITTING",
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

export interface CreateInitialCandidateInput {
  readonly operationId: string
  readonly workspaceId: string
  readonly workspaceName: string
  readonly draftId: string
  readonly improvementCycleId: string
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly ignoredFileCount: number
  readonly strippedRoot: string | null
  readonly workingStorageLocator: string
  readonly manifest: SnapshotManifest
}

export async function createInitialCandidate(
  database: Database,
  input: CreateInitialCandidateInput,
): Promise<void> {
  const now = new Date()

  await database.transaction(async (transaction) => {
    await transaction.insert(skillWorkspaces).values({
      id: input.workspaceId,
      name: input.workspaceName,
      createdAt: now,
      updatedAt: now,
    })

    await transaction.insert(skillDrafts).values({
      id: input.draftId,
      workspaceId: input.workspaceId,
      baseVersionId: null,
      baseSnapshotId: null,
      currentSnapshotId: null,
      workingStorageLocator: input.workingStorageLocator,
      fileCount: input.manifest.fileCount,
      totalBytes: input.manifest.totalBytes,
      status: "OPEN",
      contentRevision: 1,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      createdAt: now,
      updatedAt: now,
    })

    for (let index = 0; index < input.manifest.files.length; index += 1_000) {
      await transaction.insert(skillDraftFiles).values(
        input.manifest.files.slice(index, index + 1_000).map((file) => ({
          draftId: input.draftId,
          relativePath: file.relativePath,
          sha256: file.sha256,
          byteSize: file.byteSize,
          mediaTypeHint: file.mediaTypeHint,
          contentKind: file.contentKind,
        })),
      )
    }

    await transaction.insert(skillImprovementCycles).values({
      id: input.improvementCycleId,
      workspaceId: input.workspaceId,
      baseVersionId: null,
      draftId: input.draftId,
      releasedVersionId: null,
      status: "DRAFTING",
      createdAt: now,
      updatedAt: now,
    })

    await transaction
      .update(uploadOperations)
      .set({
        workspaceId: input.workspaceId,
        snapshotId: null,
        draftId: input.draftId,
        improvementCycleId: input.improvementCycleId,
        sourceName: input.sourceName,
        manifestHash: input.manifest.manifestHash,
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
    snapshotId: operation.snapshotId,
    draftId: operation.draftId,
    improvementCycleId: operation.improvementCycleId,
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
