import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleX,
  Eye,
  FlaskConical,
  LoaderCircle,
  OctagonAlert,
  Plus,
} from "lucide-react"
import type { TFunction } from "i18next"

import {
  isActiveEvalGeneration,
  type EvalGenerationStatus,
  type EvalGenerationTask,
} from "@/features/evals/model/evals"
import { Button } from "@/shared/components/ui/button"
import { EmptyState } from "@/shared/components/ui/empty-state"
import { cn } from "@/shared/lib/utils"

const tableColumns = [
  "status",
  "skillVersion",
  "result",
  "createdAt",
  "duration",
  "reviewStatus",
  "actions",
] as const

function StatusIcon({ status }: { status: EvalGenerationStatus }) {
  if (isActiveEvalGeneration(status)) {
    return <LoaderCircle className="size-3.5 animate-spin text-status-running" />
  }
  if (status === "SUCCEEDED") {
    return <CheckCircle2 className="size-3.5 text-status-passed" />
  }
  if (status === "FAILED") {
    return <OctagonAlert className="size-3.5 text-status-failed" />
  }
  if (status === "INTERRUPTED") {
    return <CircleDashed className="size-3.5 text-status-blocked" />
  }
  return <CircleX className="size-3.5 text-status-cancelled" />
}

function formatDuration(task: EvalGenerationTask, t: TFunction<"evals">) {
  if (!task.startedAt) return "—"
  if (!task.completedAt) return t("table.runningDuration")
  const milliseconds =
    new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
  const seconds = Math.max(0, Math.round(milliseconds / 1_000))
  if (seconds < 60) return t("table.durationSeconds", { count: seconds })
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return t("table.durationMinutes", {
    minutes,
    seconds: remainingSeconds,
  })
}

function reviewLabel(task: EvalGenerationTask, t: TFunction<"evals">) {
  if (!task.draftStatus) return "—"
  return t(`table.reviewStatus.${task.draftStatus}`)
}

export function EvalTaskTable({
  tasks,
  locale,
  page,
  pageSize,
  total,
  pageCount,
  onGenerate,
  onOpen,
  onPageChange,
  onPageSizeChange,
  t,
}: {
  tasks: readonly EvalGenerationTask[]
  locale: string
  page: number
  pageSize: number
  total: number
  pageCount: number
  onGenerate: () => void
  onOpen: (taskId: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  t: TFunction<"evals">
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3.5">
        <div>
          <div className="ui-label">
            {t("tasks.eyebrow")}
          </div>
          <h2 className="mt-1 text-base font-[760]">{t("tasks.title")}</h2>
        </div>
        <Button className="rounded-xl" onClick={onGenerate} type="button">
          <Plus data-icon="inline-start" />
          {t("table.generate")}
        </Button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          description={t("review.emptyDescription")}
          icon={FlaskConical}
          title={t("review.emptyTitle")}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-paper-muted">
              <tr className="border-b border-border">
                {tableColumns.map((column) => (
                  <th
                    className="px-4 py-3 font-mono text-[11px] leading-4 font-bold tracking-[0.06em] text-muted-foreground uppercase"
                    key={column}
                    scope="col"
                  >
                    {t(`table.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  className="border-b border-border-subtle hover:bg-paper-muted/45"
                  key={task.id}
                >
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <StatusIcon status={task.status} />
                      {t(`status.${task.status}`)}
                    </span>
                    <span className="ui-meta">
                      {t("table.attemptCount", { count: task.attemptCount })}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <strong className="block text-xs">
                      {task.target.sourceKind === "DRAFT_REVISION"
                        ? t("table.draftVersion", {
                            version: task.target.displayVersion,
                          })
                        : task.target.displayVersion}
                    </strong>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
                    {task.evalCount === null ? (
                      "—"
                    ) : (
                      <span>
                        {t("table.resultSummary", {
                          cases: task.evalCount,
                          files: task.fileCount ?? 0,
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <time className="font-mono text-xs">
                      {new Intl.DateTimeFormat(locale, {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(task.createdAt))}
                    </time>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
                    {formatDuration(task, t)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex rounded-lg border px-2 py-1 font-mono text-[11px] leading-4 font-bold",
                        task.draftStatus === "PUBLISHED" &&
                          "border-status-passed/25 bg-status-passed/10 text-status-passed",
                        task.draftStatus === "READY" &&
                          "border-status-running/25 bg-status-running/10 text-status-running",
                        task.draftStatus === "DISCARDED" &&
                          "border-status-cancelled/25 bg-status-cancelled/10 text-status-cancelled",
                      )}
                    >
                      {reviewLabel(task, t)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Button
                      className="rounded-xl"
                      onClick={() => onOpen(task.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Eye data-icon="inline-start" />
                      {t("table.viewDetails")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-muted px-5 py-3">
        <div className="ui-meta flex items-center gap-3">
          <span>{t("table.total", { count: total })}</span>
          <label className="flex items-center gap-2">
            {t("table.pageSize")}
            <select
              className="h-8 rounded-lg border border-border-default bg-background px-2 text-xs outline-none focus:border-focus-ring focus:ring-2 focus:ring-ring/15"
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              value={pageSize}
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label={t("table.previous")}
            className="rounded-xl"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft />
          </Button>
          <span className="ui-meta min-w-24 text-center">
            {t("table.page", {
              page: pageCount === 0 ? 0 : page,
              pageCount,
            })}
          </span>
          <Button
            aria-label={t("table.next")}
            className="rounded-xl"
            disabled={pageCount === 0 || page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronRight />
          </Button>
        </div>
      </footer>
    </section>
  )
}
