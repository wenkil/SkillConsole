import { and, eq } from "drizzle-orm"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillSnapshots,
  skillVersions,
  type Database,
} from "../../infrastructure/database/index.js"
import { DraftRevisionService } from "./draft-revision.service.js"
import type {
  EvalTargetInput,
  FrozenEvalTarget,
} from "./eval-target.domain.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import { readSkillName } from "./skill-metadata.js"

export class EvalTargetService {
  private readonly draftRevisions: DraftRevisionService

  constructor(
    private readonly database: Database,
    private readonly storage: LocalSnapshotStorage,
    limits: UploadLimits,
  ) {
    this.draftRevisions = new DraftRevisionService(database, storage, limits)
  }

  async freeze(
    workspaceId: string,
    target: EvalTargetInput,
  ): Promise<FrozenEvalTarget> {
    if (target.kind === "version") {
      return this.resolveVersion(workspaceId, target.versionId)
    }
    let frozen
    try {
      frozen = await this.draftRevisions.freeze(
        workspaceId,
        target,
        "EVAL_GENERATION",
      )
    } catch (error) {
      if (error instanceof DomainError && error.code === "SKILL_DRAFT_CHANGED") {
        throw new DomainError({
          code: "EVAL_TARGET_DRAFT_CHANGED",
          message:
            "The working copy changed before its Evals target could be frozen. Reload and try again.",
          kind: "conflict",
          ...(error.details ? { details: error.details } : {}),
          cause: error,
        })
      }
      if (
        error instanceof DomainError &&
        error.code === "SKILL_DRAFT_SNAPSHOT_UNAVAILABLE"
      ) {
        throw new DomainError({
          code: "EVAL_TARGET_SNAPSHOT_UNAVAILABLE",
          message: "The frozen working-copy Snapshot is not ready.",
          kind: "conflict",
          ...(error.details ? { details: error.details } : {}),
          cause: error,
        })
      }
      throw error
    }
    return {
      sourceKind: "DRAFT_REVISION",
      versionId: null,
      draftRevisionId: frozen.draftRevisionId,
      snapshotId: frozen.snapshotId,
      skillName: frozen.skillName,
      manifestHash: frozen.manifestHash,
      fileCount: frozen.fileCount,
      totalBytes: frozen.totalBytes,
    }
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
}
