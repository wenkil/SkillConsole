import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import type { Multipart } from "@fastify/multipart"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import type { Database } from "../../infrastructure/database/index.js"
import type {
  DraftFolderMergePreview,
  DraftMutationResponse,
  DraftTextSave,
} from "./draft.contract.js"
import {
  buildDraftDiffEntries,
  buildFolderPreviewSummary,
} from "./draft-diff.js"
import {
  applyDraftFolderIgnoreRules,
  parseDraftIgnoreRules,
  type DraftIgnoredPath,
} from "./draft-ignore.js"
import {
  commitDraftMutation,
  createDraftEtag,
  createDraftFromCurrentVersion,
  getActiveDraftContext,
  getDraftMutationReplay,
  type ActiveDraftContext,
} from "./draft.repository.js"
import {
  buildSnapshotManifest,
  type SnapshotManifest,
  type SnapshotManifestFile,
} from "./snapshot-manifest.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import {
  normalizeRelativePath,
  prepareRelativePaths,
  uploadValidationError,
  validateOperationId,
} from "./upload-validation.js"
import type { UploadFolderIgnorePolicy } from "./upload-folder-ignore-policy.js"
import type { SkillDraftBrowser } from "./version-browser.contract.js"
import { getActiveSkillDraft } from "./version-browser.repository.js"

interface FolderMergeOperationMetadata {
  readonly schemaVersion: 2
  readonly kind: "DRAFT_FOLDER_MERGE"
  readonly workspaceId: string
  readonly draftId: string
  readonly baseContentRevision: number
  readonly sourceName: string
  readonly ignoreRules: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
  readonly uploadedManifest: SnapshotManifest
  readonly files: readonly {
    readonly incomingIndex: number
    readonly relativePath: string
  }[]
  readonly summary: DraftFolderMergePreview["summary"]
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function assertNoFileDirectoryConflicts(
  relativePaths: readonly string[],
): void {
  const paths = new Set(relativePaths.map((path) => path.toLowerCase()))
  for (const relativePath of relativePaths) {
    const segments = relativePath.toLowerCase().split("/")
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/")
      if (paths.has(ancestor)) {
        throw new DomainError({
          code: "DRAFT_PATH_TYPE_CONFLICT",
          message:
            "A working-copy path cannot be both a file and a parent directory.",
          kind: "conflict",
          details: { firstPath: ancestor, secondPath: relativePath },
        })
      }
    }
  }
}

function validateDraftSourceName(value: string | undefined): string {
  const normalized = value?.trim() || "Skill folder"
  if (normalized.length > 255) {
    throw uploadValidationError(
      "DRAFT_SOURCE_NAME_INVALID",
      "The working-copy source name is too long.",
    )
  }
  return normalized
}

function requireHeader(
  value: string | string[] | undefined,
  headerName: "If-Match" | "Idempotency-Key",
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError({
      code:
        headerName === "If-Match"
          ? "DRAFT_IF_MATCH_REQUIRED"
          : "DRAFT_IDEMPOTENCY_KEY_REQUIRED",
      message: `${headerName} is required for this working-copy change.`,
      kind: "precondition_required",
    })
  }
  return value.trim()
}

function assertMatchingEtag(
  ifMatch: string | string[] | undefined,
  draftId: string,
  contentRevision: number,
): void {
  const value = requireHeader(ifMatch, "If-Match")
  const currentEtag = createDraftEtag(draftId, contentRevision)
  if (value !== currentEtag) {
    throw new DomainError({
      code: "DRAFT_ETAG_STALE",
      message:
        "The working copy changed after this client loaded it. Local content was not overwritten.",
      kind: "precondition_failed",
      details: { currentEtag, contentRevision },
    })
  }
}

function requireIdempotencyKey(
  value: string | string[] | undefined,
): string {
  return requireHeader(value, "Idempotency-Key")
}

function assertDraftOpen(status: string): void {
  if (status !== "OPEN") {
    throw new DomainError({
      code: "DRAFT_NOT_EDITABLE",
      message: "The Skill working copy is not open for editing.",
      kind: "conflict",
      details: { status },
    })
  }
}

