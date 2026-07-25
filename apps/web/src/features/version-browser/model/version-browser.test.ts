import { describe, expect, it } from "vitest"

import {
  buildVersionFileTree,
  getDefaultFilePath,
  getPathSegments,
  type SnapshotFile,
} from "@/features/version-browser/model/version-browser"

function createFile(relativePath: string): SnapshotFile {
  return {
    relativePath,
    sha256: "a".repeat(64),
    byteSize: 100,
    mediaTypeHint: "text/plain",
    contentKind: "text",
    previewKind: relativePath.endsWith(".md") ? "markdown" : "text",
    previewable: true,
  }
}

describe("version browser model", () => {
  it("builds a deterministic directory-first tree from a flat Manifest", () => {
    const tree = buildVersionFileTree([
      createFile("scripts/check.py"),
      createFile("SKILL.md"),
      createFile("assets/examples/sample.txt"),
      createFile("README.md"),
    ])

    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ["directory", "assets"],
      ["directory", "scripts"],
      ["file", "README.md"],
      ["file", "SKILL.md"],
    ])
    expect(tree[0]?.children?.[0]?.name).toBe("examples")
    expect(tree[0]?.children?.[0]?.children?.[0]?.path).toBe(
      "assets/examples/sample.txt",
    )
  })

  it("prefers the root SKILL.md and builds path breadcrumbs", () => {
    const files = [
      createFile("docs/notes.md"),
      createFile("nested/SKILL.md"),
      createFile("SKILL.md"),
    ]

    expect(getDefaultFilePath(files)).toBe("SKILL.md")
    expect(getPathSegments("assets/examples/sample.txt")).toEqual([
      { label: "assets", path: "assets" },
      { label: "examples", path: "assets/examples" },
      { label: "sample.txt", path: "assets/examples/sample.txt" },
    ])
  })
})
