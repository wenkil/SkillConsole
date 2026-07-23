import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  createEmptyRuntimeDefaults,
  createEmptyWorkbenchDraft,
  createWorkbenchProject,
  validateWorkbenchDraft,
  type CreateWorkbenchDraft,
  type CreateWorkbenchErrors,
  type RuntimeDefaults,
  type SkillSourceKind,
  type WorkbenchProject,
} from "@/features/workbench-home/model/workbench"
import {
  getWorkbenchHomeCopy,
  type WorkbenchHomeCopy,
} from "@/features/workbench-home/model/workbench-home-copy"
import { usePreferencesStore } from "@/shared/stores/preferences/preferences-store"
import type { AppLocale } from "@/shared/types/locale"

export interface WorkbenchHomeController {
  locale: AppLocale
  copy: WorkbenchHomeCopy
  projects: WorkbenchProject[]
  activeProject: WorkbenchProject | null
  createDialog: {
    open: boolean
    draft: CreateWorkbenchDraft
    errors: CreateWorkbenchErrors
  }
  settingsDialog: {
    open: boolean
    values: RuntimeDefaults
  }
  actions: {
    changeLocale: (locale: AppLocale) => void
    openCreateDialog: () => void
    closeCreateDialog: () => void
    updateWorkbenchName: (name: string) => void
    updateSourceKind: (kind: SkillSourceKind) => void
    selectSource: (sourceName: string) => void
    createProject: () => WorkbenchProject | null
    openProject: (projectId: string) => void
    closeProject: () => void
    openSettingsDialog: () => void
    closeSettingsDialog: () => void
    updateRuntimeDefaults: (values: RuntimeDefaults) => void
    saveRuntimeDefaults: () => RuntimeDefaults
  }
}

export function useWorkbenchHomeController(): WorkbenchHomeController {
  const { t: translateCommon } = useTranslation("common")
  const { t: translateWorkbenchHome } = useTranslation("workbenchHome")
  const locale = usePreferencesStore((state) => state.locale)
  const setLocale = usePreferencesStore((state) => state.setLocale)
  const [projects, setProjects] = useState<WorkbenchProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false)
  const [draft, setDraft] = useState<CreateWorkbenchDraft>(
    createEmptyWorkbenchDraft,
  )
  const [errors, setErrors] = useState<CreateWorkbenchErrors>({})
  const [isSettingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [runtimeDefaults, setRuntimeDefaults] = useState<RuntimeDefaults>(
    createEmptyRuntimeDefaults,
  )

  const copy = useMemo(
    () =>
      getWorkbenchHomeCopy(translateCommon, translateWorkbenchHome),
    [translateCommon, translateWorkbenchHome],
  )
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null

  function openCreateDialog() {
    setDraft(createEmptyWorkbenchDraft())
    setErrors({})
    setCreateDialogOpen(true)
  }

  function closeCreateDialog() {
    setCreateDialogOpen(false)
    setErrors({})
  }

  function updateWorkbenchName(name: string) {
    setDraft((current) => ({ ...current, name }))
    setErrors((current) => ({ ...current, name: undefined }))
  }

  function updateSourceKind(sourceKind: SkillSourceKind) {
    setDraft((current) => ({
      ...current,
      sourceKind,
      sourceName: null,
    }))
    setErrors((current) => ({ ...current, source: undefined }))
  }

  function selectSource(sourceName: string) {
    setDraft((current) => ({ ...current, sourceName }))
    setErrors((current) => ({ ...current, source: undefined }))
  }

  function createProject() {
    const validationErrors = validateWorkbenchDraft(draft)
    setErrors(validationErrors)

    if (Object.keys(validationErrors).length > 0) {
      return null
    }

    const project = createWorkbenchProject(draft, {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    })

    setProjects((current) => [project, ...current])
    setCreateDialogOpen(false)
    setDraft(createEmptyWorkbenchDraft())
    return project
  }

  function openProject(projectId: string) {
    setActiveProjectId(projectId)
  }

  function closeProject() {
    setActiveProjectId(null)
  }

  function saveRuntimeDefaults() {
    setSettingsDialogOpen(false)
    return runtimeDefaults
  }

  return {
    locale,
    copy,
    projects,
    activeProject,
    createDialog: {
      open: isCreateDialogOpen,
      draft,
      errors,
    },
    settingsDialog: {
      open: isSettingsDialogOpen,
      values: runtimeDefaults,
    },
    actions: {
      changeLocale: setLocale,
      openCreateDialog,
      closeCreateDialog,
      updateWorkbenchName,
      updateSourceKind,
      selectSource,
      createProject,
      openProject,
      closeProject,
      openSettingsDialog: () => setSettingsDialogOpen(true),
      closeSettingsDialog: () => setSettingsDialogOpen(false),
      updateRuntimeDefaults: setRuntimeDefaults,
      saveRuntimeDefaults,
    },
  }
}
