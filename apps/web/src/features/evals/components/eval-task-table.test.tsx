import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { EvalTaskTable } from "@/features/evals/components/eval-task-table"
import type { EvalGenerationTask } from "@/features/evals/model/evals"
import { i18n } from "@/shared/i18n/i18n"

const savedTask: EvalGenerationTask = {
  id: "01900000-0000-7000-8000-000000000001",
  suiteId: "01900000-0000-7000-8000-000000000002",
  workspaceId: "01900000-0000-7000-8000-000000000003",
  status: "SUCCEEDED",
  target: {
    sourceKind: "SKILL_VERSION",
    snapshotId: "01900000-0000-7000-8000-000000000004",
    versionId: "01900000-0000-7000-8000-000000000005",
    draftRevisionId: null,
    skillName: "csv-to-md",
    displayVersion: "V2",
  },
  maxEvalCount: 5,
  generationBrief: null,
  error: null,
  usage: null,
  draftId: "01900000-0000-7000-8000-000000000006",
  draftStatus: "PUBLISHED",
  evalCount: 5,
  fileCount: 3,
  revisionNumber: 2,
  attemptCount: 1,
  currentAttempt: {
    id: "01900000-0000-7000-8000-000000000007",
    attemptNumber: 1,
    status: "SUCCEEDED",
    error: null,
    usage: null,
    createdAt: "2026-07-30T08:00:00.000Z",
    startedAt: "2026-07-30T08:00:10.000Z",
    completedAt: "2026-07-30T08:02:00.000Z",
  },
  attempts: [
    {
      id: "01900000-0000-7000-8000-000000000007",
      attemptNumber: 1,
      status: "SUCCEEDED",
      error: null,
      usage: null,
      createdAt: "2026-07-30T08:00:00.000Z",
      startedAt: "2026-07-30T08:00:10.000Z",
      completedAt: "2026-07-30T08:02:00.000Z",
    },
  ],
  createdAt: "2026-07-30T08:00:00.000Z",
  updatedAt: "2026-07-30T08:02:00.000Z",
  startedAt: "2026-07-30T08:00:10.000Z",
  completedAt: "2026-07-30T08:02:00.000Z",
}

describe("EvalTaskTable", () => {
  it("shows the Skill version and saved review state", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()

    render(
      <EvalTaskTable
        locale="zh-CN"
        onGenerate={vi.fn()}
        onOpen={onOpen}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        page={1}
        pageCount={1}
        pageSize={20}
        t={i18n.getFixedT("zh-CN", "evals")}
        tasks={[savedTask]}
        total={1}
      />,
    )

    expect(screen.getByRole("columnheader", { name: "Skill 版本" })).toBeInTheDocument()
    expect(screen.getByText("V2")).toBeInTheDocument()
    expect(screen.getByText("已保存")).toBeInTheDocument()
    expect(screen.queryByText("csv-to-md")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "查看详情" }))
    expect(onOpen).toHaveBeenCalledWith(savedTask.id)
  })
})
