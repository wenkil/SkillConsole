import {
  CheckCircle2,
  CircleDashed,
  CircleX,
  LoaderCircle,
  OctagonAlert,
} from "lucide-react"
import type { TFunction } from "i18next"

import {
  isActiveTestRun,
  type TestRunStatus,
} from "@/features/test-runs/model/test-run"
import { cn } from "@/shared/lib/utils"

export function TestRunStatusBadge({
  status,
  t,
}: {
  status: TestRunStatus
  t: TFunction<"testRuns">
}) {
  const Icon = isActiveTestRun(status)
    ? LoaderCircle
    : status === "COMPLETED"
      ? CheckCircle2
      : status === "FAILED"
        ? OctagonAlert
        : status === "INTERRUPTED"
          ? CircleDashed
          : CircleX
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-xs leading-4 font-bold",
        isActiveTestRun(status) &&
          "border-status-running/55 text-status-running",
        status === "COMPLETED" &&
          "border-status-passed/55 text-status-passed",
        status === "FAILED" &&
          "border-status-failed/55 text-status-failed",
        status === "INTERRUPTED" &&
          "border-status-blocked/55 text-status-blocked",
        status === "CANCELED" &&
          "border-status-cancelled/55 text-status-cancelled",
      )}
    >
      <Icon
        className={cn(
          "size-3.5",
          isActiveTestRun(status) && "animate-spin",
        )}
      />
      {t(`status.${status}`)}
    </span>
  )
}
