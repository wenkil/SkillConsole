import { describe, expect, it } from "vitest"

import {
  createEmptyWorkbenchDraft,
  createSelectedSkillSource,
  getUploadPath,
  SourceSelectionError,
  type UploadFolderIgnorePolicy,
} from "@/features/workbench-home/model/workbench"

const folderIgnorePolicy: UploadFolderIgnorePolicy = {
  schemaVersion: 1,
  caseSensitive: false,
  ignoredDirectoryNames: ["node_modules", ".venv"],
  ignoredFileNames: [".DS_Store"],
  ignoredFileSuffixes: [".pyc", ".whl"],
}

function folderFile(path: string, content: string): File {
  const file = new File([content], path.split("/").at(-1) ?? path)
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: path,
  })
  return file
}

describe("Skill source selection", () => {
  it("defaults new workbenches to a complete folder source", () => {
    expect(createEmptyWorkbenchDraft().sourceKind).toBe("folder")
  })

  it("keeps folder-relative upload paths and builds a browser summary", () => {
    const files = [
      folderFile("invoice-skill/SKILL.md", "# Skill\n"),
      folderFile("invoice-skill/scripts/check.py", "print('ok')\n"),
      folderFile(
        "invoice-skill/node_modules/package/index.js",
        "dependency\n",
      ),
      folderFile("invoice-skill/scripts/cache.pyc", "compiled\n"),
    ]

    const source = createSelectedSkillSource(
      "folder",
      files,
      folderIgnorePolicy,
    )

    expect(source.name).toBe("invoice-skill")
    expect(source.fileCount).toBe(2)
    expect(source.ignoredFileCount).toBe(2)
    expect(source.totalBytes).toBe(20)
    expect(source.maxDepth).toBe(2)
    expect(getUploadPath("folder", files[1]!)).toBe(
      "invoice-skill/scripts/check.py",
    )
  })

  it("requires a directory picker result for folder sources", () => {
    expect(() =>
      createSelectedSkillSource("folder", [
        new File(["content"], "SKILL.md"),
      ], folderIgnorePolicy),
    ).toThrowError(
      expect.objectContaining<Partial<SourceSelectionError>>({
        code: "folderSelectionRequired",
      }),
    )
  })

  it("rejects a folder when every file is ignored", () => {
    expect(() =>
      createSelectedSkillSource(
        "folder",
        [
          folderFile(
            "invoice-skill/Node_Modules/package/index.js",
            "dependency\n",
          ),
        ],
        folderIgnorePolicy,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SourceSelectionError>>({
        code: "folderFilesIgnored",
      }),
    )
  })

  it("applies directory rules after stripping the selected root", () => {
    const source = createSelectedSkillSource(
      "folder",
      [folderFile("node_modules/SKILL.md", "# Skill\n")],
      folderIgnorePolicy,
    )

    expect(source.fileCount).toBe(1)
    expect(source.ignoredFileCount).toBe(0)
  })

  it("blocks folder selection until the server policy is available", () => {
    expect(() =>
      createSelectedSkillSource("folder", [
        folderFile("invoice-skill/SKILL.md", "# Skill\n"),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<SourceSelectionError>>({
        code: "folderPolicyUnavailable",
      }),
    )
  })

  it("accepts only one .zip archive for a ZIP source", () => {
    expect(() =>
      createSelectedSkillSource("zip", [
        new File(["not zip"], "skill.txt"),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<SourceSelectionError>>({
        code: "zipRequired",
      }),
    )
  })
})
