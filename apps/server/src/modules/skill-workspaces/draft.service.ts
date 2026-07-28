import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import type { Multipart } from "@fastify/multipart"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import type {
  Database,
  SkillSnapshotFileRow,
} from "../../infrastructure/database/index.js"

import type {
  DraftDiff,
  DraftFolderReplacementPreview,
  DraftMoveFile,
  DraftMutationResponse,
  DraftTextSave,
} from "./draft.contract.js"
import {
  buildDraftDiffEntries,
  buildFolderPreviewSummary,
  summarizeDraftDiff,
} from "./draft-diff.js"
import {
  applyDraftFolderIgnoreRules,
  parseDraftIgnoreRules,
  type DraftIgnoredPath,
} from "./draft-ignore.js"
import {
  abandonActiveDraft,
  commitDraftSnapshot,
  createDraftEtag,
  createDraftFromCurrentVersion,
  getActiveDraftContext,
  getDraftMutationReplay,
  listSnapshotFileRows,
} from "./draft.repository.js"
import {
  buildSnapshotManifest,
  type CandidateFile,
  type SnapshotManifest,
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

const editableExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml"])

interface FolderOperationMetadata {
  readonly schemaVersion: 1
  readonly kind: "DRAFT_FOLDER_REPLACEMENT"
  readonly workspaceId: string
  readonly draftId: string
  readonly baseContentRevision: number
  readonly sourceName: string
  readonly ignoreRules: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
  readonly manifest: SnapshotManifest
  readonly summary: DraftFolderReplacementPreview["summary"]
  readonly requiresDeletionConfirmation: boolean
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function getExtension(relativePath: string): string {
  const filename = relativePath.split("/").at(-1) ?? relativePath
  const index = filename.lastIndexOf(".")
  return index > 0 ? filename.slice(index).toLowerCase() : ""
}

function assertEditablePath(relativePath: string): void {
  if (!editableExtensions.has(getExtension(relativePath))) {
    throw new DomainError({
      code: "DRAFT_FILE_EDIT_NOT_SUPPORTED",
      message:
        "Online editing is limited to Markdown, TXT, JSON, YAML, and YML files.",
      kind: "unsupported_media_type",
      details: { path: relativePath },
    })
  }
}

function assertDraftPathIsNotZip(relativePath: string): void {
  if (getExtension(relativePath) === ".zip") {
    throw new DomainError({
      code: "DRAFT_ZIP_NOT_SUPPORTED",
      message:
        "ZIP archives are not supported during Draft editing. Upload a folder instead.",
      kind: "unsupported_media_type",
      details: { path: relativePath },
    })
  }
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
            "A Draft path cannot be both a file and a parent directory.",
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
      "The Draft source name is too long.",
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
      message: `${headerName} is required for this Draft change.`,
      kind: "precondition_required",
    })
  }
  const normalized = value.trim()
  if (normalized.length > (headerName === "If-Match" ? 300 : 200)) {
    throw uploadValidationError(
      "DRAFT_HEADER_INVALID",
      `${headerName} is too long.`,
    )
  }
  return normalized
}

function assertMatchingEtag(
  ifMatch: string | string[] | undefined,
  draftId: string,
  contentRevision: number,
): string {
  const value = requireHeader(ifMatch, "If-Match")
  const currentEtag = createDraftEtag(draftId, contentRevision)
  if (value !== currentEtag) {
    throw new DomainError({
      code: "DRAFT_ETAG_STALE",
      message:
        "The Draft changed after this client loaded it. Local content was not overwritten.",
      kind: "precondition_failed",
      details: { currentEtag, contentRevision },
    })
  }
  return value
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
      message: "The Draft is not open for editing.",
      kind: "conflict",
      details: { status },
    })
  }
}

