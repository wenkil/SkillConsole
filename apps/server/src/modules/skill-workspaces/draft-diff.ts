import type {
  DraftDiffEntry,
  DraftFolderMergePreview,
} from "./draft.contract.js"
import type { DraftIgnoredPath } from "./draft-ignore.js"
import { classifySnapshotFile } from "./version-browser.service.js"

interface ComparableFile {
  readonly relativePath: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: string
}

function contentKind(value: string): "text" | "binary" {
  if (value === "text" || value === "binary") return value
  throw new Error(`Unsupported Snapshot content kind: ${value}`)
}

function mapSide(
  file: ComparableFile | undefined,
): DraftDiffEntry["base"] {
  return file
    ? {
        sha256: file.sha256,
        byteSize: file.byteSize,
        mediaTypeHint: file.mediaTypeHint,
        contentKind: contentKind(file.contentKind),
      }
    : null
}

export function buildDraftDiffEntries(
  baseFiles: readonly ComparableFile[],
  currentFiles: readonly ComparableFile[],
  ignoredPaths: readonly DraftIgnoredPath[],
): DraftDiffEntry[] {
  const baseByPath = new Map(
    baseFiles.map((file) => [file.relativePath, file]),
  )
  const currentByPath = new Map(
    currentFiles.map((file) => [file.relativePath, file]),
  )
  const paths = new Set([...baseByPath.keys(), ...currentByPath.keys()])
  const entries: DraftDiffEntry[] = []

  for (const relativePath of [...paths].sort()) {
    const base = baseByPath.get(relativePath)
    const current = currentByPath.get(relativePath)
    const status =
      !base && current
        ? "ADDED"
        : base && !current
          ? "DELETED"
          : base?.sha256 === current?.sha256
            ? "UNCHANGED"
            : "MODIFIED"
    const representative = current ?? base
    entries.push({
      relativePath,
      status,
      previewable: representative
        ? classifySnapshotFile(representative).previewable
        : false,
      base: mapSide(base),
      current: mapSide(current),
      ignoredReason: null,
    })
  }

  for (const ignored of ignoredPaths) {
    entries.push({
      relativePath: ignored.relativePath,
      status: "IGNORED",
      previewable: false,
      base: null,
      current: null,
      ignoredReason: ignored.reason,
    })
  }

  return entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "en"),
  )
}

export function summarizeDraftDiff(
  entries: readonly DraftDiffEntry[],
): {
  readonly added: number
  readonly modified: number
  readonly deleted: number
  readonly unchanged: number
  readonly ignored: number
  readonly unpreviewable: number
} {
  return {
    added: entries.filter((entry) => entry.status === "ADDED").length,
    modified: entries.filter((entry) => entry.status === "MODIFIED").length,
    deleted: entries.filter((entry) => entry.status === "DELETED").length,
    unchanged: entries.filter((entry) => entry.status === "UNCHANGED").length,
    ignored: entries.filter((entry) => entry.status === "IGNORED").length,
    unpreviewable: entries.filter(
      (entry) => entry.status !== "IGNORED" && !entry.previewable,
    ).length,
  }
}

export function buildFolderPreviewSummary(
  entries: readonly DraftDiffEntry[],
  totalFiles: number,
  totalBytes: number,
  conflicts: readonly string[] = [],
): DraftFolderMergePreview["summary"] {
  return {
    ...summarizeDraftDiff(entries),
    conflicts: conflicts.length,
    totalFiles,
    totalBytes,
  }
}
