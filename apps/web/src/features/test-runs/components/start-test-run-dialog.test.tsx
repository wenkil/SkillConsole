import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { StartTestRunDialog } from "@/features/test-runs/components/start-test-run-dialog"
import type { EvalRevision } from "@/features/evals/model/evals"
import type { TestRunMode } from "@/features/test-runs/model/test-run"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
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

function createVersion(
  sequenceNumber: number,
  input: Partial<SkillVersionBrowser> = {},
): SkillVersionBrowser {
  return {
    id: `01900000-0000-7000-8000-0000000000${sequenceNumber + 10}`,
    sequenceNumber,
    name: `Version ${sequenceNumber}`,
    description: null,
    labels: [],
    sourceType: "folder",
    sourceName: "sample-skill",
    createdAt: `2026-07-${String(sequenceNumber).padStart(2, "0")}T00:00:00.000Z`,
    frozenAt: `2026-07-${String(sequenceNumber).padStart(2, "0")}T00:00:00.000Z`,
    isOnline: sequenceNumber === 2,
    isComparisonBaseline: sequenceNumber === 1,
    snapshot: {
      id: `01900000-0000-7000-8000-0000000001${sequenceNumber + 10}`,
      state: "READY",
      manifestHash: String(sequenceNumber).repeat(64),
      fileCount: 1,
      totalBytes: 100,
      createdAt: `2026-07-${String(sequenceNumber).padStart(2, "0")}T00:00:00.000Z`,
    },
    ...input,
  }
}

const baselineVersion = createVersion(1)
const candidateVersion = createVersion(2)

function renderDialog(input?: {
  mode?: TestRunMode
  draft?: SkillDraftSummary | null
  versions?: readonly SkillVersionBrowser[]
  baselineVersion?: SkillVersionBrowser | null
  candidateVersion?: SkillVersionBrowser | null
  onStart?: () => Promise<unknown>
  onModeChange?: (mode: TestRunMode) => void
}) {
  const versions = input?.versions ?? [baselineVersion, candidateVersion]
  return render(
    <StartTestRunDialog
      baselineVersion={input?.baselineVersion ?? baselineVersion}
      baselineVersionId={
        (input?.baselineVersion ?? baselineVersion)?.id ?? ""
      }
      blocked={false}
      candidateVersion={input?.candidateVersion ?? candidateVersion}
      candidateVersionId={
        (input?.candidateVersion ?? candidateVersion)?.id ?? ""
      }
      draft={input?.draft === undefined ? draft : input.draft}
      mode={input?.mode ?? "target_vs_no_skill"}
      onBaselineVersionChange={vi.fn()}
      onCandidateVersionChange={vi.fn()}
      onModeChange={input?.onModeChange ?? vi.fn()}
      onOpenChange={vi.fn()}
      onRevisionChange={vi.fn()}
      onStart={input?.onStart ?? vi.fn(async () => undefined)}
      open
      pending={false}
      revisions={[revision]}
      selectedRevision={revision}
      selectedRevisionId={revision.id}
      t={i18n.getFixedT("zh-CN", "testRuns")}
      versions={versions}
      versionsError={false}
      versionsLoading={false}
    />,
  )
}

describe("StartTestRunDialog", () => {
  it("requires explicit confirmation for the existing Skill effect mode", async () => {
    const user = userEvent.setup()
    const onStart = vi.fn(async () => undefined)
    renderDialog({ onStart })

    const start = screen.getByRole("button", {
      name: "启动 Skill 效果测试",
    })
    expect(start).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", {
        name: /我确认冻结当前工作副本/,
      }),
    )
    expect(start).toBeEnabled()
    await user.click(start)
    expect(onStart).toHaveBeenCalledOnce()
  })

  it("blocks only the Skill effect mode when no working copy exists", () => {
    renderDialog({ draft: null })

    expect(screen.getByText("当前没有可测试的工作副本")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "启动 Skill 效果测试" }),
    ).toBeDisabled()
    expect(
      screen.getByRole("radio", { name: /版本对比测试/ }),
    ).toBeEnabled()
  })

  it("disables version comparison when fewer than two READY versions exist", () => {
    renderDialog({ versions: [baselineVersion] })

    expect(
      screen.getByRole("radio", { name: /版本对比测试/ }),
    ).toBeDisabled()
    expect(
      screen.getByText("至少需要两个 READY 状态的已保存版本。"),
    ).toBeInTheDocument()
  })

  it("shows the paired execution summary and starts a confirmed comparison", async () => {
    const user = userEvent.setup()
    const onStart = vi.fn(async () => undefined)
    renderDialog({ mode: "version_vs_version", onStart })

    expect(
      screen.getByText("8 个执行 Case + 8 个评分会话"),
    ).toBeInTheDocument()
    expect(screen.getByText("理论上限 US$16.00")).toBeInTheDocument()
    const start = screen.getByRole("button", {
      name: "启动版本对比测试",
    })
    expect(start).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", {
        name: /我确认使用 R2 · Version 2 与 R1 · Version 1/,
      }),
    )
    expect(start).toBeEnabled()
    await user.click(start)
    expect(onStart).toHaveBeenCalledOnce()
  })
})
