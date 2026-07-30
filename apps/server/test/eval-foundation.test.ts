import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { DomainError } from "../src/core/errors/domain-error.js"
import {
  assertEvalRelativePath,
  EvalStorage,
} from "../src/modules/evals/eval-storage.js"
import { snapshotManifestMatchesFiles } from "../src/modules/skill-workspaces/eval-target.domain.js"
import { createSnapshotManifest } from "../src/modules/skill-workspaces/snapshot-manifest.js"
import { parseSkillName } from "../src/modules/skill-workspaces/skill-metadata.js"

const generationId = "01900000-0000-7000-8000-000000000001"
const suiteId = "01900000-0000-7000-8000-000000000002"
const revisionId = "01900000-0000-7000-8000-000000000003"

test("reads the canonical Skill name from strict UTF-8 frontmatter", () => {
  assert.equal(
    parseSkillName("\uFEFF---\r\nname: invoice-review\r\n---\r\n# Skill"),
    "invoice-review",
  )
  assert.equal(
    parseSkillName("---\nname: 'document-review'\n---\n# Skill"),
    "document-review",
  )
})

test("rejects missing, ambiguous, and invalid Skill names", () => {
  for (const markdown of [
    "# Missing frontmatter",
    "---\nname: one\nname: two\n---",
    "---\nname: Invalid Name\n---",
  ]) {
    assert.throws(
      () => parseSkillName(markdown),
      (error) => error instanceof DomainError,
    )
  }
})

test("keeps generation and revision paths inside controlled Evals roots", () => {
  const storage = new EvalStorage(
    path.resolve("tmp", "skillconsole-eval-foundation"),
  )
  assert.equal(
    storage.getGenerationWorkspaceLocator(generationId),
    `eval-generations/${generationId}/workspace`,
  )
  assert.equal(
    storage.resolveGenerationWorkspaceLocator(
      `eval-generations/${generationId}/workspace`,
    ),
    storage.getGenerationWorkspacePath(generationId),
  )
  assert.equal(
    storage.getGenerationFilePath(generationId, "files/sample.pdf"),
    path.join(
      storage.getGenerationOutputPath(generationId),
      "files",
      "sample.pdf",
    ),
  )
  assert.equal(
    storage.getRevisionFilePath(
      suiteId,
      revisionId,
      "files/sample.pdf",
    ),
    path.join(
      storage.getRevisionRoot(suiteId, revisionId),
      "files",
      "sample.pdf",
    ),
  )
})

test("rejects traversal, absolute, and non-files generation paths", () => {
  for (const relativePath of [
    "",
    "../secret.txt",
    "files/../secret.txt",
    "files\\secret.txt",
    "/files/secret.txt",
    "C:/secret.txt",
    "files/control\u0000.txt",
  ]) {
    assert.throws(() => assertEvalRelativePath(relativePath))
  }

  const storage = new EvalStorage(
    path.resolve("tmp", "skillconsole-eval-foundation"),
  )
  assert.throws(() =>
    storage.getGenerationFilePath(generationId, "sample.pdf"),
  )
  assert.throws(() =>
    storage.resolveGenerationWorkspaceLocator(
      `eval-generations/${generationId}/workspace/extra`,
    ),
  )
})

test("detects a working-copy file race before freezing a Snapshot", () => {
  const expected = [
    {
      relativePath: "SKILL.md",
      sha256: "a".repeat(64),
      byteSize: 10,
      mediaTypeHint: "text/markdown",
      contentKind: "text" as const,
    },
  ]
  assert.equal(
    snapshotManifestMatchesFiles(createSnapshotManifest(expected), expected),
    true,
  )
  assert.equal(
    snapshotManifestMatchesFiles(
      createSnapshotManifest([
        { ...expected[0]!, sha256: "b".repeat(64) },
      ]),
      expected,
    ),
    false,
  )
})
