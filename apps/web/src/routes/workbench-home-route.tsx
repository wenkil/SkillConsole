import { toast } from "sonner"

import { CreateWorkbenchDialog } from "@/features/workbench-home/components/create-workbench-dialog"
import { RuntimeSettingsDialog } from "@/features/workbench-home/components/runtime-settings-dialog"
import { WorkbenchHomeView } from "@/features/workbench-home/components/workbench-home-view"
import { WorkbenchOverview } from "@/features/workbench-home/components/workbench-overview"
import { WorkbenchSidebar } from "@/features/workbench-home/components/workbench-sidebar"
import { useWorkbenchHomeController } from "@/features/workbench-home/hooks/use-workbench-home-controller"
import { AppHeader } from "@/shared/components/layout/app-header"
import { ApplicationFrame } from "@/shared/components/layout/application-frame"

export function WorkbenchHomeRoute() {
  const controller = useWorkbenchHomeController()
  const { actions, copy } = controller

  async function handleCreateWorkspace() {
    const workspace = await actions.createWorkspace()
    if (workspace) {
      toast.success(copy.workspaceCreated, {
        description: workspace.name,
      })
    }
  }

  function handleSaveSettings() {
    actions.saveRuntimeDefaults()
    toast.success(copy.settingsSaved)
  }

  return (
    <>
      <AppHeader
        locale={controller.locale}
        onLocaleChange={actions.changeLocale}
        onSettingsClick={actions.openSettingsDialog}
        settingsLabel={copy.settings}
      />

      <ApplicationFrame
        sidebar={
          <WorkbenchSidebar
            activeWorkspaceId={controller.activeWorkspace?.id ?? null}
            copy={copy}
            error={controller.workspaceList.error}
            loading={controller.workspaceList.loading}
            onRetry={actions.retryWorkspaceList}
            onWorkspaceSelect={actions.openWorkspace}
            workspaces={controller.workspaces}
          />
        }
      >
        {controller.activeWorkspace ? (
          <WorkbenchOverview
            copy={copy}
            locale={controller.locale}
            onBack={actions.closeWorkspace}
            workspace={controller.activeWorkspace}
          />
        ) : (
          <WorkbenchHomeView
            copy={copy}
            onCreateWorkbench={actions.openCreateDialog}
          />
        )}
      </ApplicationFrame>

      <CreateWorkbenchDialog
        copy={copy}
        draft={controller.createDialog.draft}
        errors={controller.createDialog.errors}
        onNameChange={actions.updateWorkbenchName}
        onOpenChange={(open) => {
          if (open) actions.openCreateDialog()
          else actions.closeCreateDialog()
        }}
        onSourceKindChange={actions.updateSourceKind}
        onSourceSelect={actions.selectSource}
        onSubmit={() => {
          void handleCreateWorkspace()
        }}
        open={controller.createDialog.open}
        submitting={controller.createDialog.submitting}
      />

      <RuntimeSettingsDialog
        copy={copy}
        onOpenChange={(open) => {
          if (open) actions.openSettingsDialog()
          else actions.closeSettingsDialog()
        }}
        onSubmit={handleSaveSettings}
        onValuesChange={actions.updateRuntimeDefaults}
        open={controller.settingsDialog.open}
        values={controller.settingsDialog.values}
      />
    </>
  )
}
