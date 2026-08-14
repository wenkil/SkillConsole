import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileChartColumn,
  FileText,
  FilterX,
  LoaderCircle,
  RotateCcw,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { TestReportStatusBadge } from "@/features/test-reports/components/test-report-status"
import { useTestReportsListController } from "@/features/test-reports/hooks/use-test-reports-controller"
import type {
  TestReportAnalysisSummaryStatus,
  TestReportComparability,
  TestReportRunStatus,
  TestReportStatus,
  TestReportType,
} from "@/features/test-reports/model/test-report"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

function formatRate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`
}

function formatDuration(value: number | null): string {
  if (value === null) return "—"
  const seconds = Math.round(value / 1_000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function TestReportsWorkbenchView({
  workspace,
  locale,
}: {
  workspace: SkillWorkspace
  locale: string
}) {
  const { t } = useTranslation("testReports")
  const navigate = useNavigate()
  const controller = useTestReportsListController(workspace.id)
  const filtersActive =
    controller.filters.reportType !== "" ||
    controller.filters.status !== "" ||
    controller.filters.runStatus !== "" ||
    controller.filters.comparability !== "" ||
    controller.filters.analysisStatus !== "" ||
    controller.filters.hasNegativeTransition !== ""

  if (controller.loading) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-xs">
        <LoaderCircle className="size-4 animate-spin" />
        {t("states.loading")}
      </main>
    )
  }
  if (controller.error) {
    return (
      <main className="flex h-full items-center justify-center px-8">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <AlertTriangle className="mx-auto size-8 text-destructive" />
          <h1 className="mt-3 text-lg font-[760]">{t("states.loadError")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("states.loadErrorDescription")}
          </p>
          <Button
            className="mt-4 rounded-none"
            onClick={controller.actions.retry}
            type="button"
            variant="outline"
          >
            <RotateCcw data-icon="inline-start" />
            {t("states.retry")}
          </Button>
        </div>
      </main>
    )
  }

  const summary = [
    ["total", controller.summary.total],
    ["available", controller.summary.available],
    ["partial", controller.summary.partial],
    ["negative", controller.summary.withNegativeTransitions],
    ["failed", controller.summary.generationFailed],
    [
      "cost",
      `$${(
        controller.summary.executionCostUsd +
        controller.summary.gradingCostUsd
      ).toFixed(4)}`,
    ],
  ] as const

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground bg-background px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
              <FileChartColumn className="size-3.5" />
              {t("header.eyebrow")}
            </div>
            <h1 className="mt-1.5 text-3xl leading-none font-[790] tracking-[-0.04em]">
              {t("header.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t("header.description", { name: workspace.name })}
            </p>
          </div>
          {controller.refreshing ? (
            <span className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              {t("states.refreshing")}
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid grid-cols-6 gap-px border border-foreground bg-rule">
          {summary.map(([key, value]) => (
            <div className="bg-background px-3 py-2" key={key}>
              <span className="block font-mono text-[8px] text-muted-foreground uppercase">
                {t(`summary.${key}`)}
              </span>
              <strong className="mt-0.5 block text-lg">{value}</strong>
            </div>
          ))}
        </div>
      </header>

      <section className="shrink-0 border-b border-foreground bg-paper-muted/35 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("filters.reportType")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                reportType: event.target.value as "" | TestReportType,
              })
            }
            value={controller.filters.reportType}
          >
            <option value="">{t("filters.allTypes")}</option>
            <option value="skill_effect">{t("type.skill_effect")}</option>
            <option value="version_comparison">
              {t("type.version_comparison")}
            </option>
          </select>
          <select
            aria-label={t("filters.reportStatus")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                status: event.target.value as "" | TestReportStatus,
              })
            }
            value={controller.filters.status}
          >
            <option value="">{t("filters.allReportStatuses")}</option>
            {([
              "AVAILABLE",
              "PARTIAL",
              "GENERATION_PENDING",
              "GENERATION_FAILED",
              "UNAVAILABLE",
            ] as const).map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("filters.runStatus")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                runStatus: event.target.value as "" | TestReportRunStatus,
              })
            }
            value={controller.filters.runStatus}
          >
            <option value="">{t("filters.allRunStatuses")}</option>
            {(["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"] as const).map(
              (status) => (
                <option key={status} value={status}>
                  {t(`runStatus.${status}`)}
                </option>
              ),
            )}
          </select>
          <select
            aria-label={t("filters.comparability")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                comparability: event.target.value as
                  | ""
                  | TestReportComparability,
              })
            }
            value={controller.filters.comparability}
          >
            <option value="">{t("filters.allComparability")}</option>
            {([
              "COMPARABLE",
              "COMPARABLE_WITH_LIMITATIONS",
              "NOT_COMPARABLE",
              "UNKNOWN_LEGACY",
            ] as const).map((status) => (
              <option key={status} value={status}>
                {t(`comparability.${status}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("filters.analysisStatus")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                analysisStatus: event.target.value as
                  | ""
                  | TestReportAnalysisSummaryStatus,
              })
            }
            value={controller.filters.analysisStatus}
          >
            <option value="">{t("filters.allAnalysisStatuses")}</option>
            {([
              "NOT_REQUESTED",
              "PENDING",
              "RUNNING",
              "AVAILABLE",
              "FAILED",
            ] as const).map((status) => (
              <option key={status} value={status}>
                {t(`analysis.status.${status}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("filters.changes")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                hasNegativeTransition: event.target.value as
                  | ""
                  | "true"
                  | "false",
              })
            }
            value={controller.filters.hasNegativeTransition}
          >
            <option value="">{t("filters.allChanges")}</option>
            <option value="true">{t("filters.hasNegative")}</option>
            <option value="false">{t("filters.noNegative")}</option>
          </select>
          <select
            aria-label={t("filters.sort")}
            className="h-8 border border-rule bg-background px-2 font-mono text-[9px]"
            onChange={(event) =>
              controller.actions.updateFilters({
                sort: event.target.value as typeof controller.filters.sort,
              })
            }
            value={controller.filters.sort}
          >
            {([
              "completedAt",
              "issueCount",
              "passRate",
              "cost",
              "duration",
            ] as const).map((sort) => (
              <option key={sort} value={sort}>
                {t(`filters.sortOptions.${sort}`)}
              </option>
            ))}
          </select>
          <Button
            className="rounded-none"
            disabled={!filtersActive}
            onClick={controller.actions.resetFilters}
            size="sm"
            type="button"
            variant="outline"
          >
            <FilterX data-icon="inline-start" />
            {t("filters.clear")}
          </Button>
        </div>
      </section>

      {controller.reports.length === 0 ? (
        <section className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-md border border-dashed border-rule px-8 py-10">
            <FileText className="mx-auto size-9 text-technical" />
            <h2 className="mt-4 text-lg font-[760]">
              {t(filtersActive ? "empty.filteredTitle" : "empty.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t(filtersActive ? "empty.filteredDescription" : "empty.description")}
            </p>
          </div>
        </section>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[88rem] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-paper-muted">
              <tr className="border-b border-foreground">
                {([
                  "report",
                  "type",
                  "status",
                  "subjects",
                  "outcome",
                  "changes",
                  "analysis",
                  "usage",
                  "evals",
                  "completedAt",
                  "actions",
                ] as const).map((column) => (
                  <th
                    className="px-4 py-3 font-mono text-[9px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
                    key={column}
                  >
                    {t(`list.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {controller.reports.map((report) => (
                <tr
                  className="border-b border-rule-soft hover:bg-paper-muted/45"
                  key={report.id}
                >
                  <td className="px-4 py-3.5">
                    <strong className="block max-w-60 text-xs">
                      {report.baselineLabel} → {report.targetLabel}
                    </strong>
                    <span className="mt-1 block font-mono text-[8px] text-muted-foreground">
                      {report.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[9px] font-bold">
                    {t(`type.${report.reportType}`)}
                  </td>
                  <td className="px-4 py-3.5">
                    <TestReportStatusBadge status={report.status} />
                    <span className="mt-1 block font-mono text-[8px] text-muted-foreground">
                      {t(`runStatus.${report.runStatus}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[11px]">
                    <span className="block">← {report.baselineLabel}</span>
                    <span className="mt-1 block">→ {report.targetLabel}</span>
                    <span className="mt-1 block font-mono text-[8px] text-muted-foreground">
                      {report.comparabilityStatus
                        ? t(`comparability.${report.comparabilityStatus}`)
                        : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[10px]">
                    <strong className="block">
                      {formatRate(report.primaryPassRate)}
                    </strong>
                    <span className="mt-1 block text-[8px] text-muted-foreground">
                      {t("list.coverage", {
                        value: formatRate(report.assessmentCoverageRate),
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[9px]">
                    <span className="text-status-passed">
                      +{report.positiveTransitionCount}
                    </span>{" "}
                    /{" "}
                    <span className="text-status-failed">
                      −{report.negativeTransitionCount}
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      {t("list.issues", { count: report.issueCount })}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[9px]">
                    {t(`analysis.status.${report.analysisStatus}`)}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[9px]">
                    <strong className="block">
                      ${report.totalCostUsd.toFixed(4)}
                    </strong>
                    <span className="mt-1 block text-muted-foreground">
                      {formatDuration(report.wallClockDurationMs)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[9px]">
                    R{report.evalRevisionNumber} · {report.evalCount}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[9px]">
                    {report.completedAt
                      ? new Intl.DateTimeFormat(locale, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(report.completedAt))
                      : "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    <Button
                      className="rounded-none"
                      onClick={() =>
                        navigate(
                          `/workbenches/${workspace.id}/reports/${report.id}`,
                        )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <FileText data-icon="inline-start" />
                      {t("list.view")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex shrink-0 items-center justify-between border-t border-foreground bg-paper-muted px-5 py-3">
        <span className="font-mono text-[10px] text-muted-foreground">
          {t("list.total", { count: controller.pagination.total })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            aria-label={t("list.previous")}
            className="rounded-none"
            disabled={controller.pagination.page <= 1}
            onClick={() =>
              controller.actions.updateFilters({
                page: controller.pagination.page - 1,
              })
            }
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-24 text-center font-mono text-[10px]">
            {t("list.page", {
              page:
                controller.pagination.pageCount === 0
                  ? 0
                  : controller.pagination.page,
              pageCount: controller.pagination.pageCount,
            })}
          </span>
          <Button
            aria-label={t("list.next")}
            className="rounded-none"
            disabled={
              controller.pagination.pageCount === 0 ||
              controller.pagination.page >= controller.pagination.pageCount
            }
            onClick={() =>
              controller.actions.updateFilters({
                page: controller.pagination.page + 1,
              })
            }
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronRight />
          </Button>
        </div>
      </footer>
    </main>
  )
}
