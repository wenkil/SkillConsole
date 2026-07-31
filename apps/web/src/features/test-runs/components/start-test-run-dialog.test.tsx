import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StartTestRunDialog } from "@/features/test-runs/components/start-test-run-dialog"
import type { EvalRevision } from "@/features/evals/model/evals"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
import { i18n } from "@/shared/i18n/i18n"

const version: SkillVersionBrowser = {
  id: "01900000-0000-7000-8000-000000000001",
  sequenceNumber: 2,
  name: "V2",
  description: null,
  labels: [],
  sourceType: "folder",
  sourceName: "sample-skill",
  createdAt: "2026-07-31T00:00:00.000Z",
  frozenAt: "2026-07-31T00:00:00.000Z",
  isOnline: true,
  isComparisonBaseline: false,
  snapshot: {
    id: "01900000-0000-7000-8000-000000000002",
    state: "READY",
    manifestHash: "a".repeat(64),
    fileCount: 1,
    totalBytes: 100,
    createdAt: "2026-07-31T00:00:00.000Z",
  },
}

const revision: EvalRevision = {
  id: "01900000-0000-7000-8000-000000000003",
  suiteId: "01900000-0000-7000-8000-000000000004",
  sequenceNumber: 3,
  skillName: "sample-skill",
  sourceGenerationTaskId: "01900000-0000-7000-8000-000000000005",
  sourceSnapshotId: version.snapshot.id,
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
        onOpenChange={vi.fn()}
        onRevisionChange={vi.fn()}
        onStart={onStart}
        onVersionChange={vi.fn()}
        open
        pending={false}
        revisions={[revision]}
        selectedRevision={revision}
        selectedRevisionId={revision.id}
        selectedVersion={version}
        selectedVersionId={version.id}
        t={i18n.getFixedT("zh-CN", "testRuns")}
        versions={[version]}
      />,
    )

    const start = screen.getByRole("button", { name: "启动测试运行" })
    expect(start).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", { name: /我确认使用 EVALS R3/ }),
    )
    expect(start).toBeEnabled()
    await user.click(start)
    expect(onStart).toHaveBeenCalledOnce()
  })
})
