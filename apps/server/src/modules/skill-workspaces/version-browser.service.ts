import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import type { SkillSnapshotFileRow } from "../../infrastructure/database/index.js"
import { DomainError } from "../../core/errors/domain-error.js"

import type { LocalSnapshotStorage } from "./snapshot-storage.js"
import type {
  SnapshotFilePreviewKind,
  TextFilePreview,
} from "./version-browser.contract.js"
import type { VersionFileRecord } from "./version-browser.repository.js"

const inlineImageMediaTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

function getExtension(relativePath: string): string {
  return path.posix.extname(relativePath).toLowerCase()
}

export function classifySnapshotFile(
  file: Pick<
    SkillSnapshotFileRow,
    "relativePath" | "byteSize" | "mediaTypeHint" | "contentKind"
  >,
): {
  previewKind: SnapshotFilePreviewKind
  previewable: boolean
} {
  const extension = getExtension(file.relativePath)

  if (inlineImageMediaTypes.has(file.mediaTypeHint)) {
    return {
      previewKind: "image",
      previewable: true,
    }
  }

  if (file.contentKind === "binary") {
    return {
      previewKind: "binary",
      previewable: false,
    }
  }

  const previewKind: SnapshotFilePreviewKind =
    extension === ".md"
      ? "markdown"
      : extension === ".json"
        ? "json"
        : extension === ".yaml" || extension === ".yml"
          ? "yaml"
          : "text"

  return {
    previewKind,
    previewable: true,
  }
}

function assertSnapshotReady(record: VersionFileRecord): void {
  if (record.snapshotState !== "READY") {
    throw new DomainError({
      code: "SNAPSHOT_NOT_READY",
      message: "This formal version Snapshot is not available for browsing.",
      kind: "conflict",
      details: { state: record.snapshotState },
    })
  }
}

async function readVerifiedFile(
  storage: LocalSnapshotStorage,
  record: VersionFileRecord,
): Promise<Buffer> {
  assertSnapshotReady(record)

  let content: Buffer
  try {
    content = await readFile(
      storage.getSnapshotFilePath(
        record.snapshotId,
        record.file.relativePath,
      ),
    )
  } catch (error) {
    throw new DomainError({
      code: "SNAPSHOT_FILE_CORRUPTED",
      message: "The stored Snapshot file is missing or cannot be read.",
      kind: "conflict",
      details: { path: record.file.relativePath },
      cause: error,
    })
  }

  const actualHash = createHash("sha256").update(content).digest("hex")
  if (
    content.byteLength !== record.file.byteSize ||
    actualHash !== record.file.sha256
  ) {
    throw new DomainError({
      code: "SNAPSHOT_FILE_CORRUPTED",
      message: "The stored Snapshot file no longer matches its Manifest.",
      kind: "conflict",
      details: { path: record.file.relativePath },
    })
  }

  return content
}

export async function readTextPreview(
  storage: LocalSnapshotStorage,
  record: VersionFileRecord,
): Promise<TextFilePreview> {
  const classification = classifySnapshotFile(record.file)
  if (
    classification.previewKind === "binary" ||
    classification.previewKind === "image"
  ) {
    throw new DomainError({
      code: "FILE_TEXT_PREVIEW_NOT_SUPPORTED",
      message: "This file cannot be opened as UTF-8 text.",
      kind: "unsupported_media_type",
      details: {
        path: record.file.relativePath,
        mediaType: record.file.mediaTypeHint,
      },
    })
  }

  const content = await readVerifiedFile(storage, record)
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch (error) {
    throw new DomainError({
      code: "FILE_UTF8_INVALID",
      message: "This file is not valid UTF-8 and cannot be previewed as text.",
      kind: "unsupported_media_type",
      details: { path: record.file.relativePath },
      cause: error,
    })
  }

  return {
    kind: classification.previewKind,
    relativePath: record.file.relativePath,
    mediaType: record.file.mediaTypeHint,
    encoding: "utf-8",
    content: decoded,
  }
}

export async function readImagePreview(
  storage: LocalSnapshotStorage,
  record: VersionFileRecord,
): Promise<{
  content: Buffer
  mediaType: string
}> {
  const classification = classifySnapshotFile(record.file)
  if (classification.previewKind !== "image") {
    throw new DomainError({
      code: "FILE_IMAGE_PREVIEW_NOT_SUPPORTED",
      message: "This file cannot be rendered as a safe inline image.",
      kind: "unsupported_media_type",
      details: {
        path: record.file.relativePath,
        mediaType: record.file.mediaTypeHint,
      },
    })
  }

  return {
    content: await readVerifiedFile(storage, record),
    mediaType: record.file.mediaTypeHint,
  }
}

export async function readFileDownload(
  storage: LocalSnapshotStorage,
  record: VersionFileRecord,
): Promise<Buffer> {
  return readVerifiedFile(storage, record)
}
