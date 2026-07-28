import type { SnapshotManifest } from "./snapshot-manifest.js"

const snapshotFileInsertBatchSize = 1_000

export interface SnapshotFileInsertRecord {
  readonly snapshotId: string
  readonly relativePath: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: "text" | "binary"
}

export function* createSnapshotFileInsertBatches(
  snapshotId: string,
  files: SnapshotManifest["files"],
): Generator<SnapshotFileInsertRecord[]> {
  for (
    let offset = 0;
    offset < files.length;
    offset += snapshotFileInsertBatchSize
  ) {
    yield files
      .slice(offset, offset + snapshotFileInsertBatchSize)
      .map((file) => ({
        snapshotId,
        relativePath: file.relativePath,
        sha256: file.sha256,
        byteSize: file.byteSize,
        mediaTypeHint: file.mediaTypeHint,
        contentKind: file.contentKind,
      }))
  }
}
