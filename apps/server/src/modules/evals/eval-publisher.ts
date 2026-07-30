import { createHash, randomUUID } from "node:crypto"
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import { and, desc, eq } from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  evalGenerationDrafts,
  evalGenerationTasks,
  evalRevisionCases,
  evalRevisionFiles,
  evalRevisions,
  evalSuites,
  type Database,
  type EvalRevisionRow,
} from "../../infrastructure/database/index.js"
import type {
  EvalRevisionView,
  PublishEvalRevisionResult,
} from "./eval-generation.domain.js"
import {
  assertEvalRelativePath,
  EvalStorage,
} from "./eval-storage.js"

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

function mapRevision(row: EvalRevisionRow): EvalRevisionView {
  return {
    id: row.id,
    suiteId: row.suiteId,
    sequenceNumber: row.sequenceNumber,
    skillName: row.skillName,
    sourceGenerationTaskId: row.sourceGenerationTaskId,
    sourceSnapshotId: row.sourceSnapshotId,
    manifestHash: row.manifestHash,
    rawEvalsSha256: row.rawEvalsSha256,
    evalCount: row.evalCount,
    fileCount: row.fileCount,
    totalBytes: row.totalBytes,
    createdAt: row.createdAt.toISOString(),
  }
}

export class EvalPublisher {
  constructor(
    private readonly database: Database,
    private readonly storage: EvalStorage,
  ) {}

