import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { VersionCompareView } from "@/features/version-browser/components/version-compare-view"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
import { i18n } from "@/shared/i18n/i18n"

vi.mock("@codemirror/merge", () => ({
  MergeView: class {
    private readonly nodes: HTMLTextAreaElement[]

    constructor({
      a,
      b,
      parent,
    }: {
      a: { doc?: string }
      b: { doc?: string }
      parent?: Element | DocumentFragment
    }) {
      this.nodes = [a.doc ?? "", b.doc ?? ""].map((value) => {
        const editor = document.createElement("textarea")
        editor.readOnly = true
        editor.value = value
        parent?.append(editor)
        return editor
      })
    }

    destroy() {
      for (const node of this.nodes) node.remove()
    }
  },
}))

const versions: SkillVersionBrowser[] = [
  {
    id: "01900000-0000-7000-8000-000000000102",
    sequenceNumber: 2,
    name: "Experiment B",
    description: null,
    labels: ["current"],
    sourceType: "folder",
    sourceName: "skill",
    createdAt: "2026-07-29T02:00:00.000Z",
    frozenAt: "2026-07-29T02:00:00.000Z",
    isOnline: true,
    isComparisonBaseline: false,
    snapshot: {
      id: "01900000-0000-7000-8000-000000000202",
      state: "READY",
      manifestHash: "b".repeat(64),
      fileCount: 2,
      totalBytes: 32,
      createdAt: "2026-07-29T02:00:00.000Z",
    },
  },
  {
    id: "01900000-0000-7000-8000-000000000101",
    sequenceNumber: 1,
    name: "V1",
    description: null,
    labels: [],
    sourceType: "folder",
    sourceName: "skill",
    createdAt: "2026-07-29T01:00:00.000Z",
    frozenAt: "2026-07-29T01:00:00.000Z",
    isOnline: false,
    isComparisonBaseline: false,
    snapshot: {
      id: "01900000-0000-7000-8000-000000000201",
      state: "READY",
      manifestHash: "a".repeat(64),
      fileCount: 1,
      totalBytes: 12,
      createdAt: "2026-07-29T01:00:00.000Z",
    },
  },
]

vi.mock("@/features/version-browser/api/version-browser-api", () => ({
  listSkillVersions: vi.fn(async () => versions),
  compareSkillVersions: vi.fn(async () => ({
    leftVersion: versions[1],
    rightVersion: versions[0],
    summary: { added: 1, modified: 1, deleted: 0, unchanged: 0 },
    entries: [
      {
        relativePath: "SKILL.md",
        status: "MODIFIED",
        left: {
          relativePath: "SKILL.md",
          sha256: "a".repeat(64),
          byteSize: 12,
          mediaTypeHint: "text/markdown",
          contentKind: "text",
          previewKind: "markdown",
          previewable: true,
        },
        right: {
          relativePath: "SKILL.md",
          sha256: "b".repeat(64),
          byteSize: 14,
          mediaTypeHint: "text/markdown",
          contentKind: "text",
          previewKind: "markdown",
          previewable: true,
        },
      },
      {
        relativePath: "new.txt",
        status: "ADDED",
        left: null,
        right: {
          relativePath: "new.txt",
          sha256: "c".repeat(64),
          byteSize: 18,
          mediaTypeHint: "text/plain",
          contentKind: "text",
          previewKind: "text",
          previewable: true,
        },
      },
    ],
  })),
  readTargetTextFilePreview: vi.fn(
    async (
      _workspaceId: string,
      target: { id: string },
      relativePath: string,
    ) => ({
      kind: relativePath.endsWith(".md") ? "markdown" : "text",
      relativePath,
      mediaType: "text/plain",
      encoding: "utf-8",
      content:
        target.id === versions[1]!.id
          ? "# V1\n"
          : relativePath === "SKILL.md"
            ? "# Experiment B\n"
            : "new file\n",
    }),
  ),
}))

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
})

describe("VersionCompareView", () => {
  it("shows the directory union and opens the selected file diff automatically", async () => {
    await i18n.changeLanguage("zh-CN")
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <VersionCompareView
              workspace={{
                id: "01900000-0000-7000-8000-000000000001",
                name: "版本对比工作台",
                createdAt: "2026-07-29T00:00:00.000Z",
                updatedAt: "2026-07-29T02:00:00.000Z",
                activeDraft: null,
                versionCount: 2,
                onlineVersion: null,
              }}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )

    expect(await screen.findByText("新增 1")).toBeInTheDocument()
    expect(screen.getByText("修改 1")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /对比/ }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        [...document.querySelectorAll("textarea")]
          .filter((element) => element.readOnly)
          .map((element) => element.value),
      ).toEqual(["# V1\n", "# Experiment B\n"])
    })
  })
})
