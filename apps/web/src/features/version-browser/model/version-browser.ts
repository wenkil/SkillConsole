import type { SkillSourceKind } from "@/features/workbench-home/model/workbench"

export type SnapshotState = "STAGING" | "READY" | "CORRUPTED"
export type SnapshotFilePreviewKind =
  | "markdown"
  | "json"
  | "yaml"
  | "text"
  | "image"
  | "binary"
export type VersionPreviewIssue =
  | "missing"
  | "corrupted"
  | "snapshot_unavailable"
  | "invalid_utf8"
  | "binary"
  | "unavailable"

export interface SkillVersionBrowser {
  id: string
  versionNumber: number
  sourceType: SkillSourceKind
  sourceName: string
  createdAt: string
  publishedAt: string
  isCurrent: boolean
  isDefaultBaseline: boolean
  snapshot: {
    id: string
    state: SnapshotState
    manifestHash: string
    fileCount: number
    totalBytes: number
    createdAt: string
  }
}

export interface SkillDraftBrowser {
  id: string
  improvementCycleId: string
  baseVersionId: string | null
  baseSnapshotId: string
  contentRevision: number
  status: "OPEN" | "FINALIZING"
  sourceType: SkillSourceKind
  sourceName: string
  ignoreRules: string[]
  ignoredPaths: Array<{
    relativePath: string
    reason: "protected" | "skillconsoleignore" | "custom"
  }>
  createdAt: string
  updatedAt: string
  snapshot: {
    id: string
    state: SnapshotState
    manifestHash: string
    fileCount: number
    totalBytes: number
    createdAt: string
  }
}

export interface DraftResource {
  draft: SkillDraftBrowser
  etag: string
}

export type DraftDiffStatus =
  | "ADDED"
  | "MODIFIED"
  | "DELETED"
  | "UNCHANGED"
  | "IGNORED"

export interface DraftDiffFileSide {
  sha256: string
  byteSize: number
  mediaTypeHint: string
  contentKind: "text" | "binary"
}

export interface DraftDiffEntry {
  relativePath: string
  status: DraftDiffStatus
  previewable: boolean
  base: DraftDiffFileSide | null
  current: DraftDiffFileSide | null
  ignoredReason:
    | "protected"
    | "skillconsoleignore"
    | "custom"
    | null
}

export interface DraftDiff {
  basis: {
    kind: "INITIAL_IMPORT" | "FORMAL_VERSION"
    snapshotId: string
    versionId: string | null
  }
  currentSnapshotId: string
  contentRevision: number
  summary: {
    added: number
    modified: number
    deleted: number
    unchanged: number
    ignored: number
    unpreviewable: number
  }
  entries: DraftDiffEntry[]
}

export interface DraftFolderMergePreview {
  operationId: string
  draftId: string
  baseContentRevision: number
  sourceName: string
  ignoreRules: string[]
  summary: DraftDiff["summary"] & {
    conflicts: number
    totalFiles: number
    totalBytes: number
  }
  conflicts: string[]
  committable: boolean
}

export type SkillBrowserTarget =
  | (SkillDraftBrowser & { kind: "draft" })
  | (SkillVersionBrowser & { kind: "version" })

export interface SnapshotFile {
  relativePath: string
  sha256: string
  byteSize: number
  mediaTypeHint: string
  contentKind: "text" | "binary"
  previewKind: SnapshotFilePreviewKind
  previewable: boolean
}

export interface SnapshotFileList {
  snapshotId: string
  files: SnapshotFile[]
}

export interface TextFilePreview {
  kind: Exclude<SnapshotFilePreviewKind, "image" | "binary">
  relativePath: string
  mediaType: string
  encoding: "utf-8"
  content: string
}

export interface VersionFileTreeNode {
  id: string
  name: string
  path: string
  kind: "directory" | "file"
  file: SnapshotFile | null
  children?: VersionFileTreeNode[]
}

function sortTree(nodes: VersionFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1
    }
    return left.name.localeCompare(right.name, "en")
  })

  for (const node of nodes) {
    if (node.children) sortTree(node.children)
  }
}

export function buildVersionFileTree(
  files: readonly SnapshotFile[],
): VersionFileTreeNode[] {
  const roots: VersionFileTreeNode[] = []
  const directories = new Map<string, VersionFileTreeNode>()

  for (const file of files) {
    const segments = file.relativePath.split("/")
    let children = roots
    let parentPath = ""

    for (const segment of segments.slice(0, -1)) {
      const directoryPath = parentPath ? `${parentPath}/${segment}` : segment
      let directory = directories.get(directoryPath)
      if (!directory) {
        directory = {
          id: `directory:${directoryPath}`,
          name: segment,
          path: directoryPath,
          kind: "directory",
          file: null,
          children: [],
        }
        directories.set(directoryPath, directory)
        children.push(directory)
      }

      children = directory.children ?? []
      parentPath = directoryPath
    }

    children.push({
      id: `file:${file.relativePath}`,
      name: segments.at(-1) ?? file.relativePath,
      path: file.relativePath,
      kind: "file",
      file,
    })
  }

  sortTree(roots)
  return roots
}

export function getDefaultFilePath(
  files: readonly SnapshotFile[],
): string | null {
  return (
    files.find((file) => file.relativePath === "SKILL.md")?.relativePath ??
    files.find((file) =>
      file.relativePath.toLowerCase().endsWith("/skill.md"),
    )?.relativePath ??
    files.find((file) => file.previewable)?.relativePath ??
    files[0]?.relativePath ??
    null
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function getPathSegments(relativePath: string): Array<{
  label: string
  path: string
}> {
  let currentPath = ""
  return relativePath.split("/").map((segment) => {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    return { label: segment, path: currentPath }
  })
}
