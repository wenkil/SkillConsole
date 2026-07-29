import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDraftFiles,
  skillDraftMutations,
  skillDrafts,
  skillImprovementCycles,
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
  type Database,
  type SkillDraftFileRow,
  type SkillDraftRow,
  type SkillSourceType,
} from "../../infrastructure/database/index.js"

import type { DraftIgnoredPath } from "./draft-ignore.js"
import type { SnapshotManifestFile } from "./snapshot-manifest.js"
import {
  getActiveSkillDraft,
  type DraftFileRecord,
} from "./version-browser.repository.js"
import type { SkillDraftBrowser } from "./version-browser.contract.js"

export interface ActiveDraftContext {
  readonly id: string
  readonly workspaceId: string
  readonly seedSnapshotId: string | null
  readonly workingStorageLocator: string
  readonly contentRevision: number
  readonly status: SkillDraftRow["status"]
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly ignoreRules: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
  readonly fileCount: number
  readonly totalBytes: number
  readonly currentFiles: readonly SkillDraftFileRow[]
}

export function createDraftEtag(
  draftId: string,
  contentRevision: number,
): string {
  return `"draft-${draftId}-r${contentRevision}"`
}

export async function getActiveDraftContext(
  database: Database,
  workspaceId: string,
): Promise<ActiveDraftContext> {
  const [draft] = await database
    .select()
    .from(skillDrafts)
    .where(
      and(
        eq(skillDrafts.workspaceId, workspaceId),
        inArray(skillDrafts.status, ["OPEN", "FINALIZING"]),
      ),
    )
    .limit(1)

  if (!draft) {
    throw new DomainError({
      code: "SKILL_DRAFT_NOT_FOUND",
      message: "The requested Skill working copy was not found.",
      kind: "not_found",
    })
  }

  const currentFiles = await database
    .select()
    .from(skillDraftFiles)
    .where(eq(skillDraftFiles.draftId, draft.id))
    .orderBy(asc(skillDraftFiles.relativePath))

  return {
    id: draft.id,
    workspaceId: draft.workspaceId,
    seedSnapshotId: draft.currentSnapshotId,
    workingStorageLocator: draft.workingStorageLocator,
    contentRevision: draft.contentRevision,
    status: draft.status,
    sourceType: draft.sourceType,
    sourceName: draft.sourceName,
    ignoreRules: [...draft.ignoreRules],
    ignoredPaths: [...draft.currentIgnoredPaths],
    fileCount: draft.fileCount,
    totalBytes: draft.totalBytes,
    currentFiles,
  }
}

export async function getDraftFileRecord(
  database: Database,
  workspaceId: string,
  relativePath: string,
): Promise<DraftFileRecord> {
  const draft = await getActiveDraftContext(database, workspaceId)
  const [file] = await database
    .select()
    .from(skillDraftFiles)
    .where(
      and(
        eq(skillDraftFiles.draftId, draft.id),
        eq(skillDraftFiles.relativePath, relativePath),
      ),
    )
    .limit(1)

  if (!file) {
    throw new DomainError({
      code: "DRAFT_FILE_NOT_FOUND",
      message: "The requested file does not exist in the working copy.",
      kind: "not_found",
      details: { path: relativePath },
    })
  }

  return { storageKind: "draft", draftId: draft.id, file }
}

interface CommitDraftMutationInput {
  readonly workspaceId: string
  readonly draftId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly requestHash: string
  readonly nextFiles: readonly SnapshotManifestFile[]
  readonly upserts: readonly SnapshotManifestFile[]
  readonly deletedPaths: readonly string[]
  readonly ignoreRules: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
  readonly sourceType?: SkillSourceType
  readonly sourceName?: string
}

