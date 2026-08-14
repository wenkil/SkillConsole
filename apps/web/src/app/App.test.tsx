import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppRoutes } from "@/app/App"
import { i18n } from "@/shared/i18n/i18n"

const workspace = vi.hoisted(() => ({
  id: "01900000-0000-7000-8000-000000000001",
  name: "发票审核 Skill",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  activeDraft: {
    id: "01900000-0000-7000-8000-000000000004",
    contentRevision: 2,
    status: "OPEN" as const,
    sourceType: "folder" as const,
    sourceName: "invoice-skill",
    createdAt: "2026-07-24T11:00:00.000Z",
    updatedAt: "2026-07-24T11:30:00.000Z",
    workingCopy: {
      fileCount: 13,
      totalBytes: 5120,
    },
  },
  versionCount: 1,
  onlineVersion: {
    id: "01900000-0000-7000-8000-000000000002",
    sequenceNumber: 1,
    name: "V1",
    labels: [],
    sourceType: "folder" as const,
    sourceName: "invoice-skill",
    frozenAt: "2026-07-24T10:00:00.000Z",
    isComparisonBaseline: true,
    snapshot: {
      id: "01900000-0000-7000-8000-000000000003",
      manifestHash: "a".repeat(64),
      fileCount: 12,
      totalBytes: 4096,
    },
  },
}))

vi.mock(
  "@/features/workbench-home/hooks/use-workbench-home-controller",
  async () => {
    const { createEmptyWorkbenchDraft } = await import(
      "@/features/workbench-home/model/workbench"
    )
    const { getWorkbenchHomeCopy } = await import(
      "@/features/workbench-home/model/workbench-home-copy"
    )
    const { i18n: testI18n } = await import("@/shared/i18n/i18n")
    const copy = getWorkbenchHomeCopy(
      testI18n.getFixedT("zh-CN", "workbenchHome"),
    )

    return {
      useWorkbenchHomeController: () => ({
        locale: "zh-CN",
        copy,
        workspaces: [workspace],
        activeWorkspace: null,
        workspaceList: {
          loading: false,
          error: false,
        },
        createDialog: {
          open: false,
          draft: createEmptyWorkbenchDraft(),
          errors: {},
          submitting: false,
          folderPolicyStatus: "ready",
        },
        actions: {
          changeLocale: vi.fn(),
          openCreateDialog: vi.fn(),
          closeCreateDialog: vi.fn(),
          updateWorkbenchName: vi.fn(),
          updateSourceKind: vi.fn(),
          selectSource: vi.fn(),
          createWorkspace: vi.fn(async () => null),
          retryWorkspaceList: vi.fn(),
        },
      }),
    }
  },
)

vi.mock(
  "@/features/version-browser/components/version-browser-view",
  () => ({
    VersionBrowserView: ({
      selectedVersionId,
    }: {
      selectedVersionId: string | null
    }) => (
      <main>
        版本浏览器
        <span>
          {selectedVersionId ? `指定版本 ${selectedVersionId}` : "活动草稿"}
        </span>
      </main>
    ),
  }),
)

vi.mock("@/features/evals/components/evals-workbench-view", () => ({
  EvalsWorkbenchView: () => (
    <main>
      <h1>测试用例生成工作台</h1>
    </main>
  ),
}))

vi.mock(
  "@/features/test-runs/components/test-runs-workbench-view",
  () => ({
    TestRunsWorkbenchView: () => (
      <main>
        <h1>测试任务工作台</h1>
      </main>
    ),
  }),
)

vi.mock(
  "@/features/test-runs/components/test-run-detail-view",
  () => ({
    TestRunDetailView: ({ runId }: { runId: string }) => (
      <main>测试任务详情 {runId}</main>
    ),
  }),
)

vi.mock(
  "@/features/test-reports/components/test-reports-workbench-view",
  () => ({
    TestReportsWorkbenchView: () => (
      <main>
        <h1>测试报告工作台</h1>
      </main>
    ),
  }),
)

