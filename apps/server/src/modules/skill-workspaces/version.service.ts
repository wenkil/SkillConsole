import { randomUUID } from "node:crypto"

import { and, eq, max } from "drizzle-orm"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillSnapshotFiles,
  skillSnapshots,
  skillDrafts,
  skillVersions,
  skillWorkspaces,
  type Database,
} from "../../infrastructure/database/index.js"
import { getActiveDraftContext } from "./draft.repository.js"
import {
  buildSnapshotManifest,
  type SnapshotManifestFile,
} from "./snapshot-manifest.js"
import { createSnapshotFileInsertBatches } from "./snapshot-file-insert-batches.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import type {
  CreateSkillVersion,
  SkillVersionBrowser,
  UpdateSkillVersionMetadata,
  VersionComparison,
} from "./version-browser.contract.js"
import {
  getSkillVersion,
  listVersionFileRows,
} from "./version-browser.repository.js"
import { classifySnapshotFile } from "./version-browser.service.js"

function normalizeVersionName(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 120) {
    throw new DomainError({
      code: "VERSION_NAME_INVALID",
      message: "The version name must contain 1 to 120 characters.",
      kind: "validation",
    })
  }
  return normalized
}

function normalizeDescription(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() || null
  if (normalized && normalized.length > 2_000) {
    throw new DomainError({
      code: "VERSION_DESCRIPTION_INVALID",
      message: "The version description is too long.",
      kind: "validation",
    })
  }
  return normalized
}

function normalizeLabels(values: readonly string[] | undefined): string[] {
  const normalized = [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ]
  if (
    normalized.length > 20 ||
    normalized.some((value) => value.length > 40)
  ) {
    throw new DomainError({
      code: "VERSION_LABELS_INVALID",
      message: "A version supports up to 20 labels of 40 characters each.",
      kind: "validation",
    })
  }
  return normalized
}

function findDatabaseCode(error: unknown): string | null {
  let candidate = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== "object") return null
    if ("code" in candidate && typeof candidate.code === "string") {
      return candidate.code
    }
    candidate = "cause" in candidate ? candidate.cause : null
  }
  return null
}

export class VersionService {
  constructor(
    readonly database: Database,
    readonly storage: LocalSnapshotStorage,
    readonly limits: UploadLimits,
  ) {}

