import {
  CheckCircle2,
  CircleDashed,
  CircleX,
  Clock3,
  LoaderCircle,
  OctagonAlert,
} from "lucide-react"
import type { TFunction } from "i18next"

import {
  isActiveEvalGeneration,
  type EvalGenerationStatus,
  type EvalGenerationTask,
} from "@/features/evals/model/evals"
import { cn } from "@/shared/lib/utils"

function StatusIcon({
  status,
}: {
  status: EvalGenerationStatus
}) {
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

export function EvalTaskRail({
  tasks,
  selectedTaskId,
  locale,
  onSelect,
  t,
}: {
  tasks: readonly EvalGenerationTask[]
  selectedTaskId: string | null
  locale: string
  onSelect: (taskId: string) => void
  t: TFunction<"evals">
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-border-strong bg-sidebar">
      <div className="shrink-0 border-b border-border-subtle px-4 py-3.5">
        <div className="ui-label">
          {t("tasks.eyebrow")}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-[760]">{t("tasks.title")}</h2>
          <span className="ui-meta">
            {String(tasks.length).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {tasks.length === 0 ? (
          <div className="border border-dashed border-rule p-5 text-center">
            <Clock3 className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("tasks.empty")}
            </p>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {tasks.map((task) => (
              <button
                className={cn(
                  "w-full border px-3 py-3 text-left transition-colors",
                  selectedTaskId === task.id
                    ? "border-primary bg-accent shadow-[inset_3px_0_0_var(--primary)]"
                    : "border-transparent hover:border-rule hover:bg-paper-raised",
                )}
                key={task.id}
                onClick={() => onSelect(task.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold uppercase">
                    <StatusIcon status={task.status} />
                    {t(`status.${task.status}`)}
                  </span>
                  <time className="shrink-0 font-mono text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(locale, {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(task.createdAt))}
                  </time>
                </div>
                <strong className="mt-2 block truncate text-[13px]">
                  {task.target.skillName}
                </strong>
                <div className="ui-meta mt-1 flex items-center justify-between gap-2">
                  <span>
                    {task.target.sourceKind === "DRAFT_REVISION"
                      ? t("tasks.draftTarget")
                      : t("tasks.versionTarget")}
                  </span>
                  <span>{t("tasks.caseLimit", { count: task.maxEvalCount })}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
