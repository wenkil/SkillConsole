import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  FlaskConical,
  LoaderCircle,
  Plus,
  RotateCcw,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  useNavigate,
  useSearchParams,
} from "react-router-dom"

import { StartTestRunDialog } from "@/features/test-runs/components/start-test-run-dialog"
import { TestRunStatusBadge } from "@/features/test-runs/components/test-run-status"
import { useTestRunsListController } from "@/features/test-runs/hooks/use-test-runs-controller"
import {
  getCoverageRate,
  getPassRate,
  isBenchmarkComparable,
} from "@/features/test-runs/model/test-run"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { MetricStrip } from "@/shared/components/layout/metric-strip"
import { WorkbenchPageHeader } from "@/shared/components/layout/workbench-page-header"
import { Button } from "@/shared/components/ui/button"
import { EmptyState } from "@/shared/components/ui/empty-state"
import { StatusBanner } from "@/shared/components/ui/status-banner"

function formatRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`
  const seconds = Math.round(milliseconds / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export function TestRunsWorkbenchView({
  workspace,
  locale,
}: {
  workspace: SkillWorkspace
  locale: string
}) {
  const { t } = useTranslation("testRuns")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialRevisionId = searchParams.get("evalRevisionId")
  const controller = useTestRunsListController(
    workspace,
    initialRevisionId,
  )
  const [dialogOpen, setDialogOpen] = useState(Boolean(initialRevisionId))

  const setOpen = (open: boolean) => {
    setDialogOpen(open)
    if (!open && initialRevisionId) {
      setSearchParams({}, { replace: true })
    }
  }

  if (controller.loading) {
    return (
      <main className="flex h-full items-center justify-center gap-2 text-sm">
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
          <h1 className="mt-3 text-lg font-[760]">
            {t("states.loadError")}
          </h1>
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
        description={t("header.description", { name: workspace.name })}
        eyebrow={t("header.eyebrow")}
        icon={Activity}
        metrics={
          <MetricStrip
            ariaLabel={t("header.title")}
            items={(["total", "active", "completed"] as const).map(
              (metric) => ({
                label: t(`header.metrics.${metric}`),
                value: controller.summary[metric],
                tone: metric === "active" && controller.summary.active
                  ? "warning"
                  : metric === "completed"
                    ? "technical"
                    : "default",
              }),
            )}
          />
        }
        title={t("header.title")}
      />

      {controller.mutationError ? (
        <StatusBanner
          action={
            <button
              className="font-mono text-xs underline underline-offset-2"
              onClick={controller.actions.clearMutationError}
              type="button"
            >
              {t("states.dismiss")}
            </button>
          }
          icon={AlertTriangle}
          variant="error"
        >
          {controller.mutationError}
        </StatusBanner>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-border-strong px-5 py-3.5">
          <div>
            <div className="ui-label">
              {t("list.eyebrow")}
            </div>
            <h2 className="mt-1 text-base font-[760]">{t("list.title")}</h2>
          </div>
          <Button
            className="rounded-none"
            onClick={() => setDialogOpen(true)}
            type="button"
          >
            <Plus data-icon="inline-start" />
            {t("list.start")}
          </Button>
        </div>

        {controller.runs.length === 0 ? (
          <EmptyState
            description={t("list.emptyDescription")}
            icon={FlaskConical}
            title={t("list.emptyTitle")}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[64rem] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-paper-muted">
                <tr className="border-b border-border-strong">
                  {(
                    [
                      "status",
                      "mode",
                      "selection",
                      "progress",
                      "comparison",
                      "usage",
                      "duration",
                      "createdAt",
                      "actions",
                    ] as const
                  ).map((column) => (
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
                {controller.runs.map((run) => {
                  const firstSubject =
                    run.baseline.kind === "no_skill"
                      ? t("list.noSkillBaseline")
                      : `${run.baseline.skillVersionName} · R${run.baseline.skillVersionNumber}`
                  const secondSubject =
                    run.mode === "target_vs_no_skill"
                      ? t("list.withSkill")
                      : `${run.target.skillVersionName ?? "—"} · R${run.target.skillVersionNumber ?? "—"}`
                  return (
                  <tr
                    className="border-b border-border-subtle hover:bg-paper-muted/45"
                    key={run.id}
                  >
                    <td className="px-4 py-3.5">
                      <TestRunStatusBadge status={run.status} t={t} />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex border border-border-default px-2 py-1 font-mono text-[11px] leading-4 font-bold">
                        {t(
                          run.mode === "version_vs_version"
                            ? "list.versionComparisonMode"
                            : "list.skillEffectMode",
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <strong className="block text-xs">
                        {run.mode === "version_vs_version" &&
                        run.baseline.kind === "skill_version"
                          ? t("list.versionPair", {
                              candidate: run.target.skillVersionNumber,
                              baseline: run.baseline.skillVersionNumber,
                            })
                          : run.target.draftContentRevision
                          ? t("list.draftRevision", {
                              revision:
                                run.target.draftContentRevision,
                            })
                          : (run.target.skillVersionName ?? "—")}
                      </strong>
                      <span className="ui-meta mt-1 block">
                        {t("list.firstSubject")}: {firstSubject}
                      </span>
                      <span className="ui-meta mt-1 block">
                        {t("list.secondSubject")}: {secondSubject}
                      </span>
                      <span className="ui-meta mt-1 block">
                        EVALS R{run.target.evalRevisionNumber} ·{" "}
                        {t("list.evalCount", {
                          count: run.target.evalCount,
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs">
                      {run.progress.completedCases} / {run.progress.totalCases}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs">
                      <dl className="grid min-w-48 gap-3">
                        {[
                          {
                            label: firstSubject,
                            benchmark: run.benchmark?.baseline ?? null,
                          },
                          {
                            label: secondSubject,
                            benchmark: run.benchmark?.target ?? null,
                          },
                        ].map((subject) => (
                          <div key={subject.label}>
                            <dt className="truncate text-[11px] text-muted-foreground">
                              {subject.label}
                            </dt>
                            <dd className="mt-0.5 font-bold">
                              {formatRate(
                                subject.benchmark
                                  ? getPassRate(subject.benchmark)
                                  : null,
                              )}
                              {subject.benchmark ? (
                                <span className="ml-2 font-sans text-[11px] font-normal text-muted-foreground">
                                  {t("list.coverage", {
                                    value: formatRate(
                                      getCoverageRate(subject.benchmark),
                                    ),
                                  })}
                                </span>
                              ) : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {run.benchmark && !isBenchmarkComparable(run.benchmark) ? (
                        <span className="ui-meta mt-2 block">
                          {t("list.notComparable")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs">
                      <strong className="block">
                        {run.benchmark
                          ? t("list.tokens", {
                              count:
                                run.benchmark.target.inputTokens +
                                run.benchmark.target.outputTokens +
                                run.benchmark.target.gradingInputTokens +
                                run.benchmark.target.gradingOutputTokens +
                                run.benchmark.baseline.inputTokens +
                                run.benchmark.baseline.outputTokens +
                                run.benchmark.baseline.gradingInputTokens +
                                run.benchmark.baseline.gradingOutputTokens,
                            })
                          : "—"}
                      </strong>
                      <span className="ui-meta mt-1 block">
                        {run.benchmark
                          ? t("list.cost", {
                              value: (
                                run.benchmark.target.totalCostUsd +
                                run.benchmark.target.gradingTotalCostUsd +
                                run.benchmark.baseline.totalCostUsd +
                                run.benchmark.baseline.gradingTotalCostUsd
                              ).toFixed(4),
                            })
                          : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs">
                      {run.startedAt
                        ? formatDuration(
                            Math.max(
                              0,
                              new Date(
                                run.completedAt ?? run.updatedAt,
                              ).getTime() -
                                new Date(run.startedAt).getTime(),
                            ),
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <time className="font-mono text-xs">
                        {new Intl.DateTimeFormat(locale, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(run.createdAt))}
                      </time>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                      <Button
                        className="rounded-none"
                        onClick={() =>
                          navigate(
                            `/workbenches/${workspace.id}/runs/${run.id}`,
                          )
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Eye data-icon="inline-start" />
                        {t("list.view")}
                      </Button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-between border-t border-border-strong bg-surface-muted px-5 py-3">
          <div className="ui-meta flex items-center gap-3">
            <span>{t("list.total", { count: controller.pagination.total })}</span>
            <select
              aria-label={t("list.pageSize")}
              className="h-8 border border-border-default bg-background px-2 text-xs"
              onChange={(event) =>
                controller.actions.setPageSize(Number(event.target.value))
              }
              value={controller.pagination.pageSize}
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              aria-label={t("list.previous")}
              className="rounded-none"
              disabled={controller.pagination.page <= 1}
              onClick={() =>
                controller.actions.setPage(controller.pagination.page - 1)
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
                controller.pagination.page >=
                  controller.pagination.pageCount
              }
              onClick={() =>
                controller.actions.setPage(controller.pagination.page + 1)
              }
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRight />
            </Button>
          </div>
        </footer>
      </section>

      <StartTestRunDialog
        blocked={controller.hasActiveRun}
        baselineVersion={controller.baselineVersion}
        baselineVersionId={controller.baselineVersionId}
        candidateVersion={controller.candidateVersion}
        candidateVersionId={controller.candidateVersionId}
        mode={controller.mode}
        onBaselineVersionChange={
          controller.actions.selectBaselineVersion
        }
        onCandidateVersionChange={
          controller.actions.selectCandidateVersion
        }
        onModeChange={controller.actions.selectMode}
        onOpenChange={setOpen}
        onRevisionChange={controller.actions.selectRevision}
        onStart={async () => {
          const run = await controller.actions.start()
          navigate(`/workbenches/${workspace.id}/runs/${run.id}`)
          return run
        }}
        open={dialogOpen}
        pending={controller.mutationPending}
        revisions={controller.revisions}
        selectedRevision={controller.selectedRevision}
        selectedRevisionId={controller.selectedRevisionId}
        t={t}
        draft={controller.draft}
        versions={controller.versions}
        versionsError={controller.versionsError}
        versionsLoading={controller.versionsLoading}
      />
    </main>
  )
}
