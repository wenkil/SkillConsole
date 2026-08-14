import type {
  TestReportAnalysis,
  TestReportAnalysisList,
  TestReportDetail,
  TestReportListFilters,
  TestReportPage,
} from "@/features/test-reports/model/test-report"
import { readApiError } from "@/shared/api/http"

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Accept")) headers.set("Accept", "application/json")
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as T
}

export function listTestReports(
  workspaceId: string,
  filters: TestReportListFilters,
): Promise<TestReportPage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    sort: filters.sort,
    order: filters.order,
  })
  if (filters.reportType) query.set("reportType", filters.reportType)
  if (filters.status) query.set("status", filters.status)
  if (filters.runStatus) query.set("runStatus", filters.runStatus)
  if (filters.comparability) {
    query.set("comparability", filters.comparability)
  }
  if (filters.analysisStatus) {
    query.set("analysisStatus", filters.analysisStatus)
  }
  if (filters.hasNegativeTransition) {
    query.set("hasNegativeTransition", filters.hasNegativeTransition)
  }
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/test-reports?${query}`,
  )
}

export function getTestReport(reportId: string): Promise<TestReportDetail> {
  return readJson(`/api/test-reports/${encodeURIComponent(reportId)}`)
}

export function getTestReportByRun(runId: string): Promise<TestReportDetail> {
  return readJson(`/api/test-runs/${encodeURIComponent(runId)}/report`)
}

export function regenerateTestReport(
  reportId: string,
): Promise<TestReportDetail> {
  return readJson(
    `/api/test-reports/${encodeURIComponent(reportId)}/regenerate`,
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    },
  )
}

export function testReportDocumentUrl(
  reportId: string,
  revisionId: string,
  locale: string,
  format: "html" | "markdown",
  download = false,
): string {
  const extension = format === "markdown" ? "md" : "html"
  const query = new URLSearchParams({
    locale: locale === "zh-CN" ? "zh-CN" : "en",
  })
  if (download) query.set("download", "true")
  return `/api/test-reports/${encodeURIComponent(reportId)}/revisions/${encodeURIComponent(revisionId)}/document.${extension}?${query}`
}

export function listTestReportAnalyses(
  reportId: string,
): Promise<TestReportAnalysisList> {
  return readJson(
    `/api/test-reports/${encodeURIComponent(reportId)}/analyses`,
  )
}

export function getTestReportAnalysis(
  analysisId: string,
): Promise<TestReportAnalysis> {
  return readJson(
    `/api/test-report-analyses/${encodeURIComponent(analysisId)}`,
  )
}

export function createTestReportAnalysis(
  reportId: string,
  evalRevisionCaseIds: readonly string[],
): Promise<TestReportAnalysis> {
  return readJson(
    `/api/test-reports/${encodeURIComponent(reportId)}/analyses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ evalRevisionCaseIds }),
    },
  )
}

export function testReportAnalysisDocumentUrl(
  analysisId: string,
  locale: string,
  format: "html" | "markdown",
  download = false,
): string {
  const extension = format === "markdown" ? "md" : "html"
  const query = new URLSearchParams({
    locale: locale === "zh-CN" ? "zh-CN" : "en",
  })
  if (download) query.set("download", "true")
  return `/api/test-report-analyses/${encodeURIComponent(analysisId)}/document.${extension}?${query}`
}
