import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter, useSearchParams } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SkillScoreReportsPanel } from "@/features/test-reports/components/skill-score-reports-panel"
import { i18n } from "@/shared/i18n/i18n"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  listEvents: vi.fn(),
}))

vi.mock("@/features/test-reports/api/skill-score-reports-api", () => ({
  getSkillScoreReport: mocks.get,
  listSkillScoreReports: mocks.list,
  listSkillScoreReportEvents: mocks.listEvents,
}))

const report = {
  id: "01900000-0000-7000-8000-000000000010",
  runId: "01900000-0000-7000-8000-000000000011",
  workspaceId: "01900000-0000-7000-8000-000000000001",
  status: "AVAILABLE" as const,
  documentUrl: "/api/skill-score-reports/019/document.html",
  error: null,
  createdAt: "2026-08-20T12:20:00.000Z",
  startedAt: "2026-08-20T12:20:01.000Z",
  completedAt: "2026-08-20T12:20:02.000Z",
}

function PanelRoute() {
  const [searchParams] = useSearchParams()
  return (
    <SkillScoreReportsPanel
      initialReportId={searchParams.get("reportId")}
      locale="zh-CN"
      workspaceId={report.workspaceId}
    />
  )
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/reports?tab=ai-score"]}>
          <PanelRoute />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({
    items: [report],
    pagination: { page: 1, pageCount: 1 },
  })
  mocks.get.mockResolvedValue(report)
  mocks.listEvents.mockResolvedValue({
    items: [],
    pagination: { hasMore: false, nextBeforeSequence: null },
  })
  await i18n.changeLanguage("zh-CN")
})

describe("SkillScoreReportsPanel", () => {
  it("keeps HTML out of the list and opens a full-width detail through the reportId deep link", async () => {
    const user = userEvent.setup()
    wrapper()

    const viewDetail = await screen.findByRole("button", {
      name: `查看详情: ${report.runId}`,
    })
    expect(screen.queryByTitle("AI 评分报告")).not.toBeInTheDocument()

    await user.click(viewDetail)

    expect(
      await screen.findByRole("button", { name: "返回 AI 评分报告" }),
    ).toBeInTheDocument()
    expect(await screen.findByTitle("AI 评分报告")).toHaveAttribute(
      "src",
      report.documentUrl,
    )
    expect(screen.getByRole("heading", { name: "生成进度" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "返回 AI 评分报告" }))

    expect(
      await screen.findByRole("button", {
        name: `查看详情: ${report.runId}`,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByTitle("AI 评分报告")).not.toBeInTheDocument()
  })
})