export async function commitDraftMutation(
  database: Database,
  input: CommitDraftMutationInput,
): Promise<{ readonly replayed: boolean }> {
  return database.transaction(async (transaction) => {
    const [existingMutation] = await transaction
      .select()
      .from(skillDraftMutations)
      .where(
        and(
          eq(skillDraftMutations.draftId, input.draftId),
          eq(skillDraftMutations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1)

    if (existingMutation) {
      if (existingMutation.requestHash !== input.requestHash) {
        throw new DomainError({
          code: "DRAFT_IDEMPOTENCY_KEY_REUSED",
          message:
            "The idempotency key has already been used for another working-copy change.",
          kind: "conflict",
        })
      }
      return { replayed: true }
    }

    const now = new Date()
    const totalBytes = input.nextFiles.reduce(
      (total, file) => total + file.byteSize,
      0,
    )
    const [updatedDraft] = await transaction
      .update(skillDrafts)
      .set({
        contentRevision: input.expectedRevision + 1,
        fileCount: input.nextFiles.length,
        totalBytes,
        ignoreRules: [...input.ignoreRules],
        currentIgnoredPaths: [...input.ignoredPaths],
        ...(input.sourceType ? { sourceType: input.sourceType } : {}),
        ...(input.sourceName ? { sourceName: input.sourceName } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(skillDrafts.id, input.draftId),
          eq(skillDrafts.workspaceId, input.workspaceId),
          eq(skillDrafts.status, "OPEN"),
          eq(skillDrafts.contentRevision, input.expectedRevision),
        ),
      )
      .returning({ id: skillDrafts.id })

    if (!updatedDraft) {
      throw new DomainError({
        code: "DRAFT_ETAG_STALE",
        message:
          "The working copy changed after this client loaded it. Local content was not overwritten.",
        kind: "precondition_failed",
      })
    }

    if (input.deletedPaths.length > 0) {
      await transaction
        .delete(skillDraftFiles)
        .where(
          and(
            eq(skillDraftFiles.draftId, input.draftId),
            inArray(skillDraftFiles.relativePath, [...input.deletedPaths]),
          ),
        )
    }

    for (let index = 0; index < input.upserts.length; index += 1_000) {
      const batch = input.upserts.slice(index, index + 1_000)
      if (batch.length === 0) continue
      await transaction
        .insert(skillDraftFiles)
        .values(
          batch.map((file) => ({
            draftId: input.draftId,
            relativePath: file.relativePath,
            sha256: file.sha256,
            byteSize: file.byteSize,
            mediaTypeHint: file.mediaTypeHint,
            contentKind: file.contentKind,
          })),
        )
        .onConflictDoUpdate({
          target: [
            skillDraftFiles.draftId,
            skillDraftFiles.relativePath,
          ],
          set: {
            sha256: sql`excluded.sha256`,
            byteSize: sql`excluded.byte_size`,
            mediaTypeHint: sql`excluded.media_type_hint`,
            contentKind: sql`excluded.content_kind`,
          },
        })
    }

    await transaction.insert(skillDraftMutations).values({
      draftId: input.draftId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      baseContentRevision: input.expectedRevision,
      resultContentRevision: input.expectedRevision + 1,
      resultSnapshotId: null,
      createdAt: now,
    })

    return { replayed: false }
  })
}

export async function getDraftMutationReplay(
  database: Database,
  input: {
    readonly workspaceId: string
    readonly draftId: string
    readonly idempotencyKey: string
    readonly requestHash: string
  },
): Promise<SkillDraftBrowser | null> {
  const [mutation] = await database
    .select()
    .from(skillDraftMutations)
    .where(
      and(
        eq(skillDraftMutations.draftId, input.draftId),
        eq(skillDraftMutations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1)

  if (!mutation) return null
  if (mutation.requestHash !== input.requestHash) {
    throw new DomainError({
      code: "DRAFT_IDEMPOTENCY_KEY_REUSED",
      message:
        "The idempotency key has already been used for another working-copy change.",
      kind: "conflict",
    })
  }
  return getActiveSkillDraft(database, input.workspaceId)
}

export async function createDraftFromCurrentVersion(
  database: Database,
  input: {
    readonly workspaceId: string
    readonly draftId: string
    readonly improvementCycleId: string
  },
): Promise<SkillDraftBrowser> {
  try {
    await database.transaction(async (transaction) => {
      const [workspaceVersion] = await transaction
        .select({
          versionId: skillVersions.id,
          snapshotId: skillVersions.snapshotId,
          sourceType: skillVersions.sourceType,
          sourceName: skillVersions.sourceName,
          fileCount: skillSnapshots.fileCount,
          totalBytes: skillSnapshots.totalBytes,
        })
        .from(skillWorkspaces)
        .innerJoin(
          skillVersions,
          eq(skillVersions.id, skillWorkspaces.currentOnlineVersionId),
        )
        .innerJoin(
          skillSnapshots,
          eq(skillSnapshots.id, skillVersions.snapshotId),
        )
        .where(eq(skillWorkspaces.id, input.workspaceId))
        .limit(1)

      if (!workspaceVersion) {
        throw new DomainError({
          code: "DRAFT_BASE_VERSION_REQUIRED",
          message:
            "A working copy can only be recreated after an online version exists.",
          kind: "conflict",
        })
      }

      const now = new Date()
      await transaction.insert(skillDrafts).values({
        id: input.draftId,
        workspaceId: input.workspaceId,
        baseVersionId: workspaceVersion.versionId,
        baseSnapshotId: workspaceVersion.snapshotId,
        currentSnapshotId: workspaceVersion.snapshotId,
        workingStorageLocator: `drafts/${input.draftId}`,
        fileCount: workspaceVersion.fileCount,
        totalBytes: workspaceVersion.totalBytes,
        status: "OPEN",
        contentRevision: 1,
        sourceType: workspaceVersion.sourceType,
        sourceName: workspaceVersion.sourceName,
        ignoreRules: [],
        currentIgnoredPaths: [],
        createdAt: now,
        updatedAt: now,
      })

      const seedFiles = await transaction
        .select()
        .from(skillSnapshotFiles)
        .where(eq(skillSnapshotFiles.snapshotId, workspaceVersion.snapshotId))
      for (let index = 0; index < seedFiles.length; index += 1_000) {
        await transaction.insert(skillDraftFiles).values(
          seedFiles.slice(index, index + 1_000).map((file) => ({
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
        baseVersionId: workspaceVersion.versionId,
        draftId: input.draftId,
        status: "DRAFTING",
        createdAt: now,
        updatedAt: now,
      })
    })
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw new DomainError({
      code: "DRAFT_CREATE_FAILED",
      message: "The working copy could not be created.",
      kind: "internal",
      cause: error,
    })
  }

  return getActiveSkillDraft(database, input.workspaceId)
}
