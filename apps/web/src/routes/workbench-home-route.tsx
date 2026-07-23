import { toast } from "sonner"

import { CreateWorkbenchDialog } from "@/features/workbench-home/components/create-workbench-dialog"
import { ProjectSidebar } from "@/features/workbench-home/components/project-sidebar"
import { RuntimeSettingsDialog } from "@/features/workbench-home/components/runtime-settings-dialog"
import { WorkbenchDetailPlaceholder } from "@/features/workbench-home/components/workbench-detail-placeholder"
import { WorkbenchHomeView } from "@/features/workbench-home/components/workbench-home-view"
import { useWorkbenchHomeController } from "@/features/workbench-home/hooks/use-workbench-home-controller"
import { AppHeader } from "@/shared/components/layout/app-header"
import { ApplicationFrame } from "@/shared/components/layout/application-frame"

export function WorkbenchHomeRoute() {
  const controller = useWorkbenchHomeController()
  const { actions, copy } = controller

  function handleCreateProject() {
    const project = actions.createProject()
    if (project) {
      toast.success(copy.projectCreated, {
        description: project.name,
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
          <ProjectSidebar
            activeProjectId={controller.activeProject?.id ?? null}
            copy={copy}
            onProjectSelect={actions.openProject}
            projects={controller.projects}
          />
        }
      >
        {controller.activeProject ? (
          <WorkbenchDetailPlaceholder
            copy={copy}
            onBack={actions.closeProject}
            project={controller.activeProject}
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
        onSubmit={handleCreateProject}
        open={controller.createDialog.open}
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
