import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useTestReportAnalyzerController } from "@/features/test-reports/hooks/use-test-reports-controller"
import type {
  TestReportAnalysis,
  TestReportDetail,
} from "@/features/test-reports/model/test-report"

const api = vi.hoisted(() => ({
  createTestReportAnalysis: vi.fn(),
  getTestReport: vi.fn(),
  getTestReportAnalysis: vi.fn(),
  getTestReportByRun: vi.fn(),
  listTestReportAnalyses: vi.fn(),
  listTestReportAnalysisLogs: vi.fn(),
  listTestReports: vi.fn(),
  regenerateTestReport: vi.fn(),
  subscribeToTestReportAnalysis: vi.fn(() => () => undefined),
}))

vi.mock("@/features/test-reports/api/test-reports-api", () => api)

const reportAId = "01900000-0000-7000-8000-000000000101"
const reportBId = "01900000-0000-7000-8000-000000000102"
const analysisAId = "01900000-0000-7000-8000-000000000201"
const analysisBId = "01900000-0000-7000-8000-000000000202"

function makeReport(reportId: string, suffix: string): TestReportDetail {
  return {
    id: reportId,
    status: "AVAILABLE",
    currentRevisionId: `01900000-0000-7000-8000-0000000003${suffix}`,
    report: {
      cases: [
        {
          evalRevisionCaseId: `01900000-0000-7000-8000-0000000004${suffix}`,
          externalId: 1,
          name: `Case ${suffix}`,
          issueIds: [`issue-${suffix}`],
        },
      ],
    },
  } as unknown as TestReportDetail
}

function makeAnalysis(
  id: string,
  reportId: string,
  reportRevisionId: string,
): TestReportAnalysis {
  return {
    id,
    reportId,
    reportRevisionId,
    revisionNumber: 1,
    status: "AVAILABLE",
    selectedEvalRevisionCaseIds: [],
    modelId: "test-model",
    configuredModelId: "configured-test-model",
    actualModelId: "test-model",
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
      summary: `Analysis for ${reportId}`,
      findings: [],
      priorityOrder: [],
      limitations: [],
    },
    usage: null,
    error: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    startedAt: "2026-08-13T00:00:01.000Z",
    completedAt: "2026-08-13T00:00:02.000Z",
  }
}

describe("useTestReportAnalyzerController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listTestReportAnalysisLogs.mockResolvedValue({
      items: [],
      pagination: {
        limit: 200,
        hasMore: false,
        nextBeforeSequence: null,
      },
    })
  })

  it("drops the selected Analysis when navigation switches to another report", async () => {
    const reportA = makeReport(reportAId, "01")
    const reportB = makeReport(reportBId, "02")
    const analysisA = makeAnalysis(
      analysisAId,
      reportAId,
      reportA.currentRevisionId!,
    )
    const analysisB = makeAnalysis(
      analysisBId,
      reportBId,
      reportB.currentRevisionId!,
    )
    api.listTestReportAnalyses.mockImplementation(async (reportId: string) => ({
      items: reportId === reportAId ? [analysisA] : [analysisB],
    }))
    api.getTestReportAnalysis.mockImplementation(async (analysisId: string) =>
      analysisId === analysisAId ? analysisA : analysisB,
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      ({ report, reportId }) =>
        useTestReportAnalyzerController(reportId, report),
      {
        initialProps: { report: reportA, reportId: reportAId },
        wrapper,
      },
    )

    await waitFor(() => {
      expect(hook.result.current.selectedAnalysis?.id).toBe(analysisAId)
    })
    act(() => hook.result.current.actions.selectAnalysis(analysisAId))

    hook.rerender({ report: reportB, reportId: reportBId })

    expect(hook.result.current.selectedAnalysis).toBeNull()
    expect(hook.result.current.selectedAnalysisId).toBeNull()
    await waitFor(() => {
      expect(hook.result.current.selectedAnalysis?.id).toBe(analysisBId)
    })
    expect(
      api.getTestReportAnalysis.mock.calls.filter(
        ([analysisId]) => analysisId === analysisAId,
      ),
    ).toHaveLength(1)
    expect(hook.result.current.selectedAnalysis?.reportId).toBe(reportBId)
  })
})