  async publish(taskId: string): Promise<PublishEvalRevisionResult> {
    const existing = await this.findExisting(taskId)
    if (existing) {
      return { replayed: true, revision: mapRevision(existing) }
    }

    const revisionId = randomUUID()
    let promoted = false
    let finalRoot: string | null = null
    let temporaryRoot: string | null = null
    try {
      return await this.database.transaction(async (transaction) => {
        const [record] = await transaction
          .select({
            task: evalGenerationTasks,
            draft: evalGenerationDrafts,
          })
          .from(evalGenerationTasks)
          .innerJoin(
            evalGenerationDrafts,
            eq(evalGenerationDrafts.taskId, evalGenerationTasks.id),
          )
          .where(eq(evalGenerationTasks.id, taskId))
          .for("update")
          .limit(1)
        if (!record) {
          throw new DomainError({
            code: "EVAL_GENERATION_DRAFT_NOT_FOUND",
            message: "The generation task has no publishable Evals draft.",
            kind: "not_found",
          })
        }

        const [alreadyPublished] = await transaction
          .select()
          .from(evalRevisions)
          .where(eq(evalRevisions.sourceGenerationTaskId, taskId))
          .limit(1)
        if (alreadyPublished) {
          return {
            replayed: true,
            revision: mapRevision(alreadyPublished),
          }
        }
        if (
          record.task.status !== "SUCCEEDED" ||
          record.draft.status !== "READY"
        ) {
          throw new DomainError({
            code: "EVAL_DRAFT_NOT_PUBLISHABLE",
            message: "The Evals draft is not ready to publish.",
            kind: "conflict",
          })
        }

        const [suite] = await transaction
          .select({ id: evalSuites.id })
          .from(evalSuites)
          .where(eq(evalSuites.id, record.task.suiteId))
          .for("update")
          .limit(1)
        if (!suite) {
          throw new Error("The Evals suite no longer exists.")
        }
        const [latest] = await transaction
          .select({ sequenceNumber: evalRevisions.sequenceNumber })
          .from(evalRevisions)
          .where(eq(evalRevisions.suiteId, suite.id))
          .orderBy(desc(evalRevisions.sequenceNumber))
          .limit(1)
        const sequenceNumber = (latest?.sequenceNumber ?? 0) + 1

        const sourceRoot = this.storage.getGenerationOutputPath(
          record.task.id,
        )
        temporaryRoot = this.storage.getRevisionTemporaryRoot(
          suite.id,
          revisionId,
        )
        finalRoot = this.storage.getRevisionRoot(suite.id, revisionId)
        await rm(temporaryRoot, { recursive: true, force: true })
        await mkdir(path.join(temporaryRoot, "files"), {
          recursive: true,
        })

        const rawEvals = await readFile(path.join(sourceRoot, "evals.json"))
        if (sha256(rawEvals) !== record.draft.rawEvalsSha256) {
          throw new DomainError({
            code: "EVAL_DRAFT_CONTENT_CHANGED",
            message:
              "The generated Evals draft changed after validation and cannot be published.",
            kind: "conflict",
          })
        }
        await writeFile(path.join(temporaryRoot, "evals.json"), rawEvals, {
          flag: "wx",
        })
        for (const file of record.draft.files) {
          try {
            assertEvalRelativePath(file.relativePath)
          } catch {
            throw new DomainError({
              code: "EVAL_DRAFT_CONTENT_CHANGED",
              message:
                "The generated Evals draft contains an invalid stored file path.",
              kind: "conflict",
            })
          }
          if (!file.relativePath.startsWith("files/")) {
            throw new DomainError({
              code: "EVAL_DRAFT_CONTENT_CHANGED",
              message:
                "The generated Evals draft contains an invalid stored file path.",
              kind: "conflict",
            })
          }
          const source = this.storage.getGenerationFilePath(
            record.task.id,
            file.relativePath,
          )
          const content = await readFile(
            source,
          )
          if (
            content.byteLength !== file.byteSize ||
            sha256(content) !== file.sha256
          ) {
            throw new DomainError({
              code: "EVAL_DRAFT_CONTENT_CHANGED",
              message:
                "A generated Evals input changed after validation and cannot be published.",
              kind: "conflict",
              details: { path: file.relativePath },
            })
          }
          const destination = path.join(
            temporaryRoot,
            ...file.relativePath.split("/"),
          )
          await mkdir(path.dirname(destination), { recursive: true })
          await copyFile(
            source,
            destination,
          )
        }

        const manifestContent = {
          schemaVersion: 1,
          revisionId,
          sequenceNumber,
          sourceGenerationTaskId: taskId,
          sourceSnapshotId: record.task.targetSnapshotId,
          sourceKind: record.task.targetSourceKind,
          sourceVersionId: record.task.targetVersionId,
          sourceDraftRevisionId: record.task.targetDraftRevisionId,
          skillName: record.task.skillName,
          promptContractVersion: record.task.promptContractVersion,
          skillCreatorCommit: record.task.skillCreatorCommit,
          skillCreatorTreeHash: record.task.skillCreatorTreeHash,
          configurationFingerprint:
            record.task.configurationFingerprint,
          rawEvalsSha256: record.draft.rawEvalsSha256,
          generationManifestHash: record.draft.manifestHash,
          cases: record.draft.cases,
          files: record.draft.files,
        }
        const manifestHash = sha256(JSON.stringify(manifestContent))
        await writeFile(
          path.join(temporaryRoot, "manifest.json"),
          `${JSON.stringify({ ...manifestContent, manifestHash }, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        )
        await rename(temporaryRoot, finalRoot)
        promoted = true

        const now = new Date()
        const [revision] = await transaction
          .insert(evalRevisions)
          .values({
            id: revisionId,
            suiteId: suite.id,
            sourceGenerationTaskId: taskId,
            sourceSnapshotId: record.task.targetSnapshotId,
            sourceKind: record.task.targetSourceKind,
            sourceVersionId: record.task.targetVersionId,
            sourceDraftRevisionId: record.task.targetDraftRevisionId,
            sequenceNumber,
            skillName: record.task.skillName,
            storageLocator: this.storage.getRevisionLocator(
              suite.id,
              revisionId,
            ),
            manifestHash,
            rawEvalsSha256: record.draft.rawEvalsSha256,
            evalCount: record.draft.evalCount,
            fileCount: record.draft.fileCount,
            totalBytes: record.draft.totalBytes,
            promptContractVersion: record.task.promptContractVersion,
            skillCreatorCommit: record.task.skillCreatorCommit,
            skillCreatorTreeHash: record.task.skillCreatorTreeHash,
            configurationFingerprint:
              record.task.configurationFingerprint,
            createdAt: now,
          })
          .returning()
        if (!revision) {
          throw new Error("Evals revision creation returned no database row.")
        }
        if (record.draft.cases.length > 0) {
          await transaction.insert(evalRevisionCases).values(
            record.draft.cases.map((evalCase) => ({
              id: randomUUID(),
              revisionId,
              externalId: evalCase.externalId,
              name: evalCase.name,
              prompt: evalCase.prompt,
              expectedOutput: evalCase.expectedOutput,
              assertions: evalCase.assertions,
              files: evalCase.files,
            })),
          )
        }
        if (record.draft.files.length > 0) {
          await transaction.insert(evalRevisionFiles).values(
            record.draft.files.map((file) => ({
              id: randomUUID(),
              revisionId,
              relativePath: file.relativePath,
              sha256: file.sha256,
              byteSize: file.byteSize,
              mediaTypeHint: file.mediaTypeHint,
              contentKind: file.contentKind,
            })),
          )
        }
        await transaction
          .update(evalGenerationDrafts)
          .set({ status: "PUBLISHED", updatedAt: now })
          .where(
            and(
              eq(evalGenerationDrafts.id, record.draft.id),
              eq(evalGenerationDrafts.status, "READY"),
            ),
          )
        return { replayed: false, revision: mapRevision(revision) }
      })
    } catch (error) {
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true }).catch(
          () => undefined,
        )
      }
      if (promoted && finalRoot) {
        await rm(finalRoot, { recursive: true, force: true }).catch(
          () => undefined,
        )
      }
      throw error
    }
  }

  async list(workspaceId: string): Promise<readonly EvalRevisionView[]> {
    const revisions = await this.database
      .select({ revision: evalRevisions })
      .from(evalRevisions)
      .innerJoin(evalSuites, eq(evalSuites.id, evalRevisions.suiteId))
      .where(eq(evalSuites.workspaceId, workspaceId))
      .orderBy(desc(evalRevisions.createdAt))
    return revisions.map((record) => mapRevision(record.revision))
  }

  private async findExisting(
    taskId: string,
  ): Promise<EvalRevisionRow | null> {
    const [revision] = await this.database
      .select()
      .from(evalRevisions)
      .where(eq(evalRevisions.sourceGenerationTaskId, taskId))
      .limit(1)
    return revision ?? null
  }
}
