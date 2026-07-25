import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { WorkbenchOverview } from "@/features/workbench-home/components/workbench-overview"
import { getWorkbenchHomeCopy } from "@/features/workbench-home/model/workbench-home-copy"
import { i18n } from "@/shared/i18n/i18n"

const copy = getWorkbenchHomeCopy(
  i18n.getFixedT("zh-CN", "common"),
  i18n.getFixedT("zh-CN", "workbenchHome"),
)

describe("WorkbenchOverview", () => {
  it("shows immutable V1 facts without presenting the baseline as passed", () => {
    render(
      <WorkbenchOverview
        copy={copy}
        locale="zh-CN"
        onBack={vi.fn()}
        workspace={{
          id: "01900000-0000-7000-8000-000000000001",
          name: "发票审核 Skill",
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T10:00:00.000Z",
          currentVersion: {
            id: "01900000-0000-7000-8000-000000000002",
            versionNumber: 1,
            sourceType: "folder",
            sourceName: "invoice-skill",
            publishedAt: "2026-07-24T10:00:00.000Z",
            isDefaultBaseline: true,
            snapshot: {
              id: "01900000-0000-7000-8000-000000000003",
              manifestHash: "a".repeat(64),
              fileCount: 12,
              totalBytes: 4096,
            },
          },
        }}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "发票审核 Skill" }),
    ).toBeInTheDocument()
    expect(screen.getByText("V1 · 默认基线")).toBeInTheDocument()
    expect(screen.getAllByText("尚未测试").length).toBeGreaterThan(0)
    expect(screen.queryByText("已通过")).not.toBeInTheDocument()
    expect(screen.getByText(/sha256:aaaa/)).toHaveAttribute(
      "title",
      "a".repeat(64),
    )
  })
})
