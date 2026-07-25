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
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
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

vi.mock("@/features/version-browser/api/version-browser-api", () => ({
  listSkillVersions: vi.fn(async () => versions),
  listVersionFiles: vi.fn(async (_workspaceId: string, versionId: string) => ({
    snapshotId:
      versionId === versions[0]!.id
        ? versions[0]!.snapshot.id
        : versions[1]!.snapshot.id,
    files: [
      {
        relativePath: "SKILL.md",
        sha256: versionId === versions[0]!.id ? "b".repeat(64) : "a".repeat(64),
        byteSize: 20,
        mediaTypeHint: "text/markdown",
        contentKind: "text",
        previewKind: "markdown",
        previewable: true,
      },
    ],
  })),
  readTextFilePreview: vi.fn(
    async (_workspaceId: string, versionId: string) => ({
      kind: "markdown",
      relativePath: "SKILL.md",
      mediaType: "text/markdown",
      encoding: "utf-8",
      content:
        versionId === versions[0]!.id ? "# V2 content" : "# V1 content",
    }),
  ),
  getImagePreviewUrl: vi.fn(() => "/image"),
  getFileDownloadUrl: vi.fn(() => "/download"),
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
      onBack={vi.fn()}
      onFileSelect={vi.fn()}
      onVersionSelect={setVersionId}
      selectedFilePath={null}
      selectedVersionId={versionId}
      workspace={{
        id: "01900000-0000-7000-8000-000000000001",
        name: "版本切换工作台",
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T02:00:00.000Z",
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
      screen.getByRole("combobox", { name: "Select formal version" }),
      versions[1]!.id,
    )

    expect(
      await screen.findByRole("heading", { name: "V1 content" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Viewing a historical version")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("first-source")).toBeInTheDocument()
    })
    expect(
      screen.getByRole("combobox", { name: "Select formal version" }),
    ).toHaveValue(versions[1]!.id)
  })
})
