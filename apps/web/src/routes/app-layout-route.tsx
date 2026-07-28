import { Outlet, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { CreateWorkbenchDialog } from "@/features/workbench-home/components/create-workbench-dialog"
import { RuntimeSettingsDialog } from "@/features/workbench-home/components/runtime-settings-dialog"
import {
  useWorkbenchHomeController,
} from "@/features/workbench-home/hooks/use-workbench-home-controller"
import { AppLayoutContext } from "@/routes/app-layout-context"
import { AppHeader } from "@/shared/components/layout/app-header"

export function AppLayoutRoute() {
  const navigate = useNavigate()
  const controller = useWorkbenchHomeController(null)
  const { actions, copy } = controller

  async function handleCreateWorkspace() {
    const workspace = await actions.createWorkspace()
    if (!workspace) return

    toast.success(copy.workspaceCreated, {
      description: workspace.name,
    })
    navigate(`/workbenches/${workspace.id}`)
  }

  function handleSaveSettings() {
    actions.saveRuntimeDefaults()
    toast.success(copy.settingsSaved)
  }

  return (
    <AppLayoutContext.Provider value={{ controller }}>
      <AppHeader
        locale={controller.locale}
        onLocaleChange={actions.changeLocale}
        onSettingsClick={actions.openSettingsDialog}
        settingsLabel={copy.settings}
      />

      <Outlet />

      <CreateWorkbenchDialog
        copy={copy}
        draft={controller.createDialog.draft}
        errors={controller.createDialog.errors}
        folderPolicyStatus={controller.createDialog.folderPolicyStatus}
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
    </AppLayoutContext.Provider>
  )
}
