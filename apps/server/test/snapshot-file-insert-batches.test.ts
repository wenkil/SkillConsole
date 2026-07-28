import assert from "node:assert/strict"
import test from "node:test"

import { parseApplicationConfig } from "../src/config/application-config.js"
import { createSnapshotFileInsertBatches } from "../src/modules/skill-workspaces/snapshot-file-insert-batches.js"
import type { SnapshotManifest } from "../src/modules/skill-workspaces/snapshot-manifest.js"

test("the default upload ceiling accepts up to twenty thousand files", () => {
  const config = parseApplicationConfig({
    DATABASE_URL: "postgres://skillconsole:skillconsole@localhost/skillconsole",
  })

  assert.equal(config.uploadLimits.maxFiles, 20_000)
})

test("snapshot file rows are split into bounded insert batches", () => {
  const files: SnapshotManifest["files"] = Array.from(
    { length: 20_001 },
    (_, index) => ({
      relativePath: `files/${String(index).padStart(5, "0")}.txt`,
      sha256: index.toString(16).padStart(64, "0"),
      byteSize: index,
      mediaTypeHint: "text/plain",
      contentKind: "text" as const,
    }),
  )

  const batches = [
    ...createSnapshotFileInsertBatches(
      "01900000-0000-7000-8000-000000000001",
      files,
    ),
  ]

  assert.equal(batches.length, 21)
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [...Array.from({ length: 20 }, () => 1_000), 1],
  )
  assert.equal(batches[0]?.[0]?.relativePath, "files/00000.txt")
  assert.equal(batches[20]?.[0]?.relativePath, "files/20000.txt")
  assert.ok(
    batches.every((batch) =>
      batch.every(
        (row) =>
          row.snapshotId ===
          "01900000-0000-7000-8000-000000000001",
      ),
    ),
  )
})
