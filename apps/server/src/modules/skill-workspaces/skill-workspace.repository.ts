import { and, desc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDrafts,
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
import { createSnapshotFileInsertBatches } from "./snapshot-file-insert-batches.js"
import type { SnapshotManifest } from "./snapshot-manifest.js"

interface WorkspaceQueryRow {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly workspaceCreatedAt: Date
  readonly workspaceUpdatedAt: Date
  readonly defaultBaselineVersionId: string | null
  readonly versionId: string | null
  readonly versionNumber: number | null
  readonly versionSourceType: SkillSourceType | null
  readonly versionSourceName: string | null
  readonly publishedAt: Date | null
  readonly versionSnapshotId: string | null
  readonly versionManifestHash: string | null
  readonly versionFileCount: number | null
  readonly versionTotalBytes: number | null
  readonly draftId: string | null
  readonly improvementCycleId: string | null
  readonly draftBaseVersionId: string | null
  readonly draftBaseSnapshotId: string | null
  readonly draftContentRevision: number | null
  readonly draftStatus: "OPEN" | "FINALIZING" | "CLOSED" | "ABANDONED" | null
  readonly draftSourceType: SkillSourceType | null
  readonly draftSourceName: string | null
  readonly draftCreatedAt: Date | null
  readonly draftUpdatedAt: Date | null
  readonly draftSnapshotId: string | null
  readonly draftManifestHash: string | null
  readonly draftFileCount: number | null
  readonly draftTotalBytes: number | null
}

const versionSnapshots = alias(skillSnapshots, "current_version_snapshots")
const draftSnapshots = alias(skillSnapshots, "active_draft_snapshots")

function workspaceSelection() {
  return {
    workspaceId: skillWorkspaces.id,
    workspaceName: skillWorkspaces.name,
    workspaceCreatedAt: skillWorkspaces.createdAt,
    workspaceUpdatedAt: skillWorkspaces.updatedAt,
    defaultBaselineVersionId: skillWorkspaces.defaultBaselineVersionId,
    versionId: skillVersions.id,
    versionNumber: skillVersions.versionNumber,
    versionSourceType: skillVersions.sourceType,
    versionSourceName: skillVersions.sourceName,
    publishedAt: skillVersions.publishedAt,
    versionSnapshotId: versionSnapshots.id,
    versionManifestHash: versionSnapshots.manifestHash,
    versionFileCount: versionSnapshots.fileCount,
    versionTotalBytes: versionSnapshots.totalBytes,
    draftId: skillDrafts.id,
    improvementCycleId: skillImprovementCycles.id,
    draftBaseVersionId: skillDrafts.baseVersionId,
    draftBaseSnapshotId: skillDrafts.baseSnapshotId,
    draftContentRevision: skillDrafts.contentRevision,
    draftStatus: skillDrafts.status,
    draftSourceType: skillDrafts.sourceType,
    draftSourceName: skillDrafts.sourceName,
    draftCreatedAt: skillDrafts.createdAt,
    draftUpdatedAt: skillDrafts.updatedAt,
    draftSnapshotId: draftSnapshots.id,
    draftManifestHash: draftSnapshots.manifestHash,
    draftFileCount: draftSnapshots.fileCount,
    draftTotalBytes: draftSnapshots.totalBytes,
  }
}

function mapWorkspaceRow(row: WorkspaceQueryRow): SkillWorkspace {
  let currentVersion: SkillWorkspace["currentVersion"] = null
  if (row.versionId) {
    if (
      row.versionNumber === null ||
      !row.versionSourceType ||
      !row.versionSourceName ||
      !row.publishedAt ||
      !row.versionSnapshotId ||
      !row.versionManifestHash ||
      row.versionFileCount === null ||
      row.versionTotalBytes === null
    ) {
      throw new Error(
        `Skill workspace ${row.workspaceId} has an incomplete current version.`,
      )
    }
    currentVersion = {
      id: row.versionId,
      versionNumber: row.versionNumber,
      sourceType: row.versionSourceType,
      sourceName: row.versionSourceName,
      publishedAt: row.publishedAt.toISOString(),
      isDefaultBaseline: row.defaultBaselineVersionId === row.versionId,
      snapshot: {
        id: row.versionSnapshotId,
        manifestHash: row.versionManifestHash,
        fileCount: row.versionFileCount,
        totalBytes: row.versionTotalBytes,
      },
    }
  }

  let activeDraft: SkillWorkspace["activeDraft"] = null
  if (row.draftId) {
    if (
      !row.improvementCycleId ||
      !row.draftBaseSnapshotId ||
      row.draftContentRevision === null ||
      (row.draftStatus !== "OPEN" && row.draftStatus !== "FINALIZING") ||
      !row.draftSourceType ||
      !row.draftSourceName ||
      !row.draftCreatedAt ||
      !row.draftUpdatedAt ||
      !row.draftSnapshotId ||
      !row.draftManifestHash ||
      row.draftFileCount === null ||
      row.draftTotalBytes === null
    ) {
      throw new Error(
        `Skill workspace ${row.workspaceId} has an incomplete active draft.`,
      )
    }
    activeDraft = {
      id: row.draftId,
      improvementCycleId: row.improvementCycleId,
      baseVersionId: row.draftBaseVersionId,
      baseSnapshotId: row.draftBaseSnapshotId,
      contentRevision: row.draftContentRevision,
      status: row.draftStatus,
      sourceType: row.draftSourceType,
      sourceName: row.draftSourceName,
      createdAt: row.draftCreatedAt.toISOString(),
      updatedAt: row.draftUpdatedAt.toISOString(),
      snapshot: {
        id: row.draftSnapshotId,
        manifestHash: row.draftManifestHash,
        fileCount: row.draftFileCount,
        totalBytes: row.draftTotalBytes,
      },
    }
  }

  return {
    id: row.workspaceId,
    name: row.workspaceName,
    createdAt: row.workspaceCreatedAt.toISOString(),
    updatedAt: row.workspaceUpdatedAt.toISOString(),
    currentVersion,
    activeDraft,
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
    .leftJoin(
      versionSnapshots,
      eq(versionSnapshots.id, skillVersions.snapshotId),
    )
    .leftJoin(
      skillDrafts,
      and(
        eq(skillDrafts.workspaceId, skillWorkspaces.id),
        inArray(skillDrafts.status, ["OPEN", "FINALIZING"]),
      ),
    )
    .leftJoin(
      draftSnapshots,
      eq(draftSnapshots.id, skillDrafts.currentSnapshotId),
    )
    .leftJoin(
      skillImprovementCycles,
      eq(skillImprovementCycles.draftId, skillDrafts.id),
    )
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
    existing.snapshotId
  ) {
    const [snapshot] = await database
      .select({
        fileCount: skillSnapshots.fileCount,
        totalBytes: skillSnapshots.totalBytes,
        manifestHash: skillSnapshots.manifestHash,
      })
      .from(skillSnapshots)
      .where(eq(skillSnapshots.id, existing.snapshotId))
      .limit(1)
    if (!snapshot) {
      throw new Error(
        `Succeeded upload operation ${existing.id} has no persisted Snapshot.`,
      )
    }

    return {
      kind: "replayed",
      workspaceId: existing.workspaceId,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
      manifestHash: snapshot.manifestHash,
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
  readonly snapshotId: string
  readonly draftId: string
  readonly improvementCycleId: string
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly ignoredFileCount: number
  readonly strippedRoot: string | null
  readonly storageLocator: string
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

    await transaction.insert(skillSnapshots).values({
      id: input.snapshotId,
      workspaceId: input.workspaceId,
      kind: "DRAFT_WORKING",
      state: "READY",
      manifestHash: input.manifest.manifestHash,
      storageLocator: input.storageLocator,
      fileCount: input.manifest.fileCount,
      totalBytes: input.manifest.totalBytes,
      createdAt: now,
    })

    for (const batch of createSnapshotFileInsertBatches(
      input.snapshotId,
      input.manifest.files,
    )) {
      await transaction.insert(skillSnapshotFiles).values(batch)
    }

    await transaction.insert(skillDrafts).values({
      id: input.draftId,
      workspaceId: input.workspaceId,
      baseVersionId: null,
      baseSnapshotId: input.snapshotId,
      currentSnapshotId: input.snapshotId,
      status: "OPEN",
      contentRevision: 1,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      createdAt: now,
      updatedAt: now,
    })

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
        snapshotId: input.snapshotId,
        draftId: input.draftId,
        improvementCycleId: input.improvementCycleId,
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
