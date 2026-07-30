import type { SnapshotManifest, SnapshotManifestFile } from "./snapshot-manifest.js"

export type EvalTargetInput =
  | {
      readonly kind: "draft"
      readonly draftId: string
      readonly contentRevision: number
    }
  | {
      readonly kind: "version"
      readonly versionId: string
    }

interface FrozenEvalTargetBase {
  readonly snapshotId: string
  readonly skillName: string
  readonly manifestHash: string
  readonly fileCount: number
  readonly totalBytes: number
}

export type FrozenEvalTarget =
  | (FrozenEvalTargetBase & {
      readonly sourceKind: "DRAFT_REVISION"
      readonly draftRevisionId: string
      readonly versionId: null
    })
  | (FrozenEvalTargetBase & {
      readonly sourceKind: "SKILL_VERSION"
      readonly draftRevisionId: null
      readonly versionId: string
    })

export function snapshotManifestMatchesFiles(
  actual: SnapshotManifest,
  expectedFiles: readonly SnapshotManifestFile[],
): boolean {
  if (actual.fileCount !== expectedFiles.length) return false
  const expectedByPath = new Map(
    expectedFiles.map((file) => [file.relativePath, file]),
  )
  return actual.files.every((file) => {
    const expected = expectedByPath.get(file.relativePath)
    if (!expected) return false
    return (
      expected.sha256 === file.sha256 &&
      expected.byteSize === file.byteSize &&
      expected.mediaTypeHint === file.mediaTypeHint &&
      expected.contentKind === file.contentKind
    )
  })
}

export function asSnapshotManifestFiles(
  files: readonly {
    readonly relativePath: string
    readonly sha256: string
    readonly byteSize: number
    readonly mediaTypeHint: string
    readonly contentKind: string
  }[],
): SnapshotManifestFile[] {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sha256: file.sha256,
    byteSize: file.byteSize,
    mediaTypeHint: file.mediaTypeHint,
    contentKind: file.contentKind as "text" | "binary",
  }))
}
