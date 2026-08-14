import { describe, expect, it } from "vitest"

import {
  createTestReportAnalysis,
  testReportAnalysisDocumentUrl,
  testReportCombinedDocumentUrl,
  testReportDocumentUrl,
} from "@/features/test-reports/api/test-reports-api"
import {
  getDefaultAnalysisCaseIds,
  isTestReportAnalysisAvailable,
  isTestReportDocumentReady,
} from "@/features/test-reports/model/test-report"

describe("test report document model", () => {
  it("exposes stable HTML and Markdown Revision URLs but no JSON format", () => {
    const html = testReportDocumentUrl(
      "report-id",
      "revision-id",
      "zh-CN",
      "html",
    )
    const markdown = testReportDocumentUrl(
      "report-id",
      "revision-id",
      "en",
      "markdown",
      true,
    )
    expect(html).toBe(
      "/api/test-reports/report-id/revisions/revision-id/document.html?locale=zh-CN",
    )
    expect(markdown).toContain("document.md?locale=en&download=true")
    expect(`${html}${markdown}`).not.toContain(".json")
  })

  it("builds a complete HTML download URL from the selected Analysis Revision", () => {
    expect(testReportCombinedDocumentUrl("analysis-id", "zh-CN")).toBe(
      "/api/test-report-analyses/analysis-id/document.full.html?locale=zh-CN&download=true",
    )
  })

  it("requires both a terminal report status and immutable Revision identity", () => {
    expect(
      isTestReportDocumentReady({
        status: "AVAILABLE",
        currentRevisionId: "revision-id",
      }),
    ).toBe(true)
    expect(
      isTestReportDocumentReady({
        status: "GENERATION_PENDING",
        currentRevisionId: null,
      }),
    ).toBe(false)
  })

  it("builds immutable Analysis HTML and Markdown URLs without a JSON export", () => {
    const html = testReportAnalysisDocumentUrl(
      "analysis-id",
      "zh-CN",
      "html",
    )
    const markdown = testReportAnalysisDocumentUrl(
      "analysis-id",
      "en",
      "markdown",
      true,
    )
    expect(html).toBe(
      "/api/test-report-analyses/analysis-id/document.html?locale=zh-CN",
    )
    expect(markdown).toContain("document.md?locale=en&download=true")
    expect(`${html}${markdown}`).not.toContain(".json")
  })

  it("selects issue Cases by default and all Cases when no issue exists", () => {
    const cases = [
      { evalRevisionCaseId: "case-1", externalId: 1, name: "One", issueIds: [] },
      {
        evalRevisionCaseId: "case-2",
        externalId: 2,
        name: "Two",
        issueIds: ["issue-1"],
      },
    ]
    expect(getDefaultAnalysisCaseIds(cases)).toEqual(["case-2"])
    expect(
      getDefaultAnalysisCaseIds(
        cases.map((item) => ({ ...item, issueIds: [] })),
      ),
    ).toEqual(["case-1", "case-2"])
  })

  it("requires an available status and a validated snapshot before rendering", () => {
    expect(
      isTestReportAnalysisAvailable({
        status: "AVAILABLE",
        analysis: {
          schemaVersion: "test-report-analysis.v1",
          summary: "Summary",
          findings: [],
          priorityOrder: [],
          limitations: [],
        },
      }),
    ).toBe(true)
    expect(
      isTestReportAnalysisAvailable({ status: "AVAILABLE", analysis: null }),
    ).toBe(false)
  })

  it("creates an Analysis with an idempotency key and only selected Case IDs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "analysis-id" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    )
    await createTestReportAnalysis("report-id", ["case-1", "case-2"])
    const [url, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe("/api/test-reports/report-id/analyses")
    expect(init?.method).toBe("POST")
    expect(headers.get("Idempotency-Key")).toBeTruthy()
    expect(init?.body).toBe(
      JSON.stringify({ evalRevisionCaseIds: ["case-1", "case-2"] }),
    )
    fetchMock.mockRestore()
  })
})
