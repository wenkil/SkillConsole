import { and, asc, eq, inArray } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDraftMutations,
  skillDrafts,
  skillImprovementCycles,
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  skillWorkspaces,
  type Database,
  type SkillDraftRow,
  type SkillSnapshotFileRow,
  type SkillSnapshotRow,
  type SkillSourceType,
} from "../../infrastructure/database/index.js"

import type { DraftIgnoredPath } from "./draft-ignore.js"
import type { SnapshotManifest } from "./snapshot-manifest.js"
import {
  getActiveSkillDraft,
  type SnapshotFileRecord,
} from "./version-browser.repository.js"
import type { SkillDraftBrowser } from "./version-browser.contract.js"

export interface ActiveDraftContext {
  readonly id: string
  readonly workspaceId: string
  readonly baseVersionId: string | null
  readonly baseSnapshotId: string
  readonly currentSnapshotId: string
  readonly contentRevision: number
  readonly status: SkillDraftRow["status"]
  readonly sourceType: SkillSourceType
  readonly sourceName: string
  readonly ignoreRules: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
  readonly currentSnapshot: SkillSnapshotRow
  readonly currentFiles: readonly SkillSnapshotFileRow[]
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
      message: "The requested active Skill draft was not found.",
      kind: "not_found",
    })
  }

  const [snapshot, currentFiles] = await Promise.all([
    database.query.skillSnapshots.findFirst({
      where: eq(skillSnapshots.id, draft.currentSnapshotId),
    }),
    database
      .select()
      .from(skillSnapshotFiles)
      .where(eq(skillSnapshotFiles.snapshotId, draft.currentSnapshotId))
      .orderBy(asc(skillSnapshotFiles.relativePath)),
  ])

  if (!snapshot) {
    throw new DomainError({
      code: "SNAPSHOT_NOT_FOUND",
      message: "The active Draft Snapshot is missing.",
      kind: "internal",
    })
  }

  return {
    id: draft.id,
    workspaceId: draft.workspaceId,
    baseVersionId: draft.baseVersionId,
    baseSnapshotId: draft.baseSnapshotId,
    currentSnapshotId: draft.currentSnapshotId,
    contentRevision: draft.contentRevision,
    status: draft.status,
    sourceType: draft.sourceType,
    sourceName: draft.sourceName,
    ignoreRules: [...draft.ignoreRules],
    ignoredPaths: [...draft.currentIgnoredPaths],
    currentSnapshot: snapshot,
    currentFiles,
  }
}

export async function listSnapshotFileRows(
  database: Database,
  snapshotId: string,
): Promise<SkillSnapshotFileRow[]> {
  return database
    .select()
    .from(skillSnapshotFiles)
    .where(eq(skillSnapshotFiles.snapshotId, snapshotId))
    .orderBy(asc(skillSnapshotFiles.relativePath))
}

export async function getDraftBaseFileRecord(
  database: Database,
  workspaceId: string,
  relativePath: string,
): Promise<SnapshotFileRecord> {
  const draft = await getActiveDraftContext(database, workspaceId)
  const [file] = await database
    .select()
    .from(skillSnapshotFiles)
    .where(
      and(
        eq(skillSnapshotFiles.snapshotId, draft.baseSnapshotId),
        eq(skillSnapshotFiles.relativePath, relativePath),
      ),
    )
    .limit(1)

  if (!file) {
    throw new DomainError({
      code: "SNAPSHOT_FILE_NOT_FOUND",
      message: "The requested base file was not found.",
      kind: "not_found",
      details: { path: relativePath },
    })
  }

  const [snapshot] = await database
    .select({ state: skillSnapshots.state })
    .from(skillSnapshots)
    .where(eq(skillSnapshots.id, draft.baseSnapshotId))
    .limit(1)

  if (!snapshot) {
    throw new DomainError({
      code: "SNAPSHOT_NOT_FOUND",
      message: "The Draft comparison Snapshot is missing.",
      kind: "internal",
    })
  }

  return {
    snapshotId: draft.baseSnapshotId,
    snapshotState: snapshot.state,
    file,
  }
}

interface CommitDraftSnapshotInput {
  readonly workspaceId: string
  readonly draftId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly requestHash: string
  readonly snapshotId: string
  readonly storageLocator: string
  readonly manifest: SnapshotManifest
  readonly ignoreRules: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
  readonly sourceType?: SkillSourceType
  readonly sourceName?: string
}

