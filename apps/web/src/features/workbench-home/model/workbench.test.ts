import { describe, expect, it } from "vitest"

import {
  createSelectedSkillSource,
  getUploadPath,
  SourceSelectionError,
} from "@/features/workbench-home/model/workbench"

function folderFile(path: string, content: string): File {
  const file = new File([content], path.split("/").at(-1) ?? path)
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: path,
  })
  return file
}

describe("Skill source selection", () => {
  it("keeps folder-relative upload paths and builds a browser summary", () => {
    const files = [
      folderFile("invoice-skill/SKILL.md", "# Skill\n"),
      folderFile("invoice-skill/scripts/check.py", "print('ok')\n"),
    ]

    const source = createSelectedSkillSource("folder", files)

    expect(source.name).toBe("invoice-skill")
    expect(source.fileCount).toBe(2)
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
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<SourceSelectionError>>({
        code: "folderSelectionRequired",
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
