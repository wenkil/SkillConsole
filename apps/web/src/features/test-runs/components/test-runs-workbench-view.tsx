import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileChartColumn,
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
import { Button } from "@/shared/components/ui/button"

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
      <header className="shrink-0 border-b border-foreground bg-background px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
              <Activity className="size-3.5" />
              {t("header.eyebrow")}
            </div>
            <h1 className="mt-1.5 text-3xl leading-none font-[790] tracking-[-0.04em]">
              {t("header.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t("header.description", { name: workspace.name })}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px border border-foreground bg-rule">
            {(["total", "active", "completed"] as const).map((metric) => (
              <div className="min-w-24 bg-background px-3 py-2" key={metric}>
                <span className="block font-mono text-[9px] text-muted-foreground uppercase">
                  {t(`header.metrics.${metric}`)}
                </span>
                <strong className="mt-0.5 block text-lg">
                  {controller.summary[metric]}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </header>

      {controller.mutationError ? (
        <div
          className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/50 bg-destructive/5 px-5 py-2 text-xs"
          role="alert"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            {controller.mutationError}
          </span>
          <button
            className="font-mono text-[10px] underline"
            onClick={controller.actions.clearMutationError}
            type="button"
          >
            {t("states.dismiss")}
          </button>
        </div>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-foreground px-5 py-3.5">
          <div>
            <div className="technical-heading text-[10px] text-muted-foreground">
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
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-md border border-dashed border-rule px-8 py-10">
              <FlaskConical className="mx-auto size-9 text-technical" />
              <h3 className="mt-4 text-lg font-[760]">
                {t("list.emptyTitle")}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("list.emptyDescription")}
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[88rem] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-paper-muted">
                <tr className="border-b border-foreground">
                  {(
                    [
                      "status",
                      "mode",
                      "selection",
                      "progress",
                      "target",
                      "baseline",
                      "usage",
                      "duration",
                      "createdAt",
                      "actions",
                    ] as const
                  ).map((column) => (
                    <th
                      className="px-4 py-3 font-mono text-[9px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
                      key={column}
                      scope="col"
                    >
                      {t(`list.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {controller.runs.map((run) => (
                  <tr
                    className="border-b border-rule-soft hover:bg-paper-muted/45"
                    key={run.id}
                  >
                    <td className="px-4 py-3.5">
                      <TestRunStatusBadge status={run.status} t={t} />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex border border-rule px-2 py-1 font-mono text-[9px] font-bold">
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
                      <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                        {t("list.confirmedVersion")}: {run.target.skillVersionName
                          ? `${run.target.skillVersionName} · #${run.target.skillVersionNumber}`
                          : "—"}
                      </span>
                      <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                        BASELINE:{" "}
                        {run.baseline.kind === "no_skill"
                          ? t("list.noSkillBaseline")
                          : `${run.baseline.skillVersionName} · #${run.baseline.skillVersionNumber}`}
                      </span>
                      <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                        EVALS R{run.target.evalRevisionNumber} ·{" "}
                        {t("list.evalCount", {
                          count: run.target.evalCount,
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px]">
                      {run.progress.completedCases} / {run.progress.totalCases}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px]">
                      <strong className="block">
                        {formatRate(
                          run.benchmark
                            ? getPassRate(run.benchmark.target)
                            : null,
                        )}
                      </strong>
                      {run.benchmark ? (
                        <span className="mt-1 block text-[8px] text-muted-foreground">
                          {t("list.coverage", {
                            value: formatRate(
                              getCoverageRate(run.benchmark.target),
                            ),
                          })}
                          {!isBenchmarkComparable(run.benchmark)
                            ? ` · ${t("list.notComparable")}`
                            : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px]">
                      <strong className="block">
                        {formatRate(
                          run.benchmark
                            ? getPassRate(run.benchmark.baseline)
                            : null,
                        )}
                      </strong>
                      {run.benchmark ? (
                        <span className="mt-1 block text-[8px] text-muted-foreground">
                          {t("list.coverage", {
                            value: formatRate(
                              getCoverageRate(run.benchmark.baseline),
                            ),
                          })}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px]">
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
                      <span className="mt-1 block text-[8px] text-muted-foreground">
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
                    <td className="px-4 py-3.5 font-mono text-[10px]">
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
                      <time className="font-mono text-[10px]">
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
                      {!["PREPARING", "RUNNING", "SCORING", "CANCELING"].includes(
                        run.status,
                      ) ? (
                        <Button
                          className="rounded-none"
                          onClick={() =>
                            navigate(
                              `/workbenches/${workspace.id}/reports/by-run/${run.id}`,
                            )
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <FileChartColumn data-icon="inline-start" />
                          {t("list.viewReport")}
                        </Button>
                      ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-between border-t border-foreground bg-paper-muted px-5 py-3">
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span>{t("list.total", { count: controller.pagination.total })}</span>
            <select
              aria-label={t("list.pageSize")}
              className="h-7 border border-rule bg-background px-2"
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
