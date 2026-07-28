import {
  Activity,
  Database,
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

export function VersionBrowserRoute() {
  const navigate = useNavigate()
  const { versionId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { workspace, locale } = useWorkspaceRouteContext()
  const selectedFilePath = searchParams.get("path")

  return (
    <VersionBrowserView
      locale={locale}
      onDraftAbandoned={() => navigate(`/workbenches/${workspace.id}`)}
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
  module: Extract<WorkspaceModule, "test-cases" | "datasets" | "runs">
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
