import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { VersionBrowserView } from "@/features/version-browser/components/version-browser-view"
import type {
  SkillDraftBrowser,
  SkillVersionBrowser,
} from "@/features/version-browser/model/version-browser"
import { i18n } from "@/shared/i18n/i18n"

const versions: SkillVersionBrowser[] = [
  {
    id: "01900000-0000-7000-8000-000000000102",
    sequenceNumber: 2,
    name: "V2",
    description: null,
    labels: [],
    sourceType: "folder",
    sourceName: "second-source",
    createdAt: "2026-07-25T02:00:00.000Z",
    frozenAt: "2026-07-25T02:00:00.000Z",
    isOnline: true,
    isComparisonBaseline: false,
    snapshot: {
      id: "01900000-0000-7000-8000-000000000202",
      state: "READY",
      manifestHash: "b".repeat(64),
      fileCount: 1,
      totalBytes: 20,
      createdAt: "2026-07-25T02:00:00.000Z",
    },
  },
  {
    id: "01900000-0000-7000-8000-000000000101",
    sequenceNumber: 1,
    name: "V1",
    description: null,
    labels: [],
    sourceType: "single_file",
    sourceName: "first-source",
    createdAt: "2026-07-25T01:00:00.000Z",
    frozenAt: "2026-07-25T01:00:00.000Z",
    isOnline: false,
    isComparisonBaseline: true,
    snapshot: {
      id: "01900000-0000-7000-8000-000000000201",
      state: "READY",
      manifestHash: "a".repeat(64),
      fileCount: 1,
      totalBytes: 20,
      createdAt: "2026-07-25T01:00:00.000Z",
    },
  },
]

const initialCandidate: SkillDraftBrowser = {
  id: "01900000-0000-7000-8000-000000000301",
  contentRevision: 1,
  status: "OPEN",
  sourceType: "folder",
  sourceName: "candidate-source",
  ignoreRules: [],
  ignoredPaths: [],
  createdAt: "2026-07-25T03:00:00.000Z",
  updatedAt: "2026-07-25T03:00:00.000Z",
  workingCopy: {
    fileCount: 1,
    totalBytes: 28,
  },
}

vi.mock("@/features/version-browser/api/version-browser-api", () => ({
  listSkillVersions: vi.fn(async (workspaceId: string) =>
    workspaceId.endsWith("999") ? [] : versions,
  ),
  getActiveSkillDraft: vi.fn(async () => ({
    draft: initialCandidate,
    etag: `"draft-${initialCandidate.id}-r1"`,
  })),
  listTargetFiles: vi.fn(async (_workspaceId: string, target: { id: string }) => ({
    targetId: target.id,
    files: [
      {
        relativePath: "SKILL.md",
        sha256:
          target.id === initialCandidate.id
            ? "c".repeat(64)
            : target.id === versions[0]!.id
              ? "b".repeat(64)
              : "a".repeat(64),
        byteSize: 20,
        mediaTypeHint: "text/markdown",
        contentKind: "text",
        previewKind: "markdown",
        previewable: true,
      },
      {
        relativePath: "scripts/assemble_ppt.py",
        sha256: "d".repeat(64),
        byteSize: 24,
        mediaTypeHint: "text/x-python",
        contentKind: "text",
        previewKind: "text",
        previewable: true,
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
      mediaType: relativePath.endsWith(".md")
        ? "text/markdown"
        : "text/plain",
      encoding: "utf-8",
      content:
        relativePath.endsWith(".py")
          ? "print('editable')\n"
          : target.id === initialCandidate.id
          ? "# Candidate content"
          : target.id === versions[0]!.id
            ? "# V2 content"
            : "# V1 content",
    }),
  ),
  getTargetImagePreviewUrl: vi.fn(() => "/image"),
  getTargetFileDownloadUrl: vi.fn(() => "/download"),
}))

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock)
})

