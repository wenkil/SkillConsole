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
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SkillScoreReportsPanel } from "@/features/test-reports/components/skill-score-reports-panel"
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
import { MetricStrip } from "@/shared/components/layout/metric-strip"
import { WorkbenchPageHeader } from "@/shared/components/layout/workbench-page-header"
import { Button } from "@/shared/components/ui/button"
import { EmptyState } from "@/shared/components/ui/empty-state"

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
  const [searchParams] = useSearchParams()
  const [reportGroup, setReportGroup] = useState<"deterministic" | "ai-score">(
    searchParams.get("tab") === "ai-score" ? "ai-score" : "deterministic",
  )
  const controller = useTestReportsListController(
    workspace.id,
    reportGroup === "deterministic",
  )
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const filtersActive =
    controller.filters.reportType !== "" ||
    controller.filters.status !== "" ||
    controller.filters.runStatus !== "" ||
    controller.filters.comparability !== "" ||
    controller.filters.analysisStatus !== "" ||
    controller.filters.hasNegativeTransition !== ""

  if (reportGroup === "deterministic" && controller.loading) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-xs">
        <LoaderCircle className="size-4 animate-spin" />
        {t("states.loading")}
      </main>
    )
  }
  if (reportGroup === "deterministic" && controller.error) {
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

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <WorkbenchPageHeader
        actions={
          controller.refreshing ? (
            <span className="ui-meta flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              {t("states.refreshing")}
            </span>
          ) : null
        }
        description={t("header.description", { name: workspace.name })}
        eyebrow={t("header.eyebrow")}
        icon={FileChartColumn}
        metrics={
          <MetricStrip
            ariaLabel={t("header.title")}
            items={[
              {
                label: t("summary.total"),
                value: controller.summary.total,
              },
              {
                hint: `${t("summary.negative")}: ${controller.summary.withNegativeTransitions}`,
                label: t("summary.available"),
                value: controller.summary.available,
                tone: "technical",
              },
              {
                hint: `${t("summary.failed")}: ${controller.summary.generationFailed}`,
                label: t("summary.partial"),
                value: controller.summary.partial,
                tone: controller.summary.partial ? "warning" : "default",
              },
              {
                label: t("summary.cost"),
                value: `$${(
                  controller.summary.executionCostUsd +
                  controller.summary.gradingCostUsd
                ).toFixed(4)}`,
                tone: "technical",
              },
            ]}
          />
        }
        title={t("header.title")}
      />

      <nav className="flex shrink-0 border-b border-border-strong bg-paper-raised" aria-label={t("tabs.label")}>
        <button className={`border-b-2 px-5 py-3 font-mono text-xs font-bold ${reportGroup === "deterministic" ? "border-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setReportGroup("deterministic")} type="button">{t("tabs.deterministic")}</button>
        <button className={`border-b-2 px-5 py-3 font-mono text-xs font-bold ${reportGroup === "ai-score" ? "border-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setReportGroup("ai-score")} type="button">{t("tabs.aiScore")}</button>
      </nav>

      {reportGroup === "ai-score" ? (
        <SkillScoreReportsPanel
          initialReportId={searchParams.get("reportId")}
          locale={locale}
          workspaceId={workspace.id}
        />
      ) : (
        <>

      <section className="shrink-0 border-b border-border-strong bg-paper-muted/35 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("filters.reportType")}
            className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
            className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
            className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
          <details
            className="group basis-full lg:basis-auto"
            onToggle={(event) => setFiltersExpanded(event.currentTarget.open)}
            open={filtersExpanded}
          >
            <summary className="inline-flex h-9 cursor-pointer list-none items-center border border-border-default bg-background px-3 font-mono text-xs font-semibold marker:hidden hover:bg-accent">
              {t(filtersExpanded ? "filters.less" : "filters.more")}
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2 lg:mt-0 lg:inline-flex">
              <select
                aria-label={t("filters.comparability")}
                className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
                className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
                className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
                className="h-9 border border-border-default bg-background px-2 font-mono text-xs"
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
            </div>
          </details>
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
        <EmptyState
          description={t(
            filtersActive ? "empty.filteredDescription" : "empty.description",
          )}
          icon={FileText}
          title={t(filtersActive ? "empty.filteredTitle" : "empty.title")}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-paper-muted">
              <tr className="border-b border-border-strong">
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
                    className="px-4 py-3 font-mono text-[11px] leading-4 font-bold tracking-[0.06em] text-muted-foreground uppercase"
                    key={column}
                    scope="col"
                  >
                    {t(`list.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {controller.reports.map((report) => (
                <tr
                  className="border-b border-border-subtle hover:bg-paper-muted/45"
                  key={report.id}
                >
                  <td className="px-4 py-3.5">
                    <strong className="block max-w-60 text-xs">
                      {report.baselineLabel} → {report.targetLabel}
                    </strong>
                    <span className="ui-meta mt-1 block">
                      {report.id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs font-bold">
                    {t(`type.${report.reportType}`)}
                  </td>
                  <td className="px-4 py-3.5">
                    <TestReportStatusBadge status={report.status} />
                    <span className="ui-meta mt-1 block">
                      {t(`runStatus.${report.runStatus}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[13px] leading-5">
                    <span className="block">← {report.baselineLabel}</span>
                    <span className="mt-1 block">→ {report.targetLabel}</span>
                    <span className="ui-meta mt-1 block">
                      {report.comparabilityStatus
                        ? t(`comparability.${report.comparabilityStatus}`)
                        : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
                    <strong className="block">
                      {formatRate(report.primaryPassRate)}
                    </strong>
                    <span className="ui-meta mt-1 block">
                      {t("list.coverage", {
                        value: formatRate(report.assessmentCoverageRate),
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
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
                  <td className="px-4 py-3.5 font-mono text-xs">
                    {t(`analysis.status.${report.analysisStatus}`)}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
                    <strong className="block">
                      ${report.totalCostUsd.toFixed(4)}
                    </strong>
                    <span className="mt-1 block text-muted-foreground">
                      {formatDuration(report.wallClockDurationMs)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
                    R{report.evalRevisionNumber} · {report.evalCount}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
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

      <footer className="flex shrink-0 items-center justify-between border-t border-border-strong bg-surface-muted px-5 py-3">
        <span className="ui-meta">
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
          <span className="ui-meta min-w-24 text-center">
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
        </>
      )}
    </main>
  )
}