export async function commitDraftSnapshot(
  database: Database,
  input: CommitDraftSnapshotInput,
): Promise<{
  readonly replayed: boolean
  readonly usedSnapshotId: string
}> {
  const transactionResult = await database.transaction(
    async (transaction) => {
      const [existingMutation] = await transaction
        .select()
        .from(skillDraftMutations)
        .where(
          and(
            eq(skillDraftMutations.draftId, input.draftId),
            eq(
              skillDraftMutations.idempotencyKey,
              input.idempotencyKey,
            ),
          ),
        )
        .limit(1)

      if (existingMutation) {
        if (existingMutation.requestHash !== input.requestHash) {
          throw new DomainError({
            code: "DRAFT_IDEMPOTENCY_KEY_REUSED",
            message:
              "The idempotency key has already been used for another Draft change.",
            kind: "conflict",
          })
        }

        return {
          replayed: true,
          usedSnapshotId: existingMutation.resultSnapshotId,
        }
      }

      const now = new Date()
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

      const [updatedDraft] = await transaction
        .update(skillDrafts)
        .set({
          currentSnapshotId: input.snapshotId,
          contentRevision: input.expectedRevision + 1,
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
            "The Draft changed after this client loaded it. Local content was not overwritten.",
          kind: "precondition_failed",
        })
      }

      await transaction.insert(skillDraftMutations).values({
        draftId: input.draftId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        baseContentRevision: input.expectedRevision,
        resultContentRevision: input.expectedRevision + 1,
        resultSnapshotId: input.snapshotId,
        createdAt: now,
      })

      return { replayed: false, usedSnapshotId: input.snapshotId }
    },
  )

  return transactionResult
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
        "The idempotency key has already been used for another Draft change.",
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
        })
        .from(skillWorkspaces)
        .innerJoin(
          skillVersions,
          eq(skillVersions.id, skillWorkspaces.currentVersionId),
        )
        .where(eq(skillWorkspaces.id, input.workspaceId))
        .limit(1)

      if (!workspaceVersion) {
        throw new DomainError({
          code: "DRAFT_BASE_VERSION_REQUIRED",
          message:
            "A new Draft can only be created after a formal version exists.",
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
        status: "OPEN",
        contentRevision: 1,
        sourceType: workspaceVersion.sourceType,
        sourceName: workspaceVersion.sourceName,
        ignoreRules: [],
        currentIgnoredPaths: [],
        createdAt: now,
        updatedAt: now,
      })
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
    let candidate: unknown = error
    for (let depth = 0; depth < 4; depth += 1) {
      if (
        candidate &&
        typeof candidate === "object" &&
        "code" in candidate &&
        candidate.code === "23505"
      ) {
        throw new DomainError({
          code: "ACTIVE_DRAFT_ALREADY_EXISTS",
          message: "This workbench already has an active Draft.",
          kind: "conflict",
          cause: error,
        })
      }
      candidate =
        candidate && typeof candidate === "object" && "cause" in candidate
          ? candidate.cause
          : undefined
    }
    throw new DomainError({
      code: "DRAFT_CREATE_FAILED",
      message: "The Draft could not be created.",
      kind: "internal",
      cause: error,
    })
  }

  return getActiveSkillDraft(database, input.workspaceId)
}

export async function abandonActiveDraft(
  database: Database,
  input: {
    readonly workspaceId: string
    readonly draftId: string
    readonly expectedRevision: number
  },
): Promise<void> {
  await database.transaction(async (transaction) => {
    const now = new Date()
    const [abandoned] = await transaction
      .update(skillDrafts)
      .set({ status: "ABANDONED", updatedAt: now })
      .where(
        and(
          eq(skillDrafts.id, input.draftId),
          eq(skillDrafts.workspaceId, input.workspaceId),
          eq(skillDrafts.status, "OPEN"),
          eq(skillDrafts.contentRevision, input.expectedRevision),
        ),
      )
      .returning({ id: skillDrafts.id })

    if (!abandoned) {
      throw new DomainError({
        code: "DRAFT_ETAG_STALE",
        message: "The Draft changed before it could be abandoned.",
        kind: "precondition_failed",
      })
    }

    await transaction
      .update(skillImprovementCycles)
      .set({ status: "ABANDONED", updatedAt: now })
      .where(eq(skillImprovementCycles.draftId, input.draftId))
  })
}