vi.mock(
  "@/features/test-reports/components/test-report-detail-view",
  () => ({
    TestReportDetailView: ({ reportId }: { reportId: string }) => (
      <main>静态报告详情 {reportId}</main>
    ),
    TestReportByRunRedirect: ({ runId }: { runId: string }) => (
      <main>按任务查找报告 {runId}</main>
    ),
  }),
)

function renderRoute(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage("zh-CN")
})

describe("workspace routes", () => {
  it("opens the workspace overview at the workspace root", () => {
    renderRoute(`/workbenches/${workspace.id}`)

    expect(
      screen.getByRole("heading", { name: workspace.name }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "工作台概览" }),
    ).toHaveAttribute("aria-current", "page")
    expect(screen.queryByText("版本浏览器")).not.toBeInTheDocument()
  })

  it.each([
    [`/workbenches/${workspace.id}/versions`, "活动草稿"],
    [
      `/workbenches/${workspace.id}/versions/${workspace.onlineVersion.id}`,
      `指定版本 ${workspace.onlineVersion.id}`,
    ],
  ])("opens the versions module directly at %s", (path, targetLabel) => {
    renderRoute(path)

    expect(screen.getByText("版本浏览器")).toBeInTheDocument()
    expect(screen.getByText(targetLabel)).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Skill 版本" }),
    ).toHaveAttribute("aria-current", "page")
  })

  it("renders the datasets placeholder without fake actions", () => {
    renderRoute(`/workbenches/${workspace.id}/datasets`)

    const main = screen.getByRole("main")
    expect(
      within(main).getByRole("heading", { name: "数据集" }),
    ).toBeInTheDocument()
    expect(
      within(main).getByText("将在后续迭代实现"),
    ).toBeInTheDocument()
    expect(within(main).queryByRole("button")).not.toBeInTheDocument()
  })

  it.each([
    ["runs", "测试任务工作台"],
    ["reports", "测试报告工作台"],
  ])("opens the implemented %s module", (path, title) => {
    renderRoute(`/workbenches/${workspace.id}/${path}`)

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument()
  })

  it.each([
    ["runs/run-1", "测试任务详情 run-1"],
    ["reports/report-1", "静态报告详情 report-1"],
    ["reports/by-run/run-1", "按任务查找报告 run-1"],
  ])("routes %s to its concrete detail view", (path, text) => {
    renderRoute(`/workbenches/${workspace.id}/${path}`)

    expect(screen.getByRole("main")).toHaveTextContent(text)
  })

  it("opens the Evals generation workbench from test cases", () => {
    renderRoute(`/workbenches/${workspace.id}/test-cases`)

    expect(
      screen.getByRole("heading", { name: "测试用例生成工作台" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "测试用例" }),
    ).toHaveAttribute("aria-current", "page")
  })

  it.each(["runtime", "unknown-module"])(
    "redirects %s to the workspace overview",
    async (path) => {
      renderRoute(`/workbenches/${workspace.id}/${path}`)

      expect(
        await screen.findByRole("heading", { name: workspace.name }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole("link", { name: "工作台概览" }),
      ).toHaveAttribute("aria-current", "page")
    },
  )

  it("persists the collapsed sidebar and keeps accessible navigation", async () => {
    const user = userEvent.setup()
    renderRoute(`/workbenches/${workspace.id}`)

    const collapseButton = screen.getByRole("button", {
      name: "收起工作台侧栏",
    })
    expect(collapseButton).toHaveAttribute("aria-expanded", "true")

    await user.click(collapseButton)

    const expandButton = screen.getByRole("button", {
      name: "展开工作台侧栏",
    })
    expect(expandButton).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.getByRole("link", { name: "Skill 版本" }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        localStorage.getItem(
          "skillconsole:workspace-navigation-collapsed",
        ),
      ).toBe("true")
    })
  })
})