function mapMultipartField(part: Extract<Multipart, { type: "field" }>) {
  if (part.valueTruncated || typeof part.value !== "string") {
    throw uploadValidationError(
      "DRAFT_UPLOAD_FIELD_INVALID",
      "A working-copy upload field is invalid or too long.",
      { field: part.fieldname },
    )
  }
  return part.value
}

function isFolderMergeOperationMetadata(
  value: unknown,
): value is FolderMergeOperationMetadata {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 2 &&
    record.kind === "DRAFT_FOLDER_MERGE" &&
    typeof record.workspaceId === "string" &&
    typeof record.draftId === "string" &&
    Number.isInteger(record.baseContentRevision) &&
    typeof record.sourceName === "string" &&
    Array.isArray(record.ignoreRules) &&
    Array.isArray(record.ignoredPaths) &&
    Array.isArray(record.files) &&
    Boolean(record.uploadedManifest)
  )
}

function asManifestFile(file: {
  readonly relativePath: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: string
}): SnapshotManifestFile {
  return {
    relativePath: file.relativePath,
    sha256: file.sha256,
    byteSize: file.byteSize,
    mediaTypeHint: file.mediaTypeHint,
    contentKind: file.contentKind as "text" | "binary",
  }
}

function mergeFiles(
  currentFiles: readonly SnapshotManifestFile[],
  uploadedFiles: readonly SnapshotManifestFile[],
): SnapshotManifestFile[] {
  const uploaded = new Map(
    uploadedFiles.map((file) => [file.relativePath, file]),
  )
  return [
    ...currentFiles.filter((file) => !uploaded.has(file.relativePath)),
    ...uploadedFiles,
  ].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"),
  )
}

export interface DraftServiceOptions {
  readonly database: Database
  readonly storage: LocalSnapshotStorage
  readonly limits: UploadLimits
  readonly folderIgnorePolicy: UploadFolderIgnorePolicy
}

export class DraftService {
  readonly database: Database
  readonly storage: LocalSnapshotStorage
  readonly limits: UploadLimits
  readonly folderIgnorePolicy: UploadFolderIgnorePolicy
  private readonly mutationQueues = new Map<string, Promise<void>>()

  constructor({
    database,
    storage,
    limits,
    folderIgnorePolicy,
  }: DraftServiceOptions) {
    this.database = database
    this.storage = storage
    this.limits = limits
    this.folderIgnorePolicy = folderIgnorePolicy
  }

  getEtag(draft: Pick<SkillDraftBrowser, "id" | "contentRevision">): string {
    return createDraftEtag(draft.id, draft.contentRevision)
  }

