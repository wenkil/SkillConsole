import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { VersionFileTree } from "@/features/version-browser/components/version-file-tree"
import {
  buildVersionFileTree,
  type SnapshotFile,
} from "@/features/version-browser/model/version-browser"
import { getVersionBrowserCopy } from "@/features/version-browser/model/version-browser-copy"
import { i18n } from "@/shared/i18n/i18n"

const copy = getVersionBrowserCopy(
  i18n.getFixedT("zh-CN", "versionBrowser"),
)

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
})

function createLargeManifest(): SnapshotFile[] {
  return Array.from({ length: 2_000 }, (_value, index) => {
    const group = String(Math.floor(index / 100)).padStart(2, "0")
    const file = String(index).padStart(4, "0")
    return {
      relativePath: `group-${group}/file-${file}.txt`,
      sha256: "a".repeat(64),
      byteSize: 32,
      mediaTypeHint: "text/plain",
      contentKind: "text",
      previewKind: "text",
      previewable: true,
    }
  })
}

describe("VersionFileTree React Arborist PoC", () => {
  it("virtualizes 2,000 files while preserving tree ARIA and keyboard activation in React 19", async () => {
    const user = userEvent.setup()
    const files = createLargeManifest()
    const onFileSelect = vi.fn()

    render(
      <VersionFileTree
        copy={copy}
        fileCount={files.length}
        onFileSelect={onFileSelect}
        onSearchTermChange={vi.fn()}
        searchTerm=""
        selectedPath={null}
        tree={buildVersionFileTree(files)}
      />,
    )

    const tree = screen.getByRole("tree")
    const renderedRows = screen.getAllByRole("treeitem")
    expect(renderedRows.length).toBeGreaterThan(5)
    expect(renderedRows.length).toBeLessThan(100)
    expect(renderedRows[0]).toHaveAttribute("aria-level", "1")
    expect(renderedRows[0]).toHaveAttribute("aria-expanded", "false")

    tree.focus()
    await user.keyboard("{ArrowRight}{ArrowRight} ")
    expect(onFileSelect).toHaveBeenCalledWith(
      "group-00/file-0000.txt",
    )
  })

  it("uses Arborist filtering for path search", () => {
    const files = createLargeManifest()
    render(
      <VersionFileTree
        copy={copy}
        fileCount={files.length}
        onFileSelect={vi.fn()}
        onSearchTermChange={vi.fn()}
        searchTerm="file-1999"
        selectedPath={null}
        tree={buildVersionFileTree(files)}
      />,
    )

    expect(screen.getByText("file-1999.txt")).toBeInTheDocument()
    expect(screen.queryByText("file-0000.txt")).not.toBeInTheDocument()
  })
})
