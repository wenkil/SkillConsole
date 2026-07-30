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
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-foreground px-5 py-3.5">
        <div>
          <div className="technical-heading text-[10px] text-muted-foreground">
            {t("tasks.eyebrow")}
          </div>
          <h2 className="mt-1 text-base font-[760]">{t("tasks.title")}</h2>
        </div>
        <Button className="rounded-none" onClick={onGenerate} type="button">
          <Plus data-icon="inline-start" />
          {t("table.generate")}
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-sm border border-dashed border-rule px-8 py-10">
            <FlaskConical className="mx-auto size-9 text-technical" />
            <h3 className="mt-4 text-lg font-[760]">{t("review.emptyTitle")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("review.emptyDescription")}
            </p>
            <Button
              className="mt-5 rounded-none"
              onClick={onGenerate}
              type="button"
            >
              <Plus data-icon="inline-start" />
              {t("table.generate")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[58rem] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-paper-muted">
              <tr className="border-b border-foreground">
                {tableColumns.map((column) => (
                  <th
                    className="px-4 py-3 font-mono text-[9px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
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
                  className="border-b border-rule-soft hover:bg-paper-muted/45"
                  key={task.id}
                >
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <StatusIcon status={task.status} />
                      {t(`status.${task.status}`)}
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
                  <td className="px-4 py-3.5 font-mono text-[10px]">
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
                    <time className="font-mono text-[10px]">
                      {new Intl.DateTimeFormat(locale, {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(task.createdAt))}
                    </time>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[10px]">
                    {formatDuration(task, t)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex border px-2 py-1 font-mono text-[9px] font-bold",
                        task.draftStatus === "PUBLISHED" &&
                          "border-status-passed/55 text-status-passed",
                        task.draftStatus === "READY" &&
                          "border-status-running/55 text-status-running",
                        task.draftStatus === "DISCARDED" &&
                          "border-status-cancelled/55 text-status-cancelled",
                      )}
                    >
                      {reviewLabel(task, t)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Button
                      className="rounded-none"
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

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-foreground bg-paper-muted px-5 py-3">
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>{t("table.total", { count: total })}</span>
          <label className="flex items-center gap-2">
            {t("table.pageSize")}
            <select
              className="h-7 border border-rule bg-background px-2 outline-none focus:border-primary"
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
            className="rounded-none"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-24 text-center font-mono text-[10px]">
            {t("table.page", {
              page: pageCount === 0 ? 0 : page,
              pageCount,
            })}
          </span>
          <Button
            aria-label={t("table.next")}
            className="rounded-none"
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
