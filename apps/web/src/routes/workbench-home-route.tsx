import { useNavigate } from "react-router-dom"

import { WorkbenchHomeView } from "@/features/workbench-home/components/workbench-home-view"
import { WorkbenchSidebar } from "@/features/workbench-home/components/workbench-sidebar"
import { useAppLayoutContext } from "@/routes/app-layout-context"
import { ApplicationFrame } from "@/shared/components/layout/application-frame"

export function WorkbenchHomeRoute() {
  const navigate = useNavigate()
  const { controller } = useAppLayoutContext()
  const { actions, copy } = controller

  return (
    <ApplicationFrame
      sidebar={
        <WorkbenchSidebar
          activeWorkspaceId={null}
          copy={copy}
          error={controller.workspaceList.error}
          loading={controller.workspaceList.loading}
          onRetry={actions.retryWorkspaceList}
          onWorkspaceSelect={(workspaceId) =>
            navigate(`/workbenches/${workspaceId}`)
          }
          workspaces={controller.workspaces}
        />
      }
    >
      <WorkbenchHomeView
        copy={copy}
        onCreateWorkbench={actions.openCreateDialog}
      />
    </ApplicationFrame>
  )
}