function VersionSwitchHarness() {
  const [versionId, setVersionId] = useState<string | null>(null)
  return (
    <VersionBrowserView
      onFileSelect={vi.fn()}
      onTargetSelect={(target) => {
        if (target.kind === "version") setVersionId(target.id)
      }}
      selectedFilePath={null}
      selectedVersionId={versionId}
      workspace={{
        id: "01900000-0000-7000-8000-000000000001",
        name: "版本切换工作台",
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T02:00:00.000Z",
        activeDraft: null,
        versionCount: 2,
        onlineVersion: {
          id: versions[0]!.id,
          sequenceNumber: 2,
          name: "V2",
          labels: [],
          sourceType: "folder",
          sourceName: "second-source",
          frozenAt: "2026-07-25T02:00:00.000Z",
          isComparisonBaseline: false,
          snapshot: {
            id: versions[0]!.snapshot.id,
            manifestHash: "b".repeat(64),
            fileCount: 1,
            totalBytes: 20,
          },
        },
      }}
    />
  )
}

describe("VersionBrowserView", () => {
  it("browses the initial candidate without presenting it as V1", async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <VersionBrowserView
            onFileSelect={vi.fn()}
            onTargetSelect={vi.fn()}
            selectedFilePath="scripts/assemble_ppt.py"
            selectedVersionId={null}
            workspace={{
              id: "01900000-0000-7000-8000-000000000999",
              name: "Candidate workbench",
              createdAt: initialCandidate.createdAt,
              updatedAt: initialCandidate.updatedAt,
              onlineVersion: null,
              versionCount: 0,
              activeDraft: {
                ...initialCandidate,
              },
            }}
          />
        </QueryClientProvider>
      </I18nextProvider>,
    )

    expect(
      await screen.findByRole("button", { name: "Save draft" }),
    ).toBeInTheDocument()
    const saveButton = screen.getByRole("button", { name: "Save draft" })
    const deleteButton = screen.getByRole("button", {
      name: "Delete current file",
    })
    expect(
      saveButton.compareDocumentPosition(deleteButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Current file actions" }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText(/工作副本/).length).toBeGreaterThan(0)
    expect(
      screen.getByRole("button", { name: "保存为版本" }),
    ).toBeInTheDocument()
    expect(screen.getByText("可持续编辑的工作副本")).toBeInTheDocument()
    expect(screen.queryByText("V1")).not.toBeInTheDocument()
    const codeEditor = document.querySelector(
      '.cm-content[contenteditable="true"]',
    )
    expect(codeEditor).toHaveTextContent("print('editable')")

    const singleFileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]:not([multiple])',
    )
    const folderInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][multiple]',
    )
    expect(singleFileInput).toHaveAttribute("hidden")
    expect(folderInput).toHaveAttribute("hidden")

    const singleFileClick = vi.spyOn(singleFileInput!, "click")
    const folderClick = vi.spyOn(folderInput!, "click")
    await user.click(
      screen.getByRole("button", { name: "Add / update" }),
    )
    await user.click(
      screen.getByRole("menuitem", { name: /Upload one file/ }),
    )
    await waitFor(() => expect(singleFileClick).toHaveBeenCalledOnce())

    await user.click(
      screen.getByRole("button", { name: "Add / update" }),
    )
    await user.click(
      screen.getByRole("menuitem", {
        name: /Upload a folder/,
      }),
    )
    await waitFor(() => expect(folderClick).toHaveBeenCalledOnce())
    expect(
      screen.queryByText("Single-file actions"),
    ).not.toBeInTheDocument()
  })

  it("synchronizes preview and metadata when switching to a historical version", async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <VersionSwitchHarness />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "V2 content" }),
    ).toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "查看目标",
      }),
      `version:${versions[1]!.id}`,
    )

    expect(
      await screen.findByRole("heading", { name: "V1 content" }),
    ).toBeInTheDocument()
    expect(screen.getByText("内容已冻结的测试版本")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: "编辑版本信息",
      }),
    )
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "版本名称" }),
      ).toHaveValue("V1")
    })
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(
      screen.getByRole("combobox", {
        name: "查看目标",
      }),
    ).toHaveValue(`version:${versions[1]!.id}`)
  })
})