  async ensureWorkingCopy(workspaceId: string): Promise<ActiveDraftContext> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    await this.storage.ensureDraftWorkspace(
      draft.id,
      draft.seedSnapshotId,
      draft.currentFiles.map((file) => file.relativePath),
    )
    return draft
  }

  async getDraft(workspaceId: string): Promise<SkillDraftBrowser> {
    await this.ensureWorkingCopy(workspaceId)
    return getActiveSkillDraft(this.database, workspaceId)
  }

  async createDraft(workspaceId: string): Promise<SkillDraftBrowser> {
    const draft = await createDraftFromCurrentVersion(this.database, {
      workspaceId,
      draftId: randomUUID(),
      improvementCycleId: randomUUID(),
    })
    await this.ensureWorkingCopy(workspaceId)
    return draft
  }

  private async withMutationLock<T>(
    draftId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationQueues.get(draftId) ?? Promise.resolve()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => gate)
    this.mutationQueues.set(draftId, queued)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.mutationQueues.get(draftId) === queued) {
        this.mutationQueues.delete(draftId)
      }
    }
  }

  private async commitFileChanges(input: {
    readonly draft: ActiveDraftContext
    readonly operationId: string
    readonly idempotencyKey: string
    readonly requestHash: string
    readonly nextFiles: readonly SnapshotManifestFile[]
    readonly upserts: readonly SnapshotManifestFile[]
    readonly deletedPaths: readonly string[]
    readonly changes: readonly {
      readonly relativePath: string
      readonly sourcePath: string | null
    }[]
    readonly ignoreRules: readonly string[]
    readonly ignoredPaths: readonly DraftIgnoredPath[]
    readonly sourceName?: string
    readonly retainOperationMetadata?: boolean
  }): Promise<DraftMutationResponse> {
    return this.withMutationLock(input.draft.id, async () => {
      const replay = await getDraftMutationReplay(this.database, {
        workspaceId: input.draft.workspaceId,
        draftId: input.draft.id,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      })
      if (replay) {
        if (input.retainOperationMetadata) {
          await this.storage
            .retainOperationMetadataOnly(input.operationId)
            .catch(() => undefined)
        } else {
          await this.storage
            .cleanupOperation(input.operationId)
            .catch(() => undefined)
        }
        return { draft: replay, replayed: true }
      }

      const latest = await getActiveDraftContext(
        this.database,
        input.draft.workspaceId,
      )
      if (
        latest.id !== input.draft.id ||
        latest.contentRevision !== input.draft.contentRevision
      ) {
        throw new DomainError({
          code: "DRAFT_ETAG_STALE",
          message:
            "The working copy changed after this client loaded it. Local content was not overwritten.",
          kind: "precondition_failed",
          details: {
            currentEtag: createDraftEtag(
              latest.id,
              latest.contentRevision,
            ),
            contentRevision: latest.contentRevision,
          },
        })
      }

      const fileTransaction = await this.storage.applyDraftFileChanges(
        input.draft.id,
        input.operationId,
        input.changes,
      )
      try {
        const result = await commitDraftMutation(this.database, {
          workspaceId: input.draft.workspaceId,
          draftId: input.draft.id,
          expectedRevision: input.draft.contentRevision,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          nextFiles: input.nextFiles,
          upserts: input.upserts,
          deletedPaths: input.deletedPaths,
          ignoreRules: input.ignoreRules,
          ignoredPaths: input.ignoredPaths,
          ...(input.sourceName
            ? { sourceType: "folder" as const, sourceName: input.sourceName }
            : {}),
        })
        await fileTransaction.commit()
        const draft = await getActiveSkillDraft(
          this.database,
          input.draft.workspaceId,
        )
        if (input.retainOperationMetadata) {
          await this.storage
            .retainOperationMetadataOnly(input.operationId)
            .catch(() => undefined)
        } else {
          await this.storage
            .cleanupOperation(input.operationId)
            .catch(() => undefined)
        }
        return { draft, replayed: result.replayed }
      } catch (error) {
        await fileTransaction.rollback().catch(() => undefined)
        throw error
      }
    })
  }

  async saveText(
    workspaceId: string,
    input: DraftTextSave,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const relativePath = normalizeRelativePath(input.path, this.limits)
    const draft = await this.ensureWorkingCopy(workspaceId)
    assertDraftOpen(draft.status)
    const existing = draft.currentFiles.find(
      (file) => file.relativePath === relativePath,
    )
    if (!existing) {
      throw new DomainError({
        code: "DRAFT_FILE_NOT_FOUND",
        message: "The edited working-copy file was not found.",
        kind: "not_found",
        details: { path: relativePath },
      })
    }
    if (existing.contentKind !== "text") {
      throw new DomainError({
        code: "DRAFT_FILE_EDIT_NOT_SUPPORTED",
        message: "Binary files cannot be edited as UTF-8 text.",
        kind: "unsupported_media_type",
        details: { path: relativePath },
      })
    }
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const requestHash = hashRequest({
      kind: "SAVE_TEXT",
      relativePath,
      content: input.content,
    })
    const replay = await getDraftMutationReplay(this.database, {
      workspaceId,
      draftId: draft.id,
      idempotencyKey,
      requestHash,
    })
    if (replay) return { draft: replay, replayed: true }
    assertMatchingEtag(headers.ifMatch, draft.id, draft.contentRevision)

    const operationId = randomUUID()
    await this.storage.resetOperation(operationId)
    try {
      await this.storage.writeOperationTextFile(
        operationId,
        relativePath,
        input.content,
      )
      const manifest = await buildSnapshotManifest(
        [{
          incomingPath: this.storage.getOperationContentFilePath(
            operationId,
            relativePath,
          ),
          relativePath,
        }],
        this.limits,
      )
      const changed = manifest.files[0]
      if (!changed) throw new Error("The saved file manifest is empty.")
      const nextFiles = mergeFiles(
        draft.currentFiles.map(asManifestFile),
        [changed],
      )
      return await this.commitFileChanges({
        draft,
        operationId,
        idempotencyKey,
        requestHash,
        nextFiles,
        upserts: [changed],
        deletedPaths: [],
        changes: [{
          relativePath,
          sourcePath: this.storage.getOperationContentFilePath(
            operationId,
            relativePath,
          ),
        }],
        ignoreRules: draft.ignoreRules,
        ignoredPaths: draft.ignoredPaths,
      })
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      throw error
    }
  }

  async deleteFile(
    workspaceId: string,
    relativePathInput: string,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const relativePath = normalizeRelativePath(relativePathInput, this.limits)
    const draft = await this.ensureWorkingCopy(workspaceId)
    assertDraftOpen(draft.status)
    if (!draft.currentFiles.some((file) => file.relativePath === relativePath)) {
      throw new DomainError({
        code: "DRAFT_FILE_NOT_FOUND",
        message: "The working-copy file to delete was not found.",
        kind: "not_found",
      })
    }
    if (draft.currentFiles.length === 1) {
      throw new DomainError({
        code: "DRAFT_CANNOT_BE_EMPTY",
        message: "A working copy must contain at least one file.",
        kind: "conflict",
      })
    }
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const requestHash = hashRequest({ kind: "DELETE_FILE", relativePath })
    const replay = await getDraftMutationReplay(this.database, {
      workspaceId,
      draftId: draft.id,
      idempotencyKey,
      requestHash,
    })
    if (replay) return { draft: replay, replayed: true }
    assertMatchingEtag(headers.ifMatch, draft.id, draft.contentRevision)

    const operationId = randomUUID()
    await this.storage.resetOperation(operationId)
    try {
      return await this.commitFileChanges({
        draft,
        operationId,
        idempotencyKey,
        requestHash,
        nextFiles: draft.currentFiles
          .filter((file) => file.relativePath !== relativePath)
          .map(asManifestFile),
        upserts: [],
        deletedPaths: [relativePath],
        changes: [{ relativePath, sourcePath: null }],
        ignoreRules: draft.ignoreRules,
        ignoredPaths: draft.ignoredPaths,
      })
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      throw error
    }
  }

  async uploadSingleFile(
    workspaceId: string,
    parts: AsyncIterableIterator<Multipart>,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const draft = await this.ensureWorkingCopy(workspaceId)
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const operationId = randomUUID()
    const fields = new Map<string, string>()
    let receivedFile = false
    let relativePath: string | undefined
    await this.storage.resetOperation(operationId)

    try {
      for await (const part of parts) {
        if (part.type === "field") {
          if (receivedFile || part.fieldname !== "path") {
            throw uploadValidationError(
              "DRAFT_UPLOAD_FIELD_INVALID",
              "The target path must be sent before the file.",
            )
          }
          fields.set("path", mapMultipartField(part))
          continue
        }
        if (receivedFile || part.fieldname !== "file") {
          part.file.resume()
          throw uploadValidationError(
            "DRAFT_UPLOAD_FILE_INVALID",
            "A single-file upload must contain exactly one file.",
          )
        }
        relativePath = normalizeRelativePath(
          fields.get("path") || part.filename,
          this.limits,
        )
        receivedFile = true
        await this.storage.writeIncomingStream(
          operationId,
          0,
          part.file,
          this.limits.maxFileBytes,
        )
      }
      if (!receivedFile || !relativePath) {
        throw uploadValidationError(
          "DRAFT_UPLOAD_FILE_REQUIRED",
          "Select one file to add to the working copy.",
        )
      }
      const manifest = await buildSnapshotManifest(
        [{
          incomingPath: this.storage.getIncomingPath(operationId, 0),
          relativePath,
        }],
        this.limits,
      )
      const uploaded = manifest.files[0]
      if (!uploaded) throw new Error("The uploaded file manifest is empty.")
      const requestHash = hashRequest({
        kind: "UPLOAD_SINGLE_FILE",
        relativePath,
        sha256: uploaded.sha256,
      })
      const replay = await getDraftMutationReplay(this.database, {
        workspaceId,
        draftId: draft.id,
        idempotencyKey,
        requestHash,
      })
      if (replay) {
        await this.storage.cleanupOperation(operationId).catch(() => undefined)
        return { draft: replay, replayed: true }
      }
      assertMatchingEtag(headers.ifMatch, draft.id, draft.contentRevision)

      const conflictingPath = draft.currentFiles.find(
        (file) =>
          file.relativePath.toLowerCase() === relativePath!.toLowerCase() &&
          file.relativePath !== relativePath,
      )
      if (conflictingPath) {
        throw new DomainError({
          code: "DRAFT_PATH_CONFLICT",
          message: "The uploaded path conflicts by letter case.",
          kind: "conflict",
        })
      }
      const nextFiles = mergeFiles(
        draft.currentFiles.map(asManifestFile),
        [uploaded],
      )
      if (nextFiles.length > this.limits.maxFiles) {
        throw uploadValidationError(
          "UPLOAD_FILE_COUNT_EXCEEDED",
          "The working copy contains too many files.",
        )
      }
      assertNoFileDirectoryConflicts(
        nextFiles.map((file) => file.relativePath),
      )
      return await this.commitFileChanges({
        draft,
        operationId,
        idempotencyKey,
        requestHash,
        nextFiles,
        upserts: [uploaded],
        deletedPaths: [],
        changes: [{
          relativePath,
          sourcePath: this.storage.getIncomingPath(operationId, 0),
        }],
        ignoreRules: draft.ignoreRules,
        ignoredPaths: draft.ignoredPaths,
      })
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      throw error
    }
  }

  async previewFolderMerge(
    workspaceId: string,
    parts: AsyncIterableIterator<Multipart>,
    ifMatch: string | string[] | undefined,
  ): Promise<DraftFolderMergePreview> {
    const draft = await this.ensureWorkingCopy(workspaceId)
    assertMatchingEtag(ifMatch, draft.id, draft.contentRevision)
    const fields = new Map<string, string>()
    const incomingFiles: Array<{
      readonly incomingPath: string
      readonly originalPath: string
    }> = []
    let operationId: string | undefined
    let operationCreated = false
    let uploadedBytes = 0

    try {
      for await (const part of parts) {
        if (part.type === "field") {
          if (
            incomingFiles.length > 0 ||
            fields.has(part.fieldname) ||
            !["operationId", "sourceName", "ignoreRules"].includes(
              part.fieldname,
            )
          ) {
            throw uploadValidationError(
              "DRAFT_UPLOAD_FIELD_INVALID",
              "Folder fields must be unique and precede files.",
            )
          }
          fields.set(part.fieldname, mapMultipartField(part))
          continue
        }

        operationId ??= validateOperationId(fields.get("operationId") ?? "")
        if (!operationCreated) {
          await this.storage.createOperation(operationId)
          operationCreated = true
        }
        if (part.fieldname !== "files") {
          part.file.resume()
          throw uploadValidationError(
            "DRAFT_UPLOAD_FILE_INVALID",
            "Folder upload only accepts files fields.",
          )
        }
        if (incomingFiles.length >= this.limits.maxFiles) {
          part.file.resume()
          throw uploadValidationError(
            "UPLOAD_FILE_COUNT_EXCEEDED",
            "The selected folder contains too many files.",
          )
        }
        const incomingPath = this.storage.getIncomingPath(
          operationId,
          incomingFiles.length,
        )
        const written = await this.storage.writeIncomingStream(
          operationId,
          incomingFiles.length,
          part.file,
          this.limits.maxFileBytes,
        )
        uploadedBytes += written.byteSize
        if (uploadedBytes > this.limits.maxTotalBytes) {
          throw uploadValidationError(
            "UPLOAD_TOTAL_SIZE_EXCEEDED",
            "The selected folder exceeds the maximum total size.",
          )
        }
        incomingFiles.push({
          incomingPath,
          originalPath: part.filename,
        })
      }

      operationId ??= validateOperationId(fields.get("operationId") ?? "")
      if (incomingFiles.length === 0) {
        throw uploadValidationError(
          "UPLOAD_SOURCE_EMPTY",
          "The selected folder does not contain any files.",
        )
      }
      let customRules: readonly string[] = []
      if (fields.get("ignoreRules")) {
        const parsed = JSON.parse(fields.get("ignoreRules")!) as unknown
        if (
          !Array.isArray(parsed) ||
          parsed.length > 200 ||
          parsed.some((value) => typeof value !== "string")
        ) {
          throw uploadValidationError(
            "DRAFT_IGNORE_RULES_INVALID",
            "Custom ignore rules must be an array of strings.",
          )
        }
        customRules = parsed
      }

      const prepared = prepareRelativePaths(
        incomingFiles.map((file) => file.originalPath),
        "folder",
        this.limits,
      )
      const allRelativePaths = incomingFiles.map((file) => {
        const normalized = normalizeRelativePath(
          file.originalPath,
          this.limits,
        )
        return prepared.strippedRoot
          ? normalizeRelativePath(
              normalized.slice(prepared.strippedRoot.length + 1),
              this.limits,
            )
          : normalized
      })
      const ignoreFileIndex = allRelativePaths.indexOf(".skillconsoleignore")
      let fileRules: readonly string[] = []
      if (ignoreFileIndex >= 0) {
        const source = await readFile(
          incomingFiles[ignoreFileIndex]!.incomingPath,
          "utf8",
        )
        fileRules = parseDraftIgnoreRules(source)
      }
      const ignored = applyDraftFolderIgnoreRules(
        allRelativePaths,
        fileRules,
        customRules,
        this.folderIgnorePolicy,
      )
      if (ignored.includedPaths.length === 0) {
        throw uploadValidationError(
          "UPLOAD_SOURCE_EMPTY",
          "The selected folder contains no files after ignore rules.",
        )
      }
      const pathToIndex = new Map(
        allRelativePaths.map((path, index) => [path, index]),
      )
      const candidates = ignored.includedPaths.map((relativePath) => ({
        incomingPath:
          incomingFiles[pathToIndex.get(relativePath) ?? -1]!.incomingPath,
        relativePath,
      }))
      const uploadedManifest = await buildSnapshotManifest(
        candidates,
        this.limits,
      )
      const currentFiles = draft.currentFiles.map(asManifestFile)
      const existingByLowerPath = new Map(
        currentFiles.map((file) => [
          file.relativePath.toLowerCase(),
          file.relativePath,
        ]),
      )
      const conflicts = uploadedManifest.files.flatMap((file) => {
        const existing = existingByLowerPath.get(file.relativePath.toLowerCase())
        return existing && existing !== file.relativePath
          ? [existing, file.relativePath]
          : []
      })
      const mergedFiles = mergeFiles(currentFiles, uploadedManifest.files)
      const mergedTotalBytes = mergedFiles.reduce(
        (total, file) => total + file.byteSize,
        0,
      )
      if (
        mergedFiles.length > this.limits.maxFiles ||
        mergedTotalBytes > this.limits.maxTotalBytes
      ) {
        throw uploadValidationError(
          mergedFiles.length > this.limits.maxFiles
            ? "UPLOAD_FILE_COUNT_EXCEEDED"
            : "UPLOAD_TOTAL_SIZE_EXCEEDED",
          "The merged working copy exceeds the configured resource limit.",
        )
      }
      assertNoFileDirectoryConflicts(
        mergedFiles.map((file) => file.relativePath),
      )
      const entries = buildDraftDiffEntries(
        currentFiles,
        mergedFiles,
        ignored.ignoredPaths,
      )
      const summary = buildFolderPreviewSummary(
        entries,
        mergedFiles.length,
        mergedTotalBytes,
        conflicts,
      )
      const sourceName = validateDraftSourceName(
        fields.get("sourceName") || prepared.strippedRoot || undefined,
      )
      const metadata: FolderMergeOperationMetadata = {
        schemaVersion: 2,
        kind: "DRAFT_FOLDER_MERGE",
        workspaceId,
        draftId: draft.id,
        baseContentRevision: draft.contentRevision,
        sourceName,
        ignoreRules: [...customRules],
        ignoredPaths: ignored.ignoredPaths,
        uploadedManifest,
        files: candidates.map((candidate) => ({
          incomingIndex: incomingFiles.findIndex(
            (file) => file.incomingPath === candidate.incomingPath,
          ),
          relativePath: candidate.relativePath,
        })),
        summary,
      }
      await this.storage.writeOperationMetadata(operationId, metadata)
      return {
        operationId,
        draftId: draft.id,
        baseContentRevision: draft.contentRevision,
        sourceName,
        ignoreRules: [...customRules],
        summary,
        conflicts,
        committable: conflicts.length === 0,
      }
    } catch (error) {
      if (operationId && operationCreated) {
        await this.storage.cleanupOperation(operationId).catch(() => undefined)
      }
      if (error instanceof SyntaxError) {
        throw uploadValidationError(
          "DRAFT_IGNORE_RULES_INVALID",
          "Custom ignore rules must be valid JSON.",
        )
      }
      throw error
    }
  }

  async commitFolderMerge(
    workspaceId: string,
    operationIdInput: string,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const operationId = validateOperationId(operationIdInput)
    let value: unknown
    try {
      value = await this.storage.readOperationMetadata(operationId)
    } catch (error) {
      throw new DomainError({
        code: "DRAFT_FOLDER_OPERATION_NOT_FOUND",
        message: "The staged folder upload is no longer available.",
        kind: "not_found",
        cause: error,
      })
    }
    if (!isFolderMergeOperationMetadata(value) || value.workspaceId !== workspaceId) {
      throw new DomainError({
        code: "DRAFT_FOLDER_OPERATION_INVALID",
        message: "The staged folder upload is invalid.",
        kind: "conflict",
      })
    }
    const metadata = value
    const draft = await this.ensureWorkingCopy(workspaceId)
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const requestHash = hashRequest({
      kind: "MERGE_FOLDER",
      operationId,
      manifestHash: metadata.uploadedManifest.manifestHash,
    })
    const replay = await getDraftMutationReplay(this.database, {
      workspaceId,
      draftId: draft.id,
      idempotencyKey,
      requestHash,
    })
    if (replay) return { draft: replay, replayed: true }
    assertMatchingEtag(headers.ifMatch, draft.id, draft.contentRevision)
    if (
      draft.id !== metadata.draftId ||
      draft.contentRevision !== metadata.baseContentRevision
    ) {
      throw new DomainError({
        code: "DRAFT_FOLDER_PREVIEW_STALE",
        message: "The working copy changed after this folder was previewed.",
        kind: "precondition_failed",
      })
    }

    const nextFiles = mergeFiles(
      draft.currentFiles.map(asManifestFile),
      metadata.uploadedManifest.files,
    )
    const uploadedPaths = new Set(
      metadata.files.map((file) => file.relativePath),
    )
    return this.commitFileChanges({
      draft,
      operationId,
      idempotencyKey,
      requestHash,
      nextFiles,
      upserts: metadata.uploadedManifest.files,
      deletedPaths: [],
      changes: metadata.files.map((file) => ({
        relativePath: file.relativePath,
        sourcePath: this.storage.getIncomingPath(
          operationId,
          file.incomingIndex,
        ),
      })),
      ignoreRules: [
        ...new Set([...draft.ignoreRules, ...metadata.ignoreRules]),
      ],
      ignoredPaths: [
        ...new Map(
          [
            ...draft.ignoredPaths.filter(
              (path) => !uploadedPaths.has(path.relativePath),
            ),
            ...metadata.ignoredPaths,
          ].map((path) => [path.relativePath, path]),
        ).values(),
      ],
      sourceName: metadata.sourceName,
      retainOperationMetadata: true,
    })
  }
}
