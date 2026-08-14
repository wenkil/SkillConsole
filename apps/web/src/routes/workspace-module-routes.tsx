import {
  Database,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"

import { VersionBrowserView } from "@/features/version-browser/components/version-browser-view"
import { VersionCompareView } from "@/features/version-browser/components/version-compare-view"
import { EvalsWorkbenchView } from "@/features/evals/components/evals-workbench-view"
import { TestRunDetailView } from "@/features/test-runs/components/test-run-detail-view"
import { TestRunsWorkbenchView } from "@/features/test-runs/components/test-runs-workbench-view"
import {
  TestReportByRunRedirect,
  TestReportDetailView,
} from "@/features/test-reports/components/test-report-detail-view"
import { TestReportsWorkbenchView } from "@/features/test-reports/components/test-reports-workbench-view"
import type { SkillBrowserTarget } from "@/features/version-browser/model/version-browser"
import { WorkbenchOverview } from "@/features/workbench-home/components/workbench-overview"
import { ModulePlaceholder } from "@/features/workspace-shell/components/module-placeholder"
import type { WorkspaceModule } from "@/features/workspace-shell/components/workspace-navigation"
import { useAppLayoutContext } from "@/routes/app-layout-context"
import { useWorkspaceRouteContext } from "@/routes/workspace-route-context"

export function WorkbenchOverviewRoute() {
  const { controller } = useAppLayoutContext()
  const { workspace, locale } = useWorkspaceRouteContext()

  return (
    <WorkbenchOverview
      copy={controller.copy}
      locale={locale}
      workspace={workspace}
    />
  )
}

export function EvalsWorkbenchRoute() {
  const { workspace, locale } = useWorkspaceRouteContext()
  return <EvalsWorkbenchView locale={locale} workspace={workspace} />
}

export function TestRunsWorkbenchRoute() {
  const { workspace, locale } = useWorkspaceRouteContext()
  return <TestRunsWorkbenchView locale={locale} workspace={workspace} />
}

export function TestRunDetailRoute() {
  const { runId } = useParams()
  const { workspace, locale } = useWorkspaceRouteContext()
  if (!runId) {
    return <Navigate replace to={`/workbenches/${workspace.id}/runs`} />
  }
  return (
    <TestRunDetailView
      locale={locale}
      runId={runId}
      workspace={workspace}
    />
  )
}

export function TestReportsWorkbenchRoute() {
  const { workspace, locale } = useWorkspaceRouteContext()
  return <TestReportsWorkbenchView locale={locale} workspace={workspace} />
}

export function TestReportDetailRoute() {
  const { reportId } = useParams()
  const { workspace, locale } = useWorkspaceRouteContext()
  if (!reportId) {
    return <Navigate replace to={`/workbenches/${workspace.id}/reports`} />
  }
  return (
    <TestReportDetailView
      locale={locale}
      reportId={reportId}
      workspace={workspace}
    />
  )
}

export function TestReportByRunRoute() {
  const { runId } = useParams()
  const { workspace } = useWorkspaceRouteContext()
  if (!runId) {
    return <Navigate replace to={`/workbenches/${workspace.id}/runs`} />
  }
  return <TestReportByRunRedirect runId={runId} workspace={workspace} />
}

function getVersionTargetPath(
  workspaceId: string,
  target: Pick<SkillBrowserTarget, "kind" | "id">,
  selectedFilePath: string | null,
): string {
  const basePath =
    target.kind === "draft"
      ? `/workbenches/${workspaceId}/versions`
      : `/workbenches/${workspaceId}/versions/${target.id}`
  return selectedFilePath
    ? `${basePath}?path=${encodeURIComponent(selectedFilePath)}`
    : basePath
}

export function VersionBrowserRoute({
  comparison = false,
}: {
  comparison?: boolean
}) {
  const navigate = useNavigate()
  const { versionId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { workspace } = useWorkspaceRouteContext()
  const selectedFilePath = searchParams.get("path")

  if (comparison) {
    return <VersionCompareView workspace={workspace} />
  }

  return (
    <VersionBrowserView
      onFileSelect={(relativePath) => {
        setSearchParams({ path: relativePath }, { replace: true })
      }}
      onTargetSelect={(target) =>
        navigate(
          getVersionTargetPath(
            workspace.id,
            target,
            selectedFilePath,
          ),
        )
      }
      selectedFilePath={selectedFilePath}
      selectedVersionId={versionId ?? null}
      workspace={workspace}
    />
  )
}

interface ModulePlaceholderRouteProps {
  module: Extract<WorkspaceModule, "datasets">
}

export function ModulePlaceholderRoute({
  module,
}: ModulePlaceholderRouteProps) {
  const { t } = useTranslation("workbenchHome")
  const definitions = {
    datasets: {
      icon: Database,
      title: t("workspaceShell.navigation.datasets"),
      description: t("workspaceShell.placeholders.datasets.description"),
      plannedStage: t(
        "workspaceShell.placeholders.datasets.plannedStage",
      ),
    },
  } as const
  const definition = definitions[module]

  return (
    <ModulePlaceholder
      description={definition.description}
      eyebrow={t("workspaceShell.moduleEyebrow")}
      icon={definition.icon}
      plannedLabel={t("workspaceShell.placeholders.plannedLabel")}
      plannedStage={definition.plannedStage}
      status={t("workspaceShell.placeholders.status")}
      title={definition.title}
    />
  )
}

export function WorkspaceFallbackRoute() {
  const { workspaceId } = useParams()
  return <Navigate replace to={`/workbenches/${workspaceId}`} />
}
