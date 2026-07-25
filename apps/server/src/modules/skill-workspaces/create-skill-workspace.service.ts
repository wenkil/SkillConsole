import { randomUUID } from "node:crypto"

import type { Multipart } from "@fastify/multipart"

import { DomainError } from "../../core/errors/domain-error.js"

import type { UploadLimits } from "../../config/index.js"
import type {
  Database,
  SkillSourceType,
} from "../../infrastructure/database/index.js"
import {
  failUploadOperation,
  getSkillWorkspace,
  prepareUploadOperation,
  publishInitialVersion,
  updateUploadOperationState,
} from "./skill-workspace.repository.js"
import type { CreateSkillWorkspaceResponse } from "./skill-workspace.contract.js"
import {
  buildSnapshotManifest,
  type CandidateFile,
} from "./snapshot-manifest.js"
import { LocalSnapshotStorage } from "./snapshot-storage.js"
import {
  normalizeRelativePath,
  prepareRelativePaths,
  uploadValidationError,
  validateOperationId,
  validateSourceType,
  validateWorkspaceName,
} from "./upload-validation.js"
import { extractZipArchive } from "./zip-extractor.js"

interface UploadMetadata {
  readonly operationId: string
  readonly workspaceName: string
  readonly sourceType: SkillSourceType
}

interface IncomingFile {
  readonly incomingPath: string
  readonly originalPath: string
}

function getStringField(part: Extract<Multipart, { type: "field" }>): string {
  if (part.valueTruncated || typeof part.value !== "string") {
    throw uploadValidationError(
      "UPLOAD_FIELD_INVALID",
      "An upload field is invalid or too long.",
      { field: part.fieldname },
    )
  }

  return part.value
}

function buildMetadata(fields: ReadonlyMap<string, string>): UploadMetadata {
  const operationId = fields.get("operationId")
  const workspaceName = fields.get("name")
  const sourceType = fields.get("sourceType")

  if (!operationId || !workspaceName || !sourceType) {
    throw uploadValidationError(
      "UPLOAD_METADATA_REQUIRED",
      "The upload metadata must be sent before the Skill files.",
    )
  }

  return {
    operationId: validateOperationId(operationId),
    workspaceName: validateWorkspaceName(workspaceName),
    sourceType: validateSourceType(sourceType),
  }
}

function getSafeSourceName(
  input: string,
  limits: UploadLimits,
): string {
  const normalizedPath = normalizeRelativePath(input, limits)
  return normalizedPath.split("/").at(-1) ?? normalizedPath
}

function mapUploadError(
  error: unknown,
  sourceType?: SkillSourceType,
): DomainError {
  if (error instanceof DomainError) return error

  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : ""
  const message = error instanceof Error ? error.message : ""

  if (
    code === "FST_REQ_FILE_TOO_LARGE" ||
    message === "UPLOAD_STREAM_SIZE_LIMIT"
  ) {
    return new DomainError({
      code:
        sourceType === "zip"
          ? "UPLOAD_ZIP_SIZE_EXCEEDED"
          : "UPLOAD_FILE_SIZE_EXCEEDED",
      message:
        sourceType === "zip"
          ? "The ZIP archive exceeds the maximum upload size."
          : "A selected file exceeds the maximum file size.",
      kind: "payload_too_large",
    })
  }

  if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT") {
    return uploadValidationError(
      "UPLOAD_FILE_COUNT_EXCEEDED",
      "The selected Skill source contains too many files.",
    )
  }

  let databaseError: unknown = error
  let databaseErrorCode = ""
  for (let depth = 0; depth < 4; depth += 1) {
    if (!databaseError || typeof databaseError !== "object") break
    if ("code" in databaseError && typeof databaseError.code === "string") {
      databaseErrorCode = databaseError.code
      break
    }
    databaseError =
      "cause" in databaseError ? databaseError.cause : undefined
  }

  if (databaseErrorCode === "23505") {
    return new DomainError({
      code: "SKILL_WORKSPACE_NAME_CONFLICT",
      message: "A Skill testing workbench with this name already exists.",
      kind: "conflict",
    })
  }

  return new DomainError({
    code: "UPLOAD_FAILED",
    message: "The Skill source could not be uploaded and published.",
    kind: "internal",
    cause: error,
  })
}

async function drainMultipartParts(
  remainingPart: Extract<Multipart, { type: "file" }>,
  parts: AsyncIterator<Multipart>,
): Promise<void> {
  remainingPart.file.resume()
  for (;;) {
    const next = await parts.next()
    if (next.done) break
    if (next.value.type === "file") next.value.file.resume()
  }
}

export interface CreateSkillWorkspaceServiceOptions {
  readonly database: Database
  readonly storage: LocalSnapshotStorage
  readonly limits: UploadLimits
}

