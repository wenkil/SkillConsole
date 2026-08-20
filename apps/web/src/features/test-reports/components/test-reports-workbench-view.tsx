import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import { SkillScoreReportsPanel } from "@/features/test-reports/components/skill-score-reports-panel"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { WorkbenchPageHeader } from "@/shared/components/layout/workbench-page-header"

export function TestReportsWorkbenchView({
  workspace,
  locale,
}: {
  workspace: SkillWorkspace
  locale: string
}) {
  const { t } = useTranslation("testReports")
  const [searchParams] = useSearchParams()

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <WorkbenchPageHeader
        description={t("header.description", { name: workspace.name })}
        title={t("header.title")}
      />

      <SkillScoreReportsPanel
        initialReportId={searchParams.get("reportId")}
        locale={locale}
        workspaceId={workspace.id}
      />
    </main>
  )
}
