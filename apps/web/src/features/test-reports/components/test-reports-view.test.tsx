import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TestReportDetailView } from "@/features/test-reports/components/test-report-detail-view"
import { TestReportsWorkbenchView } from "@/features/test-reports/components/test-reports-workbench-view"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { i18n } from "@/shared/i18n/i18n"

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  regenerate: vi.fn(),
  analyzerController: vi.fn(),
  createAnalysis: vi.fn(),
  selectAnalysis: vi.fn(),
  toggleAnalysisCase: vi.fn(),
  selectDefaultAnalysisCases: vi.fn(),
  selectAllAnalysisCases: vi.fn(),
  clearAnalysisCases: vi.fn(),
  retryAnalysisLogs: vi.fn(),
  loadEarlierAnalysisLogs: vi.fn(),
}))

vi.mock(
  "@/features/test-reports/components/skill-score-reports-panel",
  () => ({
    SkillScoreReportsPanel: () => <section>AI 分析报告列表</section>,
  }),
)

const analysisCases = [
  {
    evalRevisionCaseId: "01900000-0000-7000-8000-000000000020",
    externalId: 1,
    name: "Invoice with table",
    issueIds: ["ISSUE-1"],
  },
  {
    evalRevisionCaseId: "01900000-0000-7000-8000-000000000021",
    externalId: 2,
    name: "Plain invoice",
    issueIds: [],
  },
] as const

const report = {
  id: "01900000-0000-7000-8000-000000000010",
  workspaceId: "01900000-0000-7000-8000-000000000001",
  runId: "01900000-0000-7000-8000-000000000011",
  reportType: "version_comparison" as const,
  status: "PARTIAL" as const,
  runStatus: "CANCELED" as const,
  comparabilityStatus: "COMPARABLE_WITH_LIMITATIONS" as const,
  analysisStatus: "NOT_REQUESTED" as const,
  targetLabel: "Candidate R2",
  baselineLabel: "Baseline R1",
  evalRevisionId: "01900000-0000-7000-8000-000000000012",
  evalRevisionNumber: 3,
  evalCount: 4,
  issueCount: 2,
  negativeTransitionCount: 1,
  positiveTransitionCount: 1,
  primaryPassRate: 0.75,
  assessmentCoverageRate: 0.5,
  executionCostUsd: 0.04,
  gradingCostUsd: 0.01,
  totalCostUsd: 0.05,
  wallClockDurationMs: 20_000,
  completedAt: "2026-08-13T08:00:00.000Z",
  createdAt: "2026-08-13T07:59:00.000Z",
  updatedAt: "2026-08-13T08:00:01.000Z",
}

const workspace = {
  id: report.workspaceId,
  name: "Invoice Skill",
} as SkillWorkspace

vi.mock(
  "@/features/test-reports/hooks/use-test-reports-controller",
  () => ({
    useTestReportDetailController: () => ({
      report: {
        ...report,
        currentRevisionId: "01900000-0000-7000-8000-000000000013",
        generationError: null,
        report: {
          title: "Candidate R2 vs Baseline R1",
          reportRevisionNumber: 1,
          generatedAt: "2026-08-13T08:00:01.000Z",
          schemaVersion: "test-report.v1",
          generatorVersion: "test-report-generator-v1",
          cases: analysisCases,
        },
      },
      loading: false,
      error: false,
      regenerating: false,
      mutationError: null,
      actions: { retry: mocks.retry, regenerate: mocks.regenerate },
    }),
    useTestReportAnalyzerController: mocks.analyzerController,
    useTestReportByRun: vi.fn(),
  }),
)

function wrapper(children: React.ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{children}</MemoryRouter>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.createAnalysis.mockResolvedValue({})
  mocks.analyzerController.mockReturnValue({
    analyses: [],
    selectedAnalysis: null,
    selectedAnalysisId: null,
    selectableCases: analysisCases,
    selectedCaseIds: [analysisCases[0].evalRevisionCaseId],
    loading: false,
    detailLoading: false,
    error: false,
    creating: false,
    analysisActive: false,
    logEvents: [],
    logsLoading: false,
    logsError: false,
    logConnectionError: false,
    hasEarlierLogs: false,
    loadingEarlierLogs: false,
    mutationError: null,
    actions: {
      retry: mocks.retry,
      selectAnalysis: mocks.selectAnalysis,
      toggleCase: mocks.toggleAnalysisCase,
      selectDefaultCases: mocks.selectDefaultAnalysisCases,
      selectAllCases: mocks.selectAllAnalysisCases,
      clearCases: mocks.clearAnalysisCases,
      create: mocks.createAnalysis,
      retryLogs: mocks.retryAnalysisLogs,
      loadEarlierLogs: mocks.loadEarlierAnalysisLogs,
    },
  })
  await i18n.changeLanguage("zh-CN")
})

