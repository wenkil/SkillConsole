import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { I18nextProvider } from "react-i18next"
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
    versionNumber: 2,
    sourceType: "folder",
    sourceName: "second-source",
    createdAt: "2026-07-25T02:00:00.000Z",
    publishedAt: "2026-07-25T02:00:00.000Z",
    isCurrent: true,
    isDefaultBaseline: false,
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
    versionNumber: 1,
    sourceType: "single_file",
    sourceName: "first-source",
    createdAt: "2026-07-25T01:00:00.000Z",
    publishedAt: "2026-07-25T01:00:00.000Z",
    isCurrent: false,
    isDefaultBaseline: true,
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
  improvementCycleId: "01900000-0000-7000-8000-000000000302",
  baseVersionId: null,
  baseSnapshotId: "01900000-0000-7000-8000-000000000303",
  contentRevision: 1,
  status: "OPEN",
  sourceType: "folder",
  sourceName: "candidate-source",
  ignoreRules: [],
  ignoredPaths: [],
  createdAt: "2026-07-25T03:00:00.000Z",
  updatedAt: "2026-07-25T03:00:00.000Z",
  snapshot: {
    id: "01900000-0000-7000-8000-000000000303",
    state: "READY",
    manifestHash: "c".repeat(64),
    fileCount: 1,
    totalBytes: 28,
    createdAt: "2026-07-25T03:00:00.000Z",
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
  readDraftDiff: vi.fn(async () => ({
    basis: {
      kind: "INITIAL_IMPORT",
      snapshotId: initialCandidate.baseSnapshotId,
      versionId: null,
    },
    currentSnapshotId: initialCandidate.snapshot.id,
    contentRevision: 1,
    summary: {
      added: 0,
      modified: 0,
      deleted: 0,
      unchanged: 1,
      ignored: 0,
      unpreviewable: 0,
    },
    entries: [
      {
        relativePath: "SKILL.md",
        status: "UNCHANGED",
        previewable: true,
        base: {
          sha256: "c".repeat(64),
          byteSize: 20,
          mediaTypeHint: "text/markdown",
          contentKind: "text",
        },
        current: {
          sha256: "c".repeat(64),
          byteSize: 20,
          mediaTypeHint: "text/markdown",
          contentKind: "text",
        },
        ignoredReason: null,
      },
    ],
  })),
  readDraftBaseTextFile: vi.fn(async () => ({
    kind: "markdown",
    relativePath: "SKILL.md",
    mediaType: "text/markdown",
    encoding: "utf-8",
    content: "# Candidate content",
  })),
  listTargetFiles: vi.fn(async (_workspaceId: string, target: { id: string }) => ({
    snapshotId:
      target.id === initialCandidate.id
        ? initialCandidate.snapshot.id
        : target.id === versions[0]!.id
        ? versions[0]!.snapshot.id
        : versions[1]!.snapshot.id,
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
      locale="zh-CN"
      onDraftAbandoned={vi.fn()}
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
        currentVersion: {
          id: versions[0]!.id,
          versionNumber: 2,
          sourceType: "folder",
          sourceName: "second-source",
          publishedAt: "2026-07-25T02:00:00.000Z",
          isDefaultBaseline: false,
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
            locale="en"
            onDraftAbandoned={vi.fn()}
            onFileSelect={vi.fn()}
            onTargetSelect={vi.fn()}
            selectedFilePath="scripts/assemble_ppt.py"
            selectedVersionId={null}
            workspace={{
              id: "01900000-0000-7000-8000-000000000999",
              name: "Candidate workbench",
              createdAt: initialCandidate.createdAt,
              updatedAt: initialCandidate.updatedAt,
              currentVersion: null,
              activeDraft: {
                ...initialCandidate,
                snapshot: {
                  id: initialCandidate.snapshot.id,
                  manifestHash: initialCandidate.snapshot.manifestHash,
                  fileCount: initialCandidate.snapshot.fileCount,
                  totalBytes: initialCandidate.snapshot.totalBytes,
                },
              },
            }}
          />
        </QueryClientProvider>
      </I18nextProvider>,
    )

    expect(
      await screen.findByRole("button", { name: "Save draft" }),
    ).toBeInTheDocument()
    expect(screen.getAllByText("Initial candidate").length).toBeGreaterThan(0)
    expect(screen.getByText("Awaiting test and confirmation")).toBeInTheDocument()
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
      screen.getByRole("button", { name: "Choose one file" }),
    )
    await user.click(
      screen.getByRole("button", { name: "Choose complete folder" }),
    )
    expect(singleFileClick).toHaveBeenCalledOnce()
    expect(folderClick).toHaveBeenCalledOnce()
  })

  it("synchronizes preview and metadata when switching to a historical version", async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <VersionSwitchHarness />
        </QueryClientProvider>
      </I18nextProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "V2 content" }),
    ).toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Select candidate or version",
      }),
      `version:${versions[1]!.id}`,
    )

    expect(
      await screen.findByRole("heading", { name: "V1 content" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Viewing a historical version")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("first-source")).toBeInTheDocument()
    })
    expect(
      screen.getByRole("combobox", {
        name: "Select candidate or version",
      }),
    ).toHaveValue(`version:${versions[1]!.id}`)
  })
})
