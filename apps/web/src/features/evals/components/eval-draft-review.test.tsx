import { render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { describe, expect, it } from "vitest"

import { EvalGenerationProgress } from "@/features/evals/components/eval-draft-review"
import type { EvalGenerationTask } from "@/features/evals/model/evals"
import { i18n } from "@/shared/i18n/i18n"

const succeededTask: EvalGenerationTask = {
  id: "01900000-0000-7000-8000-000000000001",
  suiteId: "01900000-0000-7000-8000-000000000002",
  workspaceId: "01900000-0000-7000-8000-000000000003",
  status: "SUCCEEDED",
  target: {
    sourceKind: "DRAFT_REVISION",
    snapshotId: "01900000-0000-7000-8000-000000000004",
    versionId: null,
    draftRevisionId: "01900000-0000-7000-8000-000000000005",
    skillName: "csv-to-md",
    displayVersion: "R1",
  },
  maxEvalCount: 5,
  generationBrief: null,
  error: null,
  usage: null,
  draftId: "01900000-0000-7000-8000-000000000006",
  draftStatus: "PUBLISHED",
  evalCount: 5,
  fileCount: 5,
  revisionNumber: 1,
  createdAt: "2026-07-30T08:00:00.000Z",
  updatedAt: "2026-07-30T08:02:00.000Z",
  startedAt: "2026-07-30T08:00:10.000Z",
  completedAt: "2026-07-30T08:02:00.000Z",
}

describe("EvalGenerationProgress", () => {
  it("marks the final generation step as completed", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <EvalGenerationProgress
          events={[]}
          t={i18n.getFixedT("zh-CN", "evals")}
          task={succeededTask}
        />
      </I18nextProvider>,
    )

    expect(screen.getByText("生成成功")).toBeInTheDocument()
    expect(container.querySelector("ol .animate-spin")).toBeNull()
  })

  it("shows localized failure text without rendering the internal error code", () => {
    const failedTask: EvalGenerationTask = {
      ...succeededTask,
      status: "FAILED",
      error: {
        code: "EVAL_OUTPUT_ROOT_INVALID",
        message: "internal error message",
        details: null,
      },
      draftId: null,
      draftStatus: null,
    }
    render(
      <I18nextProvider i18n={i18n}>
        <EvalGenerationProgress
          events={[]}
          failureSummary={{
            evalsJsonState: "ROOT_INVALID",
            evalCount: null,
            incompleteCaseIndexes: [],
            ignoredFiles: [],
          }}
          t={i18n.getFixedT("zh-CN", "evals")}
          task={failedTask}
        />
      </I18nextProvider>,
    )

    expect(screen.getByText("生成结果中没有可用的测试用例列表。")).toBeInTheDocument()
    expect(screen.queryByText("EVAL_OUTPUT_ROOT_INVALID")).toBeNull()
  })
})
