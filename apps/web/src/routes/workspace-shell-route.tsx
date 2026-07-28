import { LoaderCircle, PackageOpen, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom"

import {
  WorkspaceNavigation,
  type WorkspaceModule,
} from "@/features/workspace-shell/components/workspace-navigation"
import { useAppLayoutContext } from "@/routes/app-layout-context"
import { ApplicationFrame } from "@/shared/components/layout/application-frame"
import { Button } from "@/shared/components/ui/button"

const workspaceNavigationStorageKey =
  "skillconsole:workspace-navigation-collapsed"

function readStoredCollapsedState(): boolean {
  try {
    return localStorage.getItem(workspaceNavigationStorageKey) === "true"
  } catch {
    return false
  }
}

function getActiveModule(pathname: string): WorkspaceModule {
  if (pathname.includes("/versions")) return "versions"
  if (pathname.includes("/test-cases")) return "test-cases"
  if (pathname.includes("/datasets")) return "datasets"
  if (pathname.includes("/runs")) return "runs"
  return "overview"
}

export function WorkspaceShellRoute() {
  const { workspaceId } = useParams()
  const location = useLocation()
  const { t } = useTranslation("workbenchHome")
  const { controller } = useAppLayoutContext()
  const [collapsed, setCollapsed] = useState(readStoredCollapsedState)
  const workspace =
    controller.workspaces.find((item) => item.id === workspaceId) ?? null

  useEffect(() => {
    try {
      localStorage.setItem(
        workspaceNavigationStorageKey,
        String(collapsed),
      )
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }, [collapsed])

  if (controller.workspaceList.loading) {
    return (
      <ApplicationFrame>
        <main className="flex h-full min-h-0 items-center justify-center">
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            {t("workspaceShell.loading")}
          </div>
        </main>
      </ApplicationFrame>
    )
  }

  if (controller.workspaceList.error) {
    return (
      <ApplicationFrame>
        <main className="flex h-full min-h-0 items-center justify-center px-8">
          <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
            <PackageOpen
              aria-hidden="true"
              className="mx-auto mb-3 size-8 text-destructive"
            />
            <strong className="block">
              {t("workspaceShell.loadError")}
            </strong>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("workspaceShell.loadErrorDescription")}
            </p>
            <Button
              className="mt-4 rounded-none"
              onClick={controller.actions.retryWorkspaceList}
              type="button"
              variant="outline"
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t("workspaceShell.retry")}
            </Button>
          </div>
        </main>
      </ApplicationFrame>
    )
  }

  if (!workspace) {
    return <Navigate replace to="/" />
  }

  return (
    <ApplicationFrame
      sidebar={
        <WorkspaceNavigation
          activeModule={getActiveModule(location.pathname)}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          workspace={workspace}
        />
      }
      sidebarCollapsed={collapsed}
    >
      <Outlet
        context={{
          workspace,
          locale: controller.locale,
        }}
      />
    </ApplicationFrame>
  )
}