  async create(
    workspaceId: string,
    input: CreateSkillVersion,
  ): Promise<SkillVersionBrowser> {
    const name = normalizeVersionName(input.name)
    const description = normalizeDescription(input.description)
    const labels = normalizeLabels(input.labels)
    const draft = await getActiveDraftContext(this.database, workspaceId)
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
          eq(skillDrafts.contentRevision, draft.contentRevision),
        ),
      )
      .returning({ id: skillDrafts.id })
    if (!lockedDraft) {
      throw new DomainError({
        code: "VERSION_WORKING_COPY_CHANGED",
        message:
          "The working copy changed before the version could be frozen. Try again.",
        kind: "conflict",
      })
    }

    const operationId = randomUUID()
    const snapshotId = randomUUID()
    const versionId = randomUUID()
    try {
      await this.storage.resetOperation(operationId)
      const paths = draft.currentFiles.map((file) => file.relativePath)
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
      const storageLocator = await this.storage.promoteSnapshot(
        operationId,
        snapshotId,
        manifest,
      )
      try {
        await this.database.transaction(async (transaction) => {
          const [latest] = await transaction
            .select({ value: max(skillVersions.sequenceNumber) })
            .from(skillVersions)
            .where(eq(skillVersions.workspaceId, workspaceId))
          const sequenceNumber = (latest?.value ?? 0) + 1
          const now = new Date()
          await transaction.insert(skillSnapshots).values({
            id: snapshotId,
            workspaceId,
            kind: "VERSION",
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
          await transaction.insert(skillVersions).values({
            id: versionId,
            workspaceId,
            snapshotId,
            sequenceNumber,
            name,
            description,
            labels,
            sourceType: draft.sourceType,
            sourceName: draft.sourceName,
            createdAt: now,
            frozenAt: now,
          })
          await transaction
            .update(skillWorkspaces)
            .set({
              ...(input.setOnline
                ? { currentOnlineVersionId: versionId }
                : {}),
              updatedAt: now,
            })
            .where(eq(skillWorkspaces.id, workspaceId))
          await transaction
            .update(skillDrafts)
            .set({ status: "OPEN", updatedAt: now })
            .where(eq(skillDrafts.id, draft.id))
        })
      } catch (error) {
        await this.storage.removeSnapshot(snapshotId).catch(() => undefined)
        if (findDatabaseCode(error) === "23505") {
          throw new DomainError({
            code: "VERSION_NAME_CONFLICT",
            message: "This workbench already contains a version with that name.",
            kind: "conflict",
            cause: error,
          })
        }
        throw error
      }
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      return getSkillVersion(this.database, workspaceId, versionId)
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      await this.database
        .update(skillDrafts)
        .set({ status: "OPEN", updatedAt: new Date() })
        .where(
          and(
            eq(skillDrafts.id, draft.id),
            eq(skillDrafts.status, "FINALIZING"),
          ),
        )
        .catch(() => undefined)
      throw error
    }
  }

  async updateMetadata(
    workspaceId: string,
    versionId: string,
    input: UpdateSkillVersionMetadata,
  ): Promise<SkillVersionBrowser> {
    await getSkillVersion(this.database, workspaceId, versionId)
    try {
      await this.database
        .update(skillVersions)
        .set({
          ...(input.name !== undefined
            ? { name: normalizeVersionName(input.name) }
            : {}),
          ...(input.description !== undefined
            ? { description: normalizeDescription(input.description) }
            : {}),
          ...(input.labels !== undefined
            ? { labels: normalizeLabels(input.labels) }
            : {}),
        })
        .where(
          and(
            eq(skillVersions.id, versionId),
            eq(skillVersions.workspaceId, workspaceId),
          ),
        )
    } catch (error) {
      if (findDatabaseCode(error) === "23505") {
        throw new DomainError({
          code: "VERSION_NAME_CONFLICT",
          message: "This workbench already contains a version with that name.",
          kind: "conflict",
          cause: error,
        })
      }
      throw error
    }
    return getSkillVersion(this.database, workspaceId, versionId)
  }

  async setOnline(
    workspaceId: string,
    versionId: string,
  ): Promise<SkillVersionBrowser> {
    await getSkillVersion(this.database, workspaceId, versionId)
    await this.database
      .update(skillWorkspaces)
      .set({ currentOnlineVersionId: versionId, updatedAt: new Date() })
      .where(eq(skillWorkspaces.id, workspaceId))
    return getSkillVersion(this.database, workspaceId, versionId)
  }

  async compare(
    workspaceId: string,
    leftVersionId: string,
    rightVersionId: string,
  ): Promise<VersionComparison> {
    if (leftVersionId === rightVersionId) {
      throw new DomainError({
        code: "VERSION_COMPARISON_IDENTICAL",
        message: "Select two different versions to compare.",
        kind: "validation",
      })
    }
    const [leftVersion, rightVersion, leftRows, rightRows] =
      await Promise.all([
        getSkillVersion(this.database, workspaceId, leftVersionId),
        getSkillVersion(this.database, workspaceId, rightVersionId),
        listVersionFileRows(this.database, workspaceId, leftVersionId),
        listVersionFileRows(this.database, workspaceId, rightVersionId),
      ])
    const leftByPath = new Map(
      leftRows.map((file) => [file.relativePath, file]),
    )
    const rightByPath = new Map(
      rightRows.map((file) => [file.relativePath, file]),
    )
    const paths = [...new Set([...leftByPath.keys(), ...rightByPath.keys()])]
      .sort((left, right) => left.localeCompare(right, "en"))
    const summary = { added: 0, modified: 0, deleted: 0, unchanged: 0 }
    const entries = paths.map((relativePath) => {
      const left = leftByPath.get(relativePath)
      const right = rightByPath.get(relativePath)
      const status: VersionComparison["entries"][number]["status"] =
        !left && right
          ? "ADDED"
          : left && !right
            ? "DELETED"
            : left!.sha256 === right!.sha256
              ? "UNCHANGED"
              : "MODIFIED"
      summary[status.toLowerCase() as keyof typeof summary] += 1
      const mapSide = (
        file: (typeof leftRows)[number] | undefined,
      ): SnapshotManifestFile & {
        previewKind: ReturnType<typeof classifySnapshotFile>["previewKind"]
        previewable: boolean
      } | null =>
        file
          ? {
              relativePath: file.relativePath,
              sha256: file.sha256,
              byteSize: file.byteSize,
              mediaTypeHint: file.mediaTypeHint,
              contentKind: file.contentKind as "text" | "binary",
              ...classifySnapshotFile(file),
            }
          : null
      return {
        relativePath,
        status,
        left: mapSide(left),
        right: mapSide(right),
      }
    })
    return { leftVersion, rightVersion, summary, entries }
  }
}
