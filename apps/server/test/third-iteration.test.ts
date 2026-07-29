import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDraftDiffEntries,
  summarizeDraftDiff,
} from "../src/modules/skill-workspaces/draft-diff.js"
import { applyDraftFolderIgnoreRules } from "../src/modules/skill-workspaces/draft-ignore.js"
import { createDraftEtag } from "../src/modules/skill-workspaces/draft.repository.js"
import type { UploadFolderIgnorePolicy } from "../src/modules/skill-workspaces/upload-folder-ignore-policy.js"

const policy: UploadFolderIgnorePolicy = {
  schemaVersion: 1,
  caseSensitive: false,
  ignoredDirectoryNames: ["node_modules"],
  ignoredFileNames: [],
  ignoredFileSuffixes: [".pyc"],
}

test("applies ordered and negated .skillconsoleignore rules without interpreting .gitignore", () => {
  const result = applyDraftFolderIgnoreRules(
    [
      ".gitignore",
      ".skillconsoleignore",
      "dist/drop.md",
      "dist/keep.md",
      "src/main.md",
    ],
    ["dist/", "!dist/keep.md"],
    [],
    policy,
  )

  assert.deepEqual(result.includedPaths, [
    ".gitignore",
    ".skillconsoleignore",
    "dist/keep.md",
    "src/main.md",
  ])
  assert.deepEqual(result.ignoredPaths, [
    {
      relativePath: "dist/drop.md",
      reason: "skillconsoleignore",
    },
  ])
})

test("applies UI rules after file rules but never re-includes protected metadata", () => {
  const result = applyDraftFolderIgnoreRules(
    [
      ".git/config",
      "node_modules/pkg/index.js",
      "generated/drop.txt",
      "generated/keep.txt",
    ],
    ["generated/"],
    ["!generated/keep.txt", ".git/config", "!node_modules/pkg/index.js"],
    policy,
  )

  assert.deepEqual(result.includedPaths, ["generated/keep.txt"])
  assert.deepEqual(
    result.ignoredPaths.map((entry) => [
      entry.relativePath,
      entry.reason,
    ]),
    [
      [".git/config", "protected"],
      ["node_modules/pkg/index.js", "protected"],
      ["generated/drop.txt", "skillconsoleignore"],
    ],
  )
})

test("builds folder-merge diff categories against the current working copy", () => {
  const base = [
    {
      relativePath: "deleted.md",
      sha256: "a".repeat(64),
      byteSize: 1,
      mediaTypeHint: "text/markdown",
      contentKind: "text",
    },
    {
      relativePath: "modified.md",
      sha256: "b".repeat(64),
      byteSize: 2,
      mediaTypeHint: "text/markdown",
      contentKind: "text",
    },
    {
      relativePath: "same.bin",
      sha256: "c".repeat(64),
      byteSize: 3,
      mediaTypeHint: "application/octet-stream",
      contentKind: "binary",
    },
  ]
  const current = [
    {
      relativePath: "added.md",
      sha256: "d".repeat(64),
      byteSize: 4,
      mediaTypeHint: "text/markdown",
      contentKind: "text",
    },
    {
      relativePath: "modified.md",
      sha256: "e".repeat(64),
      byteSize: 5,
      mediaTypeHint: "text/markdown",
      contentKind: "text",
    },
    {
      relativePath: "same.bin",
      sha256: "c".repeat(64),
      byteSize: 3,
      mediaTypeHint: "application/octet-stream",
      contentKind: "binary",
    },
  ]
  const entries = buildDraftDiffEntries(base, current, [
    { relativePath: "cache.tmp", reason: "custom" },
  ])

  assert.deepEqual(
    entries.map((entry) => [entry.relativePath, entry.status]),
    [
      ["added.md", "ADDED"],
      ["cache.tmp", "IGNORED"],
      ["deleted.md", "DELETED"],
      ["modified.md", "MODIFIED"],
      ["same.bin", "UNCHANGED"],
    ],
  )
  assert.deepEqual(summarizeDraftDiff(entries), {
    added: 1,
    modified: 1,
    deleted: 1,
    unchanged: 1,
    ignored: 1,
    unpreviewable: 1,
  })
})

test("creates a strong Draft ETag from identity and content revision", () => {
  assert.equal(
    createDraftEtag("01900000-0000-7000-8000-000000000001", 11),
    '"draft-01900000-0000-7000-8000-000000000001-r11"',
  )
})
