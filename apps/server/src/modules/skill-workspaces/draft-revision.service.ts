import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDraftRevisions,
  skillDrafts,
  skillSnapshotFiles,
  skillSnapshots,
  type Database,
  type SkillSnapshotRow,
} from "../../infrastructure/database/index.js"
import { getActiveDraftContext } from "./draft.repository.js"
import {
  asSnapshotManifestFiles,
  snapshotManifestMatchesFiles,
} from "./eval-target.domain.js"
import { buildSnapshotManifest } from "./snapshot-manifest.js"
import { createSnapshotFileInsertBatches } from "./snapshot-file-insert-batches.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import { readSkillName } from "./skill-metadata.js"

export type DraftRevisionReason =
  | "TRIAL"
  | "PRE_REGRESSION"
  | "RELEASE_GATE"
  | "FINALIZE"
  | "EVAL_GENERATION"

export interface DraftRevisionTarget {
  readonly draftId: string
  readonly contentRevision: number
}

export interface FrozenDraftRevision {
  readonly draftId: string
  readonly contentRevision: number
  readonly draftRevisionId: string
  readonly snapshotId: string
  readonly skillName: string
  readonly manifestHash: string
  readonly fileCount: number
  readonly totalBytes: number
}

interface FrozenDraftRevisionRecord {
  readonly draftRevisionId: string
  readonly sourceContentRevision: number
  readonly snapshot: SkillSnapshotRow
}

export class DraftRevisionService {
  constructor(
    private readonly database: Database,
    private readonly storage: LocalSnapshotStorage,
    private readonly limits: UploadLimits,
  ) {}

  async freeze(
    workspaceId: string,
    target: DraftRevisionTarget,
    reason: DraftRevisionReason,
  ): Promise<FrozenDraftRevision> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    if (
      draft.id !== target.draftId ||
      draft.contentRevision !== target.contentRevision ||
      draft.status !== "OPEN"
    ) {
      throw this.draftChangedError(target)
    }

    const existing = await this.findFrozenDraftRevision(
      draft.id,
      draft.contentRevision,
      reason,
    )
    if (existing) return this.mapDraftRevision(draft.id, existing)

    await this.storage.ensureDraftWorkspace(
      draft.id,
      draft.seedSnapshotId,
      draft.currentFiles.map((file) => file.relativePath),
    )
    const [lockedDraft] = await this.database
      .update(skillDrafts)
      .set({ status: "FINALIZING", updatedAt: new Date() })
      .where(
        and(
          eq(skillDrafts.id, draft.id),
          eq(skillDrafts.workspaceId, workspaceId),
          eq(skillDrafts.status, "OPEN"),
          eq(skillDrafts.contentRevision, target.contentRevision),
        ),
      )
      .returning({ id: skillDrafts.id })
    if (!lockedDraft) throw this.draftChangedError(target)

