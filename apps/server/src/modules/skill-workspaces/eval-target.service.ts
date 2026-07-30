import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillDraftRevisions,
  skillDrafts,
  skillSnapshotFiles,
  skillSnapshots,
  skillVersions,
  type Database,
  type SkillSnapshotRow,
} from "../../infrastructure/database/index.js"
import { getActiveDraftContext } from "./draft.repository.js"
import {
  asSnapshotManifestFiles,
  type EvalTargetInput,
  type FrozenEvalTarget,
  snapshotManifestMatchesFiles,
} from "./eval-target.domain.js"
import {
  buildSnapshotManifest,
} from "./snapshot-manifest.js"
import { createSnapshotFileInsertBatches } from "./snapshot-file-insert-batches.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import { readSkillName } from "./skill-metadata.js"

interface FrozenDraftRevisionRecord {
  readonly draftRevisionId: string
  readonly snapshot: SkillSnapshotRow
}

export class EvalTargetService {
  constructor(
    private readonly database: Database,
    private readonly storage: LocalSnapshotStorage,
    private readonly limits: UploadLimits,
  ) {}

  async freeze(
    workspaceId: string,
    target: EvalTargetInput,
  ): Promise<FrozenEvalTarget> {
    return target.kind === "version"
      ? this.resolveVersion(workspaceId, target.versionId)
      : this.freezeDraft(workspaceId, target)
  }

  private async resolveVersion(
    workspaceId: string,
    versionId: string,
  ): Promise<FrozenEvalTarget> {
    const [record] = await this.database
      .select({
        versionId: skillVersions.id,
        snapshotId: skillSnapshots.id,
        snapshotState: skillSnapshots.state,
        manifestHash: skillSnapshots.manifestHash,
        fileCount: skillSnapshots.fileCount,
        totalBytes: skillSnapshots.totalBytes,
      })
      .from(skillVersions)
      .innerJoin(
        skillSnapshots,
        eq(skillSnapshots.id, skillVersions.snapshotId),
      )
      .where(
        and(
          eq(skillVersions.id, versionId),
          eq(skillVersions.workspaceId, workspaceId),
        ),
      )
      .limit(1)
    if (!record) {
      throw new DomainError({
        code: "EVAL_TARGET_VERSION_NOT_FOUND",
        message: "The selected Skill version was not found.",
        kind: "not_found",
      })
    }
    if (record.snapshotState !== "READY") {
      throw new DomainError({
        code: "EVAL_TARGET_SNAPSHOT_UNAVAILABLE",
        message: "The selected Skill Snapshot is not ready.",
        kind: "conflict",
      })
    }

    const skillName = await readSkillName(
      this.storage.getSnapshotFilePath(record.snapshotId, "SKILL.md"),
    )
    return {
      sourceKind: "SKILL_VERSION",
      versionId: record.versionId,
      draftRevisionId: null,
      snapshotId: record.snapshotId,
      skillName,
      manifestHash: record.manifestHash,
      fileCount: record.fileCount,
      totalBytes: record.totalBytes,
    }
  }

  private async freezeDraft(
    workspaceId: string,
    target: Extract<EvalTargetInput, { readonly kind: "draft" }>,
  ): Promise<FrozenEvalTarget> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    if (
      draft.id !== target.draftId ||
      draft.contentRevision !== target.contentRevision ||
      draft.status !== "OPEN"
    ) {
      throw this.draftChangedError()
    }

    const existing = await this.findFrozenDraftRevision(
      draft.id,
      draft.contentRevision,
    )
    if (existing) {
      return this.mapDraftRevision(existing)
    }

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
    if (!lockedDraft) throw this.draftChangedError()

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
        throw this.draftChangedError()
      }
      const skillName = await readSkillName(
        this.storage.getOperationContentFilePath(
          operationId,
          "SKILL.md",
        ),
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
          reason: "EVAL_GENERATION",
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
        if (!reopened) throw this.draftChangedError()
      })
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      return {
        sourceKind: "DRAFT_REVISION",
        versionId: null,
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
  ): Promise<FrozenDraftRevisionRecord | null> {
    const [record] = await this.database
      .select({
        draftRevisionId: skillDraftRevisions.id,
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
          eq(
            skillDraftRevisions.sourceContentRevision,
            contentRevision,
          ),
          eq(skillDraftRevisions.reason, "EVAL_GENERATION"),
        ),
      )
      .limit(1)
    return record ?? null
  }

  private async mapDraftRevision(
    record: FrozenDraftRevisionRecord,
  ): Promise<FrozenEvalTarget> {
    if (record.snapshot.state !== "READY") {
      throw new DomainError({
        code: "EVAL_TARGET_SNAPSHOT_UNAVAILABLE",
        message: "The frozen working-copy Snapshot is not ready.",
        kind: "conflict",
      })
    }
    const skillName = await readSkillName(
      this.storage.getSnapshotFilePath(record.snapshot.id, "SKILL.md"),
    )
    return {
      sourceKind: "DRAFT_REVISION",
      versionId: null,
      draftRevisionId: record.draftRevisionId,
      snapshotId: record.snapshot.id,
      skillName,
      manifestHash: record.snapshot.manifestHash,
      fileCount: record.snapshot.fileCount,
      totalBytes: record.snapshot.totalBytes,
    }
  }

  private draftChangedError(): DomainError {
    return new DomainError({
      code: "EVAL_TARGET_DRAFT_CHANGED",
      message:
        "The working copy changed before its Evals target could be frozen. Reload and try again.",
      kind: "conflict",
    })
  }
}