function manifestCandidates(
  storage: LocalSnapshotStorage,
  operationId: string,
  relativePaths: readonly string[],
): CandidateFile[] {
  return relativePaths.map((relativePath) => ({
    incomingPath: storage.getOperationContentFilePath(
      operationId,
      relativePath,
    ),
    relativePath,
  }))
}

function mapMultipartField(part: Extract<Multipart, { type: "field" }>) {
  if (part.valueTruncated || typeof part.value !== "string") {
    throw uploadValidationError(
      "DRAFT_UPLOAD_FIELD_INVALID",
      "A Draft upload field is invalid or too long.",
      { field: part.fieldname },
    )
  }
  return part.value
}

function isFolderOperationMetadata(
  value: unknown,
): value is FolderOperationMetadata {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  const manifest = record.manifest
  return (
    record.schemaVersion === 1 &&
    record.kind === "DRAFT_FOLDER_REPLACEMENT" &&
    typeof record.workspaceId === "string" &&
    typeof record.draftId === "string" &&
    Number.isInteger(record.baseContentRevision) &&
    typeof record.sourceName === "string" &&
    Array.isArray(record.ignoreRules) &&
    Array.isArray(record.ignoredPaths) &&
    Boolean(manifest) &&
    typeof manifest === "object" &&
    typeof (manifest as Record<string, unknown>).manifestHash === "string"
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

  async createDraft(workspaceId: string): Promise<SkillDraftBrowser> {
    return createDraftFromCurrentVersion(this.database, {
      workspaceId,
      draftId: randomUUID(),
      improvementCycleId: randomUUID(),
    })
  }

  async getDiff(workspaceId: string): Promise<DraftDiff> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    const baseFiles = await listSnapshotFileRows(
      this.database,
      draft.baseSnapshotId,
    )
    const entries = buildDraftDiffEntries(
      baseFiles,
      draft.currentFiles,
      draft.ignoredPaths,
    )
    return {
      basis: {
        kind:
          draft.baseVersionId === null
            ? "INITIAL_IMPORT"
            : "FORMAL_VERSION",
        snapshotId: draft.baseSnapshotId,
        versionId: draft.baseVersionId,
      },
      currentSnapshotId: draft.currentSnapshotId,
      contentRevision: draft.contentRevision,
      summary: summarizeDraftDiff(entries),
      entries,
    }
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
    assertEditablePath(relativePath)
    const byteSize = Buffer.byteLength(input.content, "utf8")
    if (byteSize > this.limits.maxFileBytes) {
      throw new DomainError({
        code: "UPLOAD_FILE_SIZE_EXCEEDED",
        message: "The edited file exceeds the maximum file size.",
        kind: "payload_too_large",
        details: { path: relativePath, limit: this.limits.maxFileBytes },
      })
    }

    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
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
    assertMatchingEtag(
      headers.ifMatch,
      draft.id,
      draft.contentRevision,
    )
    const existing = draft.currentFiles.find(
      (file) => file.relativePath === relativePath,
    )
    if (!existing) {
      throw new DomainError({
        code: "SNAPSHOT_FILE_NOT_FOUND",
        message: "The edited Draft file was not found.",
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

    return this.commitMaterializedMutation({
      draft,
      idempotencyKey,
      requestHash,
      prepare: async (operationId) => {
        await this.storage.cloneSnapshotFiles(
          operationId,
          draft.currentSnapshotId,
          draft.currentFiles.map((file) => file.relativePath),
        )
        await this.storage.writeOperationTextFile(
          operationId,
          relativePath,
          input.content,
        )
        return {
          relativePaths: draft.currentFiles.map(
            (file) => file.relativePath,
          ),
          ignoreRules: draft.ignoreRules,
          ignoredPaths: draft.ignoredPaths,
        }
      },
    })
  }

  async deleteFile(
    workspaceId: string,
    path: string,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const relativePath = normalizeRelativePath(path, this.limits)
    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const requestHash = hashRequest({ kind: "DELETE_FILE", relativePath })
    const replay = await getDraftMutationReplay(this.database, {
      workspaceId,
      draftId: draft.id,
      idempotencyKey,
      requestHash,
    })
    if (replay) return { draft: replay, replayed: true }
    assertMatchingEtag(
      headers.ifMatch,
      draft.id,
      draft.contentRevision,
    )
    if (
      !draft.currentFiles.some(
        (file) => file.relativePath === relativePath,
      )
    ) {
      throw new DomainError({
        code: "SNAPSHOT_FILE_NOT_FOUND",
        message: "The Draft file to delete was not found.",
        kind: "not_found",
        details: { path: relativePath },
      })
    }
    if (draft.currentFiles.length === 1) {
      throw new DomainError({
        code: "DRAFT_CANNOT_BE_EMPTY",
        message: "A Draft must contain at least one file.",
        kind: "conflict",
      })
    }

    return this.commitMaterializedMutation({
      draft,
      idempotencyKey,
      requestHash,
      prepare: async (operationId) => {
        await this.storage.cloneSnapshotFiles(
          operationId,
          draft.currentSnapshotId,
          draft.currentFiles.map((file) => file.relativePath),
        )
        await this.storage.removeOperationContentFile(
          operationId,
          relativePath,
        )
        return {
          relativePaths: draft.currentFiles
            .map((file) => file.relativePath)
            .filter((candidate) => candidate !== relativePath),
          ignoreRules: draft.ignoreRules,
          ignoredPaths: draft.ignoredPaths,
        }
      },
    })
  }

  async moveFile(
    workspaceId: string,
    input: DraftMoveFile,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const fromPath = normalizeRelativePath(input.fromPath, this.limits)
    const toPath = normalizeRelativePath(input.toPath, this.limits)
    assertDraftPathIsNotZip(toPath)
    if (fromPath === toPath) {
      throw uploadValidationError(
        "DRAFT_MOVE_PATH_UNCHANGED",
        "The destination path must differ from the current path.",
      )
    }
    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const requestHash = hashRequest({ kind: "MOVE_FILE", fromPath, toPath })
    const replay = await getDraftMutationReplay(this.database, {
      workspaceId,
      draftId: draft.id,
      idempotencyKey,
      requestHash,
    })
    if (replay) return { draft: replay, replayed: true }
    assertMatchingEtag(
      headers.ifMatch,
      draft.id,
      draft.contentRevision,
    )
    const paths = new Set(
      draft.currentFiles.map((file) => file.relativePath),
    )
    if (!paths.has(fromPath)) {
      throw new DomainError({
        code: "SNAPSHOT_FILE_NOT_FOUND",
        message: "The Draft file to move was not found.",
        kind: "not_found",
        details: { path: fromPath },
      })
    }
    if (
      [...paths].some(
        (candidate) =>
          candidate.toLowerCase() === toPath.toLowerCase() &&
          candidate !== fromPath,
      )
    ) {
      throw new DomainError({
        code: "DRAFT_PATH_CONFLICT",
        message: "The destination path already exists.",
        kind: "conflict",
        details: { path: toPath },
      })
    }

    return this.commitMaterializedMutation({
      draft,
      idempotencyKey,
      requestHash,
      prepare: async (operationId) => {
        await this.storage.cloneSnapshotFiles(
          operationId,
          draft.currentSnapshotId,
          [...paths],
        )
        await this.storage.moveOperationContentFile(
          operationId,
          fromPath,
          toPath,
        )
        return {
          relativePaths: [...paths].map((candidate) =>
            candidate === fromPath ? toPath : candidate,
          ),
          ignoreRules: draft.ignoreRules,
          ignoredPaths: draft.ignoredPaths,
        }
      },
    })
  }

  async uploadSingleFile(
    workspaceId: string,
    parts: AsyncIterableIterator<Multipart>,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const operationId = randomUUID()
    const fields = new Map<string, string>()
    let receivedFile = false
    let targetPath: string | undefined

    await this.storage.resetOperation(operationId)
    try {
      for await (const part of parts) {
        if (part.type === "field") {
          if (
            receivedFile ||
            part.fieldname !== "path" ||
            fields.has(part.fieldname)
          ) {
            throw uploadValidationError(
              "DRAFT_UPLOAD_FIELD_INVALID",
              "The target path must be sent once before the file.",
            )
          }
          fields.set(part.fieldname, mapMultipartField(part))
          continue
        }
        if (receivedFile || part.fieldname !== "file") {
          part.file.resume()
          throw uploadValidationError(
            "DRAFT_UPLOAD_FILE_INVALID",
            "A single-file Draft upload must contain exactly one file.",
          )
        }
        targetPath = normalizeRelativePath(
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
      if (!receivedFile || !targetPath) {
        throw uploadValidationError(
          "DRAFT_UPLOAD_FILE_REQUIRED",
          "Select one file to add to the Draft.",
        )
      }

      const relativePath = targetPath
      assertDraftPathIsNotZip(relativePath)
      const uploadedManifest = await buildSnapshotManifest(
        [
          {
            incomingPath: this.storage.getIncomingPath(operationId, 0),
            relativePath,
          },
        ],
        this.limits,
      )
      const requestHash = hashRequest({
        kind: "UPLOAD_SINGLE_FILE",
        relativePath,
        sha256: uploadedManifest.files[0]?.sha256,
      })
      const replay = await getDraftMutationReplay(this.database, {
        workspaceId,
        draftId: draft.id,
        idempotencyKey,
        requestHash,
      })
      if (replay) {
        await this.storage.cleanupOperation(operationId)
        return { draft: replay, replayed: true }
      }
      assertMatchingEtag(
        headers.ifMatch,
        draft.id,
        draft.contentRevision,
      )
      const currentPaths = draft.currentFiles.map(
        (file) => file.relativePath,
      )
      const conflictingPath = currentPaths.find(
        (candidate) =>
          candidate.toLowerCase() === relativePath.toLowerCase() &&
          candidate !== relativePath,
      )
      if (conflictingPath) {
        throw new DomainError({
          code: "DRAFT_PATH_CONFLICT",
          message: "The uploaded path conflicts by letter case.",
          kind: "conflict",
          details: { firstPath: conflictingPath, secondPath: relativePath },
        })
      }

      await this.assertCurrentSnapshotIntegrity(draft)
      await this.storage.cloneSnapshotFiles(
        operationId,
        draft.currentSnapshotId,
        currentPaths,
      )
      await this.storage.moveIncomingToContent(
        operationId,
        0,
        relativePath,
      )
      const relativePaths = [
        ...currentPaths.filter((candidate) => candidate !== relativePath),
        relativePath,
      ]
      if (relativePaths.length > this.limits.maxFiles) {
        throw uploadValidationError(
          "UPLOAD_FILE_COUNT_EXCEEDED",
          "The Draft contains too many files.",
          { limit: this.limits.maxFiles },
        )
      }
      assertNoFileDirectoryConflicts(relativePaths)
      const manifest = await buildSnapshotManifest(
        manifestCandidates(this.storage, operationId, relativePaths),
        this.limits,
      )
      return await this.promoteAndCommit({
        draft,
        operationId,
        idempotencyKey,
        requestHash,
        manifest,
        ignoreRules: draft.ignoreRules,
        ignoredPaths: draft.ignoredPaths,
      })
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      throw error
    }
  }

  async previewFolderReplacement(
    workspaceId: string,
    parts: AsyncIterableIterator<Multipart>,
    ifMatch: string | string[] | undefined,
  ): Promise<DraftFolderReplacementPreview> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
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
              "Folder replacement fields must be unique and precede files.",
            )
          }
          fields.set(part.fieldname, mapMultipartField(part))
          continue
        }

        operationId ??= validateOperationId(
          fields.get("operationId") ?? "",
        )
        if (incomingFiles.length === 0) {
          try {
            await this.storage.createOperation(operationId)
            operationCreated = true
          } catch (error) {
            const code =
              error && typeof error === "object" && "code" in error
                ? error.code
                : undefined
            throw new DomainError({
              code:
                code === "EEXIST"
                  ? "DRAFT_FOLDER_OPERATION_CONFLICT"
                  : "DRAFT_FOLDER_OPERATION_CREATE_FAILED",
              message:
                code === "EEXIST"
                  ? "This folder replacement operation identifier is already in use."
                  : "The folder replacement staging area could not be created.",
              kind: code === "EEXIST" ? "conflict" : "internal",
              cause: error,
            })
          }
        }
        if (part.fieldname !== "files") {
          part.file.resume()
          throw uploadValidationError(
            "DRAFT_UPLOAD_FILE_INVALID",
            "Folder replacement only accepts files fields.",
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

      operationId ??= validateOperationId(
        fields.get("operationId") ?? "",
      )
      if (incomingFiles.length === 0) {
        throw uploadValidationError(
          "UPLOAD_SOURCE_EMPTY",
          "The selected folder does not contain any files.",
        )
      }

      let customRules: readonly string[] = []
      const rawCustomRules = fields.get("ignoreRules")
      if (rawCustomRules) {
        let parsed: unknown
        try {
          parsed = JSON.parse(rawCustomRules)
        } catch {
          throw uploadValidationError(
            "DRAFT_IGNORE_RULES_INVALID",
            "Custom ignore rules must be a JSON array of strings.",
          )
        }
        if (
          !Array.isArray(parsed) ||
          parsed.length > 200 ||
          parsed.some(
            (value) => typeof value !== "string" || value.length > 512,
          )
        ) {
          throw uploadValidationError(
            "DRAFT_IGNORE_RULES_INVALID",
            "Custom ignore rules must be a JSON array of strings.",
          )
        }
        customRules = parsed
      }

      let prepared
      try {
        prepared = prepareRelativePaths(
          incomingFiles.map((file) => file.originalPath),
          "folder",
          this.limits,
        )
      } catch (error) {
        if (
          error instanceof DomainError &&
          error.code === "UPLOAD_PATH_CASE_CONFLICT"
        ) {
          const conflicts = [
            String(error.details?.firstPath ?? ""),
            String(error.details?.secondPath ?? ""),
          ].filter(Boolean)
          await this.storage.cleanupOperation(operationId)
          return {
            operationId,
            draftId: draft.id,
            baseContentRevision: draft.contentRevision,
            sourceName: fields.get("sourceName")?.trim() || "Skill folder",
            ignoreRules: [...customRules],
            summary: buildFolderPreviewSummary(
              [],
              0,
              0,
              conflicts,
            ),
            conflicts,
            requiresDeletionConfirmation: false,
            committable: false,
          }
        }
        throw error
      }

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
      for (const relativePath of allRelativePaths) {
        assertDraftPathIsNotZip(relativePath)
      }
      const ignoreFileIndex = allRelativePaths.findIndex(
        (path) => path === ".skillconsoleignore",
      )
      let skillconsoleRules: readonly string[] = []
      if (ignoreFileIndex >= 0) {
        const source = await readFile(
          incomingFiles[ignoreFileIndex]?.incomingPath ?? "",
        )
        let decoded: string
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(source)
        } catch {
          throw uploadValidationError(
            "DRAFT_IGNORE_FILE_UTF8_INVALID",
            ".skillconsoleignore must be valid UTF-8 text.",
          )
        }
        skillconsoleRules = parseDraftIgnoreRules(decoded)
      }
      const ignored = applyDraftFolderIgnoreRules(
        allRelativePaths,
        skillconsoleRules,
        customRules,
        this.folderIgnorePolicy,
      )
      if (ignored.includedPaths.length === 0) {
        throw uploadValidationError(
          "UPLOAD_SOURCE_EMPTY",
          "The selected folder contains no files after ignore rules.",
        )
      }
      assertNoFileDirectoryConflicts(ignored.includedPaths)
      const indexByPath = new Map(
        allRelativePaths.map((path, index) => [path, index]),
      )
      const candidates = ignored.includedPaths.map((relativePath) => {
        const index = indexByPath.get(relativePath)
        const incoming = index === undefined ? undefined : incomingFiles[index]
        if (!incoming) {
          throw new Error("A validated folder file could not be resolved.")
        }
        return { incomingPath: incoming.incomingPath, relativePath }
      })
      const manifest = await buildSnapshotManifest(candidates, this.limits)
      await this.storage.materializeFiles(operationId, candidates)
      const entries = buildDraftDiffEntries(
        draft.currentFiles,
        manifest.files,
        ignored.ignoredPaths,
      )
      const summary = buildFolderPreviewSummary(
        entries,
        manifest.fileCount,
        manifest.totalBytes,
      )
      const requiresDeletionConfirmation = summary.deleted > 0
      const sourceName = validateDraftSourceName(
        fields.get("sourceName") || prepared.strippedRoot || undefined,
      )
      const metadata: FolderOperationMetadata = {
        schemaVersion: 1,
        kind: "DRAFT_FOLDER_REPLACEMENT",
        workspaceId,
        draftId: draft.id,
        baseContentRevision: draft.contentRevision,
        sourceName,
        ignoreRules: [...customRules],
        ignoredPaths: ignored.ignoredPaths,
        manifest,
        summary,
        requiresDeletionConfirmation,
      }
      await this.storage.writeOperationMetadata(operationId, metadata)
      return {
        operationId,
        draftId: draft.id,
        baseContentRevision: draft.contentRevision,
        sourceName,
        ignoreRules: [...customRules],
        summary,
        conflicts: [],
        requiresDeletionConfirmation,
        committable: true,
      }
    } catch (error) {
      if (operationId && operationCreated) {
        await this.storage.cleanupOperation(operationId).catch(() => undefined)
      }
      throw error
    }
  }

  async commitFolderReplacement(
    workspaceId: string,
    operationIdInput: string,
    confirmDeletions: boolean,
    headers: {
      readonly ifMatch: string | string[] | undefined
      readonly idempotencyKey: string | string[] | undefined
    },
  ): Promise<DraftMutationResponse> {
    const operationId = validateOperationId(operationIdInput)
    let metadataValue: unknown
    try {
      metadataValue = await this.storage.readOperationMetadata(operationId)
    } catch (error) {
      throw new DomainError({
        code: "DRAFT_FOLDER_OPERATION_NOT_FOUND",
        message:
          "The staged folder replacement was not found or is no longer available.",
        kind: "not_found",
        cause: error,
      })
    }
    if (!isFolderOperationMetadata(metadataValue)) {
      throw new DomainError({
        code: "DRAFT_FOLDER_OPERATION_INVALID",
        message: "The staged folder replacement is invalid.",
        kind: "conflict",
      })
    }
    const metadata = metadataValue
    if (metadata.workspaceId !== workspaceId) {
      throw new DomainError({
        code: "DRAFT_FOLDER_OPERATION_NOT_FOUND",
        message: "The staged folder replacement was not found.",
        kind: "not_found",
      })
    }
    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
    const idempotencyKey = requireIdempotencyKey(headers.idempotencyKey)
    const requestHash = hashRequest({
      kind: "REPLACE_FOLDER",
      operationId,
      manifestHash: metadata.manifest.manifestHash,
      ignoreRules: metadata.ignoreRules,
    })
    const replay = await getDraftMutationReplay(this.database, {
      workspaceId,
      draftId: metadata.draftId,
      idempotencyKey,
      requestHash,
    })
    if (replay) return { draft: replay, replayed: true }
    assertMatchingEtag(
      headers.ifMatch,
      draft.id,
      draft.contentRevision,
    )
    if (
      draft.id !== metadata.draftId ||
      draft.contentRevision !== metadata.baseContentRevision
    ) {
      throw new DomainError({
        code: "DRAFT_FOLDER_PREVIEW_STALE",
        message:
          "The Draft changed after this folder replacement was previewed.",
        kind: "precondition_failed",
        details: {
          currentEtag: createDraftEtag(draft.id, draft.contentRevision),
        },
      })
    }
    if (
      metadata.requiresDeletionConfirmation &&
      !confirmDeletions
    ) {
      throw new DomainError({
        code: "DRAFT_FOLDER_DELETION_CONFIRMATION_REQUIRED",
        message:
          "Confirm the listed deletions before replacing the Draft folder.",
        kind: "conflict",
        details: { deleted: metadata.summary.deleted },
      })
    }

    try {
      return await this.promoteAndCommit({
        draft,
        operationId,
        idempotencyKey,
        requestHash,
        manifest: metadata.manifest,
        ignoreRules: metadata.ignoreRules,
        ignoredPaths: metadata.ignoredPaths,
        sourceType: "folder",
        sourceName: metadata.sourceName,
        cleanupOperationOnSuccess: false,
      })
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      throw error
    }
  }

  async abandon(
    workspaceId: string,
    ifMatch: string | string[] | undefined,
  ): Promise<void> {
    const draft = await getActiveDraftContext(this.database, workspaceId)
    assertDraftOpen(draft.status)
    assertMatchingEtag(ifMatch, draft.id, draft.contentRevision)
    await abandonActiveDraft(this.database, {
      workspaceId,
      draftId: draft.id,
      expectedRevision: draft.contentRevision,
    })
  }

  private async assertCurrentSnapshotIntegrity(
    draft: Awaited<ReturnType<typeof getActiveDraftContext>>,
  ): Promise<void> {
    if (draft.currentSnapshot.state !== "READY") {
      throw new DomainError({
        code: "SNAPSHOT_NOT_READY",
        message: "The current Draft Snapshot is not ready for editing.",
        kind: "conflict",
        details: { state: draft.currentSnapshot.state },
      })
    }
    let actualManifest: SnapshotManifest
    try {
      actualManifest = await buildSnapshotManifest(
        draft.currentFiles.map((file) => ({
          incomingPath: this.storage.getSnapshotFilePath(
            draft.currentSnapshotId,
            file.relativePath,
          ),
          relativePath: file.relativePath,
        })),
        this.limits,
      )
    } catch (error) {
      throw new DomainError({
        code: "SNAPSHOT_FILE_CORRUPTED",
        message:
          "The current Draft Snapshot is missing or cannot be verified before editing.",
        kind: "conflict",
        cause: error,
      })
    }

    if (
      actualManifest.manifestHash !== draft.currentSnapshot.manifestHash ||
      actualManifest.fileCount !== draft.currentSnapshot.fileCount ||
      actualManifest.totalBytes !== draft.currentSnapshot.totalBytes
    ) {
      throw new DomainError({
        code: "SNAPSHOT_FILE_CORRUPTED",
        message:
          "The current Draft Snapshot no longer matches its persisted Manifest.",
        kind: "conflict",
      })
    }
  }

  private async commitMaterializedMutation(input: {
    readonly draft: Awaited<ReturnType<typeof getActiveDraftContext>>
    readonly idempotencyKey: string
    readonly requestHash: string
    readonly prepare: (operationId: string) => Promise<{
      readonly relativePaths: readonly string[]
      readonly ignoreRules: readonly string[]
      readonly ignoredPaths: readonly DraftIgnoredPath[]
    }>
  }): Promise<DraftMutationResponse> {
    const operationId = randomUUID()
    await this.assertCurrentSnapshotIntegrity(input.draft)
    await this.storage.resetOperation(operationId)
    try {
      const prepared = await input.prepare(operationId)
      if (prepared.relativePaths.length === 0) {
        throw new DomainError({
          code: "DRAFT_CANNOT_BE_EMPTY",
          message: "A Draft must contain at least one file.",
          kind: "conflict",
        })
      }
      if (prepared.relativePaths.length > this.limits.maxFiles) {
        throw uploadValidationError(
          "UPLOAD_FILE_COUNT_EXCEEDED",
          "The Draft contains too many files.",
          { limit: this.limits.maxFiles },
        )
      }
      assertNoFileDirectoryConflicts(prepared.relativePaths)
      const manifest = await buildSnapshotManifest(
        manifestCandidates(
          this.storage,
          operationId,
          prepared.relativePaths,
        ),
        this.limits,
      )
      return await this.promoteAndCommit({
        draft: input.draft,
        operationId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        manifest,
        ignoreRules: prepared.ignoreRules,
        ignoredPaths: prepared.ignoredPaths,
      })
    } catch (error) {
      await this.storage.cleanupOperation(operationId).catch(() => undefined)
      throw error
    }
  }

  private async promoteAndCommit(input: {
    readonly draft: Awaited<ReturnType<typeof getActiveDraftContext>>
    readonly operationId: string
    readonly idempotencyKey: string
    readonly requestHash: string
    readonly manifest: SnapshotManifest
    readonly ignoreRules: readonly string[]
    readonly ignoredPaths: readonly DraftIgnoredPath[]
    readonly sourceType?: "folder"
    readonly sourceName?: string
    readonly cleanupOperationOnSuccess?: boolean
  }): Promise<DraftMutationResponse> {
    const snapshotId = randomUUID()
    const storageLocator = await this.storage.promoteSnapshot(
      input.operationId,
      snapshotId,
      input.manifest,
    )
    let databaseCommitted = false
    try {
      let result
      try {
        result = await commitDraftSnapshot(this.database, {
          workspaceId: input.draft.workspaceId,
          draftId: input.draft.id,
          expectedRevision: input.draft.contentRevision,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          snapshotId,
          storageLocator,
          manifest: input.manifest,
          ignoreRules: input.ignoreRules,
          ignoredPaths: input.ignoredPaths,
          ...(input.sourceType ? { sourceType: input.sourceType } : {}),
          ...(input.sourceName ? { sourceName: input.sourceName } : {}),
        })
      } catch (error) {
        if (
          error instanceof DomainError &&
          error.code === "DRAFT_ETAG_STALE"
        ) {
          const replay = await getDraftMutationReplay(this.database, {
            workspaceId: input.draft.workspaceId,
            draftId: input.draft.id,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
          })
          if (replay) {
            await this.storage.removeSnapshot(snapshotId)
            if (input.cleanupOperationOnSuccess !== false) {
              await this.storage
                .cleanupOperation(input.operationId)
                .catch(() => undefined)
            }
            return { draft: replay, replayed: true }
          }
        }
        throw error
      }
      databaseCommitted = !result.replayed
      if (result.usedSnapshotId !== snapshotId) {
        await this.storage.removeSnapshot(snapshotId)
      }
      const draft = await getActiveSkillDraft(
        this.database,
        input.draft.workspaceId,
      )
      if (input.cleanupOperationOnSuccess !== false) {
        await this.storage
          .cleanupOperation(input.operationId)
          .catch(() => undefined)
      } else {
        await this.storage
          .retainOperationMetadataOnly(input.operationId)
          .catch(() => undefined)
      }
      return { draft, replayed: result.replayed }
    } catch (error) {
      if (!databaseCommitted) {
        await this.storage.removeSnapshot(snapshotId).catch(() => undefined)
      }
      throw error
    }
  }
}
