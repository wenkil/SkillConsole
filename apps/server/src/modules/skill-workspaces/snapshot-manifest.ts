import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

import type { UploadLimits } from "../../config/index.js"
import { uploadValidationError } from "./upload-validation.js"

export interface CandidateFile {
  readonly incomingPath: string
  readonly relativePath: string
}

export interface SnapshotManifestFile {
  readonly relativePath: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: "text" | "binary"
}

export interface SnapshotManifest {
  readonly schemaVersion: 1
  readonly manifestHash: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly files: readonly SnapshotManifestFile[]
}

export function createSnapshotManifest(
  inputFiles: readonly SnapshotManifestFile[],
): SnapshotManifest {
  const files = [...inputFiles].sort((left, right) => {
    if (left.relativePath < right.relativePath) return -1
    if (left.relativePath > right.relativePath) return 1
    return 0
  })
  const totalBytes = files.reduce((total, file) => total + file.byteSize, 0)
  const stableManifest = files.map((file) => ({
    path: file.relativePath,
    sha256: file.sha256,
    byteSize: file.byteSize,
    mediaTypeHint: file.mediaTypeHint,
    contentKind: file.contentKind,
  }))
  const manifestHash = createHash("sha256")
    .update(JSON.stringify(stableManifest))
    .digest("hex")

  return {
    schemaVersion: 1,
    manifestHash,
    fileCount: files.length,
    totalBytes,
    files,
  }
}

const mediaTypesByExtension: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/jsx",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".py": "text/x-python",
  ".svg": "image/svg+xml",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
}

function getExtension(relativePath: string): string {
  const fileName = relativePath.split("/").at(-1) ?? relativePath
  const extensionIndex = fileName.lastIndexOf(".")
  return extensionIndex > 0 ? fileName.slice(extensionIndex).toLowerCase() : ""
}

async function inspectFile(
  candidate: CandidateFile,
  maxFileBytes: number,
): Promise<SnapshotManifestFile> {
  const hash = createHash("sha256")
  let byteSize = 0
  let sampleBytesRemaining = 8 * 1024
  let containsNullByte = false

  for await (const rawChunk of createReadStream(candidate.incomingPath)) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    byteSize += chunk.length

    if (byteSize > maxFileBytes) {
      throw uploadValidationError(
        "UPLOAD_FILE_SIZE_EXCEEDED",
        "A selected file exceeds the maximum file size.",
        {
          path: candidate.relativePath,
          limit: maxFileBytes,
        },
      )
    }

    hash.update(chunk)
    if (sampleBytesRemaining > 0) {
      const sample = chunk.subarray(
        0,
        Math.min(sampleBytesRemaining, chunk.length),
      )
      containsNullByte ||= sample.includes(0)
      sampleBytesRemaining -= sample.length
    }
  }

  const extension = getExtension(candidate.relativePath)
  return {
    relativePath: candidate.relativePath,
    sha256: hash.digest("hex"),
    byteSize,
    mediaTypeHint:
      mediaTypesByExtension[extension] ?? "application/octet-stream",
    contentKind: containsNullByte ? "binary" : "text",
  }
}

export async function buildSnapshotManifest(
  candidates: readonly CandidateFile[],
  limits: UploadLimits,
): Promise<SnapshotManifest> {
  const files: SnapshotManifestFile[] = []
  let totalBytes = 0

  for (const candidate of candidates) {
    const file = await inspectFile(candidate, limits.maxFileBytes)
    totalBytes += file.byteSize
    if (totalBytes > limits.maxTotalBytes) {
      throw uploadValidationError(
        "UPLOAD_TOTAL_SIZE_EXCEEDED",
        "The selected Skill source exceeds the maximum total size.",
        { limit: limits.maxTotalBytes },
      )
    }

    files.push(file)
  }

  return createSnapshotManifest(files)
}
