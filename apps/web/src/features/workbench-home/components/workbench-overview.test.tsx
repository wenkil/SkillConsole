import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { WorkbenchOverview } from "@/features/workbench-home/components/workbench-overview"
import { getWorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { i18n } from "@/shared/i18n/i18n"

const copy = getWorkbenchHomeCopy(
  i18n.getFixedT("zh-CN", "workbenchHome"),
)
const englishCopy = getWorkbenchHomeCopy(
  i18n.getFixedT("en", "workbenchHome"),
)

const workspace = {
  id: "01900000-0000-7000-8000-000000000001",
  name: "发票审核 Skill",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  activeDraft: null,
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
}

function renderOverview(locale: string, overviewCopy = copy) {
  return render(
    <MemoryRouter>
      <WorkbenchOverview
        copy={overviewCopy}
        locale={locale}
        workspace={workspace}
      />
    </MemoryRouter>,
  )
}

describe("WorkbenchOverview", () => {
  it("shows user-managed online and version facts without system approval", async () => {
    await i18n.changeLanguage("zh-CN")
    renderOverview("zh-CN")

    expect(
      screen.getByRole("heading", { name: "发票审核 Skill" }),
    ).toBeInTheDocument()
    expect(screen.getByText("当前上线 · V1")).toBeInTheDocument()
    expect(screen.getByText("当前上线版本")).toBeInTheDocument()
    expect(screen.getByText("已保存版本")).toBeInTheDocument()
    expect(screen.getAllByText(/TODO/).length).toBeGreaterThan(0)
    expect(screen.queryByText("已通过")).not.toBeInTheDocument()
    expect(screen.queryByText(/sha256:/)).not.toBeInTheDocument()
  })

  it("renders static overview copy in English when the locale is English", async () => {
    await i18n.changeLanguage("en")
    renderOverview("en", englishCopy)

    expect(screen.getByText("Workbench overview")).toBeInTheDocument()
    expect(screen.getByText("Published · V1")).toBeInTheDocument()
    expect(screen.getByText("Current published version")).toBeInTheDocument()
    expect(screen.getByText("Evidence workspace")).toBeInTheDocument()
    expect(screen.getByText("Test cases")).toBeInTheDocument()
    expect(screen.queryByText("当前上线版本")).not.toBeInTheDocument()
    expect(screen.queryByText("测试用例")).not.toBeInTheDocument()
  })
})