describe("test report views", () => {
  it("shows only the AI analysis report list on the report workbench", () => {
    wrapper(<TestReportsWorkbenchView locale="zh-CN" workspace={workspace} />)

    expect(
      screen.getByRole("heading", { name: "AI 分析报告" }),
    ).toBeInTheDocument()
    expect(screen.getByText("AI 分析报告列表")).toBeInTheDocument()
    expect(screen.queryByText("确定性测试报告")).not.toBeInTheDocument()
  })

  it("shows the selected Revision in a sandboxed HTML frame with only HTML and Markdown downloads", () => {
    wrapper(
      <TestReportDetailView
        locale="zh-CN"
        reportId={report.id}
        workspace={workspace}
      />,
    )

    const frame = screen.getByTitle("静态测试报告")
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-top-navigation-by-user-activation",
    )
    expect(frame).toHaveAttribute(
      "src",
      expect.stringContaining("document.html?locale=zh-CN"),
    )
    expect(
      screen.getByRole("link", { name: /下载 HTML/ }),
    ).toHaveAttribute("href", expect.stringContaining("download=true"))
    expect(
      screen.getByRole("link", { name: /下载 Markdown/ }),
    ).toHaveAttribute("href", expect.stringContaining("document.md"))
    expect(screen.queryByText(/JSON 导出/)).not.toBeInTheDocument()
  })

  it("keeps Analyzer opt-in and defaults its selection to Cases with issues", async () => {
    const user = userEvent.setup()
    wrapper(
      <TestReportDetailView
        locale="zh-CN"
        reportId={report.id}
        workspace={workspace}
      />,
    )

    await user.click(screen.getByRole("tab", { name: /AI 分析/ }))
    const cases = screen.getAllByRole("checkbox")
    expect(cases).toHaveLength(2)
    expect(cases[0]).toBeChecked()
    expect(cases[1]).not.toBeChecked()
    await user.click(screen.getByRole("button", { name: "生成 AI 分析" }))
    expect(mocks.createAnalysis).toHaveBeenCalledOnce()
  })

  it("previews an immutable Analysis Revision and downloads it with its fact Report Revision", async () => {
    const user = userEvent.setup()
    const analysis = {
      id: "01900000-0000-7000-8000-000000000030",
      reportId: report.id,
      reportRevisionId: "01900000-0000-7000-8000-000000000013",
      revisionNumber: 2,
      status: "AVAILABLE",
      selectedEvalRevisionCaseIds: [analysisCases[0].evalRevisionCaseId],
      modelId: "claude-sonnet",
      configuredModelId: "claude-sonnet-configured",
      actualModelId: "claude-sonnet",
      semanticConfigurationFingerprint: "d".repeat(64),
      promptVersion: "test-report-analyzer-v1",
      inputFingerprint: "a".repeat(64),
      runtimePolicy: {
        schemaVersion: "test-report-analyzer-runtime-policy.v4",
        timeoutMs: 1_800_000,
        cancellationGraceMs: 1_000,
        capabilitySource: "project_settings",
        promptControlledFileAccess: true,
        maxInputCharacters: 100_000,
      },
      runtimePolicyFingerprint: "c".repeat(64),
      analysis: {
        schemaVersion: "test-report-analysis.v1",
        summary: "Investigate the Eval assertion.",
        findings: [],
        priorityOrder: [],
        limitations: [],
      },
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0.004,
        durationMs: 1_200,
        durationApiMs: 1_000,
        numTurns: 1,
      },
      error: null,
      createdAt: "2026-08-13T08:01:00.000Z",
      startedAt: "2026-08-13T08:01:01.000Z",
      completedAt: "2026-08-13T08:01:02.000Z",
    }
    mocks.analyzerController.mockReturnValue({
      ...mocks.analyzerController(),
      analyses: [analysis],
      selectedAnalysis: analysis,
      selectedAnalysisId: analysis.id,
    })
    wrapper(
      <TestReportDetailView
        locale="zh-CN"
        reportId={report.id}
        workspace={workspace}
      />,
    )

    await user.click(screen.getByRole("tab", { name: /AI 分析/ }))
    expect(screen.getByText(/claude-sonnet/)).toBeInTheDocument()
    expect(screen.getByText(/claude-sonnet-configured/)).toBeInTheDocument()
    expect(
      screen.getByText(/test-report-analyzer-runtime-policy\.v2/),
    ).toHaveTextContent(/settings\.json.*\$0\.50.*240\.0 s/)
    const frame = screen.getByTitle("AI 分析 Revision 2")
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-top-navigation-by-user-activation",
    )
    expect(frame).toHaveAttribute(
      "src",
      expect.stringContaining(
        `/api/test-report-analyses/${analysis.id}/document.html?locale=zh-CN`,
      ),
    )
    expect(
      screen.getByRole("link", { name: /下载完整 HTML/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        `/api/test-report-analyses/${analysis.id}/document.full.html?locale=zh-CN&download=true`,
      ),
    )
    expect(
      screen.getByRole("link", { name: /下载分析 Markdown/ }),
    ).toHaveAttribute("href", expect.stringContaining("document.md"))
    expect(screen.queryByRole("link", { name: /JSON/ })).not.toBeInTheDocument()
  })
})
