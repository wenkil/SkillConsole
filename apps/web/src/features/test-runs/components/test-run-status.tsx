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
        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-xs leading-4 font-bold",
        isActiveTestRun(status) &&
          "border-status-running/25 bg-status-running/10 text-status-running",
        status === "COMPLETED" &&
          "border-status-passed/25 bg-status-passed/10 text-status-passed",
        status === "FAILED" &&
          "border-status-failed/25 bg-status-failed/10 text-status-failed",
        status === "INTERRUPTED" &&
          "border-status-blocked/25 bg-status-blocked/10 text-status-blocked",
        status === "CANCELED" &&
          "border-status-cancelled/25 bg-status-cancelled/10 text-status-cancelled",
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