    const operationId = randomUUID()
    const snapshotId = randomUUID()
    const draftRevisionId = randomUUID()
    let promoted = false
    try {
      await this.storage.resetOperation(operationId)
      const expectedFiles = asSnapshotManifestFiles(draft.currentFiles)
      const paths = expectedFiles.map((file) => file.relativePath)
      await this.storage.cloneDraftFiles(operationId, draft.id, paths)
      const manifest = await buildSnapshotManifest(
        paths.map((relativePath) => ({
          incomingPath: this.storage.getOperationContentFilePath(
            operationId,
            relativePath,
          ),
          relativePath,
        })),
        this.limits,
      )
      if (!snapshotManifestMatchesFiles(manifest, expectedFiles)) {
        throw this.draftChangedError(target)
      }
      const skillName = await readSkillName(
        this.storage.getOperationContentFilePath(operationId, "SKILL.md"),
      )
      const storageLocator = await this.storage.promoteSnapshot(
        operationId,
        snapshotId,
        manifest,
      )
      promoted = true
      await this.database.transaction(async (transaction) => {
        const now = new Date()
        await transaction.insert(skillSnapshots).values({
          id: snapshotId,
          workspaceId,
          kind: "DRAFT_FROZEN",
          state: "READY",
          manifestHash: manifest.manifestHash,
          storageLocator,
          fileCount: manifest.fileCount,
          totalBytes: manifest.totalBytes,
          createdAt: now,
        })
        for (const batch of createSnapshotFileInsertBatches(
          snapshotId,
          manifest.files,
        )) {
          await transaction.insert(skillSnapshotFiles).values(batch)
        }
        await transaction.insert(skillDraftRevisions).values({
          id: draftRevisionId,
          draftId: draft.id,
          snapshotId,
          sourceContentRevision: draft.contentRevision,
          reason,
          createdAt: now,
        })
        const [reopened] = await transaction
          .update(skillDrafts)
          .set({ status: "OPEN", updatedAt: now })
          .where(
            and(
              eq(skillDrafts.id, draft.id),
              eq(skillDrafts.status, "FINALIZING"),
              eq(skillDrafts.contentRevision, draft.contentRevision),
            ),
          )
          .returning({ id: skillDrafts.id })
        if (!reopened) throw this.draftChangedError(target)
      })
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      return {
        draftId: draft.id,
        contentRevision: draft.contentRevision,
        draftRevisionId,
        snapshotId,
        skillName,
        manifestHash: manifest.manifestHash,
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
      }
    } catch (error) {
      if (promoted) {
        await this.storage.removeSnapshot(snapshotId).catch(() => undefined)
      }
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      await this.database
        .update(skillDrafts)
        .set({ status: "OPEN", updatedAt: new Date() })
        .where(
          and(
            eq(skillDrafts.id, draft.id),
            eq(skillDrafts.status, "FINALIZING"),
            eq(skillDrafts.contentRevision, draft.contentRevision),
          ),
        )
        .catch(() => undefined)
      throw error
    }
  }

  private async findFrozenDraftRevision(
    draftId: string,
    contentRevision: number,
    reason: DraftRevisionReason,
  ): Promise<FrozenDraftRevisionRecord | null> {
    const [record] = await this.database
      .select({
        draftRevisionId: skillDraftRevisions.id,
        sourceContentRevision: skillDraftRevisions.sourceContentRevision,
        snapshot: skillSnapshots,
      })
      .from(skillDraftRevisions)
      .innerJoin(
        skillSnapshots,
        eq(skillSnapshots.id, skillDraftRevisions.snapshotId),
      )
      .where(
        and(
          eq(skillDraftRevisions.draftId, draftId),
          eq(skillDraftRevisions.sourceContentRevision, contentRevision),
          eq(skillDraftRevisions.reason, reason),
        ),
      )
      .limit(1)
    return record ?? null
  }

  private async mapDraftRevision(
    draftId: string,
    record: FrozenDraftRevisionRecord,
  ): Promise<FrozenDraftRevision> {
    if (record.snapshot.state !== "READY") {
      throw new DomainError({
        code: "SKILL_DRAFT_SNAPSHOT_UNAVAILABLE",
        message: "The frozen Skill working-copy Snapshot is not ready.",
        kind: "conflict",
      })
    }
    const skillName = await readSkillName(
      this.storage.getSnapshotFilePath(record.snapshot.id, "SKILL.md"),
    )
    return {
      draftId,
      contentRevision: record.sourceContentRevision,
      draftRevisionId: record.draftRevisionId,
      snapshotId: record.snapshot.id,
      skillName,
      manifestHash: record.snapshot.manifestHash,
      fileCount: record.snapshot.fileCount,
      totalBytes: record.snapshot.totalBytes,
    }
  }

  private draftChangedError(target: DraftRevisionTarget): DomainError {
    return new DomainError({
      code: "SKILL_DRAFT_CHANGED",
      message:
        "The Skill working copy changed before it could be frozen. Refresh and try again.",
      kind: "conflict",
      details: {
        draftId: target.draftId,
        contentRevision: target.contentRevision,
      },
    })
  }
}
