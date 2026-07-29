import {
  Activity,
  Database,
  FileChartColumn,
  FlaskConical,
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
  module: Extract<
    WorkspaceModule,
    "test-cases" | "datasets" | "runs" | "reports"
  >
}

export function ModulePlaceholderRoute({
  module,
}: ModulePlaceholderRouteProps) {
  const { t } = useTranslation("workbenchHome")
  const definitions = {
    "test-cases": {
      icon: FlaskConical,
      title: t("workspaceShell.navigation.testCases"),
      description: t("workspaceShell.placeholders.testCases.description"),
      plannedStage: t(
        "workspaceShell.placeholders.testCases.plannedStage",
      ),
    },
    datasets: {
      icon: Database,
      title: t("workspaceShell.navigation.datasets"),
      description: t("workspaceShell.placeholders.datasets.description"),
      plannedStage: t(
        "workspaceShell.placeholders.datasets.plannedStage",
      ),
    },
    runs: {
      icon: Activity,
      title: t("workspaceShell.navigation.runs"),
      description: t("workspaceShell.placeholders.runs.description"),
      plannedStage: t("workspaceShell.placeholders.runs.plannedStage"),
    },
    reports: {
      icon: FileChartColumn,
      title: t("workspaceShell.navigation.reports", {
        defaultValue: "对比报告",
      }),
      description: t(
        "workspaceShell.placeholders.reports.description",
        {
          defaultValue:
            "汇总版本目录差异、测试点、任务结果和版本标签。",
        },
      ),
      plannedStage: t(
        "workspaceShell.placeholders.reports.plannedStage",
        { defaultValue: "后续迭代" },
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