export class CreateSkillWorkspaceService {
  readonly database: Database
  readonly storage: LocalSnapshotStorage
  readonly limits: UploadLimits

  constructor({
    database,
    storage,
    limits,
  }: CreateSkillWorkspaceServiceOptions) {
    this.database = database
    this.storage = storage
    this.limits = limits
  }

  async create(
    multipartParts: AsyncIterableIterator<Multipart>,
  ): Promise<CreateSkillWorkspaceResponse> {
    const fields = new Map<string, string>()
    const incomingFiles: IncomingFile[] = []
    let metadata: UploadMetadata | undefined
    let prepared = false
    let published = false
    let zipSourceName: string | undefined
    let uploadedBytes = 0

    try {
      for (;;) {
        const next = await multipartParts.next()
        if (next.done) break
        const part = next.value

        if (part.type === "field") {
          if (metadata || fields.has(part.fieldname)) {
            throw uploadValidationError(
              "UPLOAD_FIELD_INVALID",
              "Upload fields must be unique and sent before files.",
              { field: part.fieldname },
            )
          }

          if (
            part.fieldname !== "operationId" &&
            part.fieldname !== "name" &&
            part.fieldname !== "sourceType"
          ) {
            throw uploadValidationError(
              "UPLOAD_FIELD_INVALID",
              "The upload contains an unsupported field.",
              { field: part.fieldname },
            )
          }

          fields.set(part.fieldname, getStringField(part))
          continue
        }

        if (part.fieldname !== "files") {
          throw uploadValidationError(
            "UPLOAD_FIELD_INVALID",
            "The upload contains an unsupported file field.",
            { field: part.fieldname },
          )
        }

        metadata ??= buildMetadata(fields)
        if (!prepared) {
          const operation = await prepareUploadOperation(
            this.database,
            {
              id: metadata.operationId,
              workspaceName: metadata.workspaceName,
              sourceType: metadata.sourceType,
            },
          )
          prepared = true

          if (operation.kind === "replayed") {
            await drainMultipartParts(part, multipartParts)
            await this.storage
              .cleanupOperation(metadata.operationId)
              .catch(() => undefined)
            const workspace = await getSkillWorkspace(
              this.database,
              operation.workspaceId,
            )
            return {
              workspace,
              replayed: true,
              upload: {
                operationId: metadata.operationId,
                fileCount: workspace.currentVersion.snapshot.fileCount,
                totalBytes: workspace.currentVersion.snapshot.totalBytes,
                ignoredFileCount: operation.ignoredFileCount,
                strippedRoot: operation.strippedRoot,
                manifestHash:
                  workspace.currentVersion.snapshot.manifestHash,
              },
            }
          }

          await this.storage.resetOperation(metadata.operationId)
        }

        if (metadata.sourceType === "zip") {
          if (zipSourceName || incomingFiles.length > 0) {
            throw uploadValidationError(
              "UPLOAD_SOURCE_COUNT_INVALID",
              "A ZIP source must contain exactly one uploaded archive.",
            )
          }

          zipSourceName = getSafeSourceName(part.filename, this.limits)
          if (!zipSourceName.toLowerCase().endsWith(".zip")) {
            throw uploadValidationError(
              "UPLOAD_ZIP_REQUIRED",
              "The ZIP source must be a .zip archive.",
            )
          }

          const result = await this.storage.writeArchiveStream(
            metadata.operationId,
            part.file,
            this.limits.maxZipBytes,
          )
          uploadedBytes += result.byteSize
        } else {
          if (incomingFiles.length >= this.limits.maxFiles) {
            throw uploadValidationError(
              "UPLOAD_FILE_COUNT_EXCEEDED",
              "The selected Skill source contains too many files.",
              { limit: this.limits.maxFiles },
            )
          }

          const incomingPath = this.storage.getIncomingPath(
            metadata.operationId,
            incomingFiles.length,
          )
          const result = await this.storage.writeIncomingStream(
            metadata.operationId,
            incomingFiles.length,
            part.file,
            this.limits.maxFileBytes,
          )
          uploadedBytes += result.byteSize
          if (uploadedBytes > this.limits.maxTotalBytes) {
            throw uploadValidationError(
              "UPLOAD_TOTAL_SIZE_EXCEEDED",
              "The selected Skill source exceeds the maximum total size.",
              { limit: this.limits.maxTotalBytes },
            )
          }

          incomingFiles.push({
            incomingPath,
            originalPath: part.filename,
          })
        }

        if (part.file.truncated) {
          throw new Error("UPLOAD_STREAM_SIZE_LIMIT")
        }
      }

      metadata ??= buildMetadata(fields)
      if (!prepared) {
        const operation = await prepareUploadOperation(this.database, {
          id: metadata.operationId,
          workspaceName: metadata.workspaceName,
          sourceType: metadata.sourceType,
        })
        prepared = true
        if (operation.kind === "replayed") {
          await this.storage
            .cleanupOperation(metadata.operationId)
            .catch(() => undefined)
          const workspace = await getSkillWorkspace(
            this.database,
            operation.workspaceId,
          )
          return {
            workspace,
            replayed: true,
            upload: {
              operationId: metadata.operationId,
              fileCount: workspace.currentVersion.snapshot.fileCount,
              totalBytes: workspace.currentVersion.snapshot.totalBytes,
              ignoredFileCount: operation.ignoredFileCount,
              strippedRoot: operation.strippedRoot,
              manifestHash: workspace.currentVersion.snapshot.manifestHash,
            },
          }
        }
        await this.storage.resetOperation(metadata.operationId)
      }

      await updateUploadOperationState(
        this.database,
        metadata.operationId,
        "VALIDATING",
      )

      let candidates: CandidateFile[]
      let ignoredFileCount: number
      let strippedRoot: string | null
      let sourceName: string

      if (metadata.sourceType === "zip") {
        if (!zipSourceName) {
          throw uploadValidationError(
            "UPLOAD_SOURCE_REQUIRED",
            "Select a ZIP archive before creating the workbench.",
          )
        }

        const extracted = await extractZipArchive(
          this.storage.getArchivePath(metadata.operationId),
          metadata.operationId,
          this.storage,
          this.limits,
        )
        candidates = [...extracted.files]
        ignoredFileCount = extracted.ignoredCount
        strippedRoot = extracted.strippedRoot
        sourceName = zipSourceName
      } else {
        if (
          metadata.sourceType === "single_file" &&
          incomingFiles.length !== 1
        ) {
          throw uploadValidationError(
            "UPLOAD_SOURCE_COUNT_INVALID",
            "A single-file source must contain exactly one file.",
          )
        }

        const preparedPaths = prepareRelativePaths(
          incomingFiles.map((file) => file.originalPath),
          metadata.sourceType,
          this.limits,
        )
        candidates = preparedPaths.files.map((preparedPath) => {
          const incomingFile = incomingFiles[preparedPath.inputIndex]
          if (!incomingFile) {
            throw new Error("A validated uploaded file could not be resolved.")
          }

          return {
            incomingPath: incomingFile.incomingPath,
            relativePath: preparedPath.relativePath,
          }
        })
        ignoredFileCount = preparedPaths.ignoredCount
        strippedRoot = preparedPaths.strippedRoot
        sourceName =
          metadata.sourceType === "folder"
            ? (preparedPaths.strippedRoot ?? "Skill folder")
            : (preparedPaths.files[0]?.relativePath ?? "Skill file")
      }

      const manifest = await buildSnapshotManifest(candidates, this.limits)
      await this.storage.materializeFiles(
        metadata.operationId,
        candidates,
      )
      await updateUploadOperationState(
        this.database,
        metadata.operationId,
        "PUBLISHING",
        sourceName,
      )

      const workspaceId = randomUUID()
      const snapshotId = randomUUID()
      const versionId = randomUUID()
      const storageLocator = await this.storage.promoteSnapshot(
        metadata.operationId,
        snapshotId,
        manifest,
      )

      try {
        await publishInitialVersion(this.database, {
          operationId: metadata.operationId,
          workspaceId,
          workspaceName: metadata.workspaceName,
          snapshotId,
          versionId,
          sourceType: metadata.sourceType,
          sourceName,
          ignoredFileCount,
          strippedRoot,
          storageLocator,
          manifest,
        })
        published = true
      } catch (error) {
        await this.storage.removeSnapshot(snapshotId)
        throw error
      }

      await this.storage
        .cleanupOperation(metadata.operationId)
        .catch(() => undefined)
      const workspace = await getSkillWorkspace(this.database, workspaceId)
      return {
        workspace,
        replayed: false,
        upload: {
          operationId: metadata.operationId,
          fileCount: manifest.fileCount,
          totalBytes: manifest.totalBytes,
          ignoredFileCount,
          strippedRoot,
          manifestHash: manifest.manifestHash,
        },
      }
    } catch (error) {
      const mappedError = mapUploadError(error, metadata?.sourceType)
      if (metadata && prepared) {
        const cleanupTasks: Promise<unknown>[] = [
          this.storage.cleanupOperation(metadata.operationId),
        ]
        if (!published) {
          cleanupTasks.push(
            failUploadOperation(
              this.database,
              metadata.operationId,
              mappedError,
            ),
          )
        }
        await Promise.allSettled(cleanupTasks)
      }

      throw mappedError
    }
  }
}
