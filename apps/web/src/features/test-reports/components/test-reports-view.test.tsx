import { render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TestReportsWorkbenchView } from "@/features/test-reports/components/test-reports-workbench-view"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { i18n } from "@/shared/i18n/i18n"

vi.mock(
  "@/features/test-reports/components/skill-score-reports-panel",
  () => ({
    SkillScoreReportsPanel: () => <section>AI 分析报告列表</section>,
  }),
)

const workspace = {
  id: "01900000-0000-7000-8000-000000000001",
  name: "Invoice Skill",
} as SkillWorkspace

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

describe("test report workbench", () => {
  it("shows only the AI analysis report list", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <TestReportsWorkbenchView locale="zh-CN" workspace={workspace} />
        </MemoryRouter>
      </I18nextProvider>,
    )

    expect(
      screen.getByRole("heading", { name: "AI 分析报告" }),
    ).toBeInTheDocument()
    expect(screen.getByText("AI 分析报告列表")).toBeInTheDocument()
  })
})
