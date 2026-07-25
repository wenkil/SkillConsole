import { rm } from "node:fs/promises"

import { openPromise, type Entry } from "yauzl"

import type { UploadLimits } from "../../config/index.js"
import { DomainError } from "../../core/errors/domain-error.js"
import type { LocalSnapshotStorage } from "./snapshot-storage.js"
import {
  prepareRelativePaths,
  uploadValidationError,
} from "./upload-validation.js"

function isSymbolicLink(entry: Entry): boolean {
  const platform = entry.versionMadeBy >>> 8
  if (platform !== 3) return false

  const unixMode = entry.externalFileAttributes >>> 16
  return (unixMode & 0o170000) === 0o120000
}

function isUnsupportedUnixEntry(entry: Entry): boolean {
  const platform = entry.versionMadeBy >>> 8
  if (platform !== 3) return false

  const unixMode = entry.externalFileAttributes >>> 16
  const fileType = unixMode & 0o170000
  return fileType !== 0 && fileType !== 0o100000
}

export interface ExtractedZip {
  readonly files: readonly {
    readonly incomingPath: string
    readonly relativePath: string
  }[]
  readonly ignoredCount: number
  readonly strippedRoot: string | null
}

export async function extractZipArchive(
  archivePath: string,
  operationId: string,
  storage: LocalSnapshotStorage,
  limits: UploadLimits,
): Promise<ExtractedZip> {
  let zipFile
  try {
    zipFile = await openPromise(archivePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    })
  } catch {
    throw uploadValidationError(
      "UPLOAD_ZIP_INVALID",
      "The selected ZIP archive is malformed or unsupported.",
    )
  }

  try {
    const entries: Entry[] = []
    let totalCompressedBytes = 0
    let totalUncompressedBytes = 0
    let entryCount = 0

    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1
      if (entryCount > limits.maxFiles) {
        throw uploadValidationError(
          "UPLOAD_ZIP_ENTRY_COUNT_EXCEEDED",
          "The ZIP archive contains too many entries.",
          { limit: limits.maxFiles },
        )
      }

      if (isSymbolicLink(entry)) {
        throw uploadValidationError(
          "UPLOAD_ZIP_ENTRY_UNSAFE",
          "The ZIP archive contains a symbolic link or unsupported entry.",
          { path: entry.fileName },
        )
      }

      if (entry.fileName.endsWith("/")) continue
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw uploadValidationError(
          "UPLOAD_ZIP_FORMAT_UNSUPPORTED",
          "The ZIP archive contains an encrypted or unsupported file.",
          { path: entry.fileName },
        )
      }

      if (isUnsupportedUnixEntry(entry)) {
        throw uploadValidationError(
          "UPLOAD_ZIP_ENTRY_UNSAFE",
          "The ZIP archive contains a symbolic link or unsupported entry.",
          { path: entry.fileName },
        )
      }

      if (entry.uncompressedSize > limits.maxFileBytes) {
        throw uploadValidationError(
          "UPLOAD_FILE_SIZE_EXCEEDED",
          "A ZIP entry exceeds the maximum file size.",
          {
            path: entry.fileName,
            limit: limits.maxFileBytes,
          },
        )
      }

      const entryCompressionRatio =
        entry.uncompressedSize /
        Math.max(entry.compressedSize, 1)
      if (entryCompressionRatio > limits.maxZipCompressionRatio) {
        throw uploadValidationError(
          "UPLOAD_ZIP_COMPRESSION_RATIO_EXCEEDED",
          "The ZIP archive contains a suspiciously compressed entry.",
          {
            path: entry.fileName,
            limit: limits.maxZipCompressionRatio,
          },
        )
      }

      totalCompressedBytes += entry.compressedSize
      totalUncompressedBytes += entry.uncompressedSize
      if (totalUncompressedBytes > limits.maxTotalBytes) {
        throw uploadValidationError(
          "UPLOAD_TOTAL_SIZE_EXCEEDED",
          "The ZIP archive expands beyond the maximum total size.",
          { limit: limits.maxTotalBytes },
        )
      }

      if (
        totalUncompressedBytes / Math.max(totalCompressedBytes, 1) >
        limits.maxZipCompressionRatio
      ) {
        throw uploadValidationError(
          "UPLOAD_ZIP_COMPRESSION_RATIO_EXCEEDED",
          "The ZIP archive has a suspicious overall compression ratio.",
          { limit: limits.maxZipCompressionRatio },
        )
      }

      entries.push(entry)
    }

    const prepared = prepareRelativePaths(
      entries.map((entry) => entry.fileName),
      "zip",
      limits,
    )
    const files: Array<{
      incomingPath: string
      relativePath: string
    }> = []

    for (const [outputIndex, preparedPath] of prepared.files.entries()) {
      const entry = entries[preparedPath.inputIndex]
      if (!entry) {
        throw new Error("A validated ZIP entry could not be resolved.")
      }

      const incomingPath = storage.getIncomingPath(operationId, outputIndex)
      const stream = await zipFile.openReadStreamPromise(entry)
      try {
        const result = await storage.writeIncomingStream(
          operationId,
          outputIndex,
          stream,
          limits.maxFileBytes,
        )
        if (result.byteSize !== entry.uncompressedSize) {
          throw uploadValidationError(
            "UPLOAD_ZIP_ENTRY_SIZE_MISMATCH",
            "A ZIP entry did not match its declared size.",
            { path: entry.fileName },
          )
        }
      } catch (error) {
        await rm(incomingPath, { force: true })
        throw error
      }

      files.push({
        incomingPath,
        relativePath: preparedPath.relativePath,
      })
    }

    return {
      files,
      ignoredCount: prepared.ignoredCount,
      strippedRoot: prepared.strippedRoot,
    }
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw uploadValidationError(
      "UPLOAD_ZIP_INVALID",
      "The selected ZIP archive is malformed or contains an unsafe entry.",
    )
  } finally {
    zipFile.close()
  }
}
