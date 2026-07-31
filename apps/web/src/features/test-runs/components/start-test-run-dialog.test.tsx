import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StartTestRunDialog } from "@/features/test-runs/components/start-test-run-dialog"
import type { EvalRevision } from "@/features/evals/model/evals"
import type { SkillDraftSummary } from "@/features/workbench-home/model/workbench"
import { i18n } from "@/shared/i18n/i18n"

const draft: SkillDraftSummary = {
  id: "01900000-0000-7000-8000-000000000001",
  contentRevision: 2,
  status: "OPEN",
  sourceType: "folder",
  sourceName: "sample-skill",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  workingCopy: {
    fileCount: 1,
    totalBytes: 100,
  },
}

const revision: EvalRevision = {
  id: "01900000-0000-7000-8000-000000000003",
  suiteId: "01900000-0000-7000-8000-000000000004",
  sequenceNumber: 3,
  skillName: "sample-skill",
  sourceGenerationTaskId: "01900000-0000-7000-8000-000000000005",
  sourceSnapshotId: "01900000-0000-7000-8000-000000000002",
  manifestHash: "b".repeat(64),
  rawEvalsSha256: "c".repeat(64),
  evalCount: 4,
  fileCount: 1,
  totalBytes: 200,
  createdAt: "2026-07-31T00:00:00.000Z",
}

describe("StartTestRunDialog", () => {
  it("requires explicit confirmation even when a published revision is preselected", async () => {
    const user = userEvent.setup()
    const onStart = vi.fn(async () => undefined)
    render(
      <StartTestRunDialog
        blocked={false}
        draft={draft}
        onOpenChange={vi.fn()}
        onRevisionChange={vi.fn()}
        onStart={onStart}
        open
        pending={false}
        revisions={[revision]}
        selectedRevision={revision}
        selectedRevisionId={revision.id}
        t={i18n.getFixedT("zh-CN", "testRuns")}
      />,
    )

    const start = screen.getByRole("button", { name: "启动测试运行" })
    expect(start).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", { name: /我确认冻结当前工作副本/ }),
    )
    expect(start).toBeEnabled()
    await user.click(start)
    expect(onStart).toHaveBeenCalledOnce()
  })

  it("blocks starting when the workbench has no active draft", () => {
    render(
      <StartTestRunDialog
        blocked={false}
        draft={null}
        onOpenChange={vi.fn()}
        onRevisionChange={vi.fn()}
        onStart={vi.fn()}
        open
        pending={false}
        revisions={[revision]}
        selectedRevision={revision}
        selectedRevisionId={revision.id}
        t={i18n.getFixedT("zh-CN", "testRuns")}
      />,
    )

    expect(screen.getByText("当前没有可测试的工作副本")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "启动测试运行" }),
    ).toBeDisabled()
  })
})
