import { useTranslation } from "react-i18next"

import type { TestReportStatus } from "@/features/test-reports/model/test-report"
import { cn } from "@/shared/lib/utils"

export function TestReportStatusBadge({ status }: { status: TestReportStatus }) {
  const { t } = useTranslation("testReports")
  return (
    <span
      className={cn(
        "inline-flex border px-2 py-1 font-mono text-[9px] font-bold tracking-[0.04em]",
        status === "AVAILABLE" &&
          "border-status-passed/55 text-status-passed",
        status === "PARTIAL" &&
          "border-status-blocked/55 text-status-blocked",
        status === "GENERATION_PENDING" &&
          "border-technical/55 text-technical",
        (status === "GENERATION_FAILED" || status === "UNAVAILABLE") &&
          "border-status-failed/55 text-status-failed",
      )}
    >
      {t(`status.${status}`)}
    </span>
  )
}
