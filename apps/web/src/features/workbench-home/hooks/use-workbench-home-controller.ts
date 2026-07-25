import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  createSkillWorkspace,
  listSkillWorkspaces,
} from "@/features/workbench-home/api/skill-workspaces-api"
import {
  createEmptyRuntimeDefaults,
  createEmptyWorkbenchDraft,
  createSelectedSkillSource,
  SourceSelectionError,
  validateWorkbenchDraft,
  type CreateWorkbenchDraft,
  type CreateWorkbenchErrors,
  type RuntimeDefaults,
  type SkillSourceKind,
  type SkillWorkspace,
} from "@/features/workbench-home/model/workbench"
import {
  getWorkbenchHomeCopy,
  type WorkbenchHomeCopy,
} from "@/features/workbench-home/model/workbench-home-copy"
import { usePreferencesStore } from "@/shared/stores/preferences/preferences-store"
import type { AppLocale } from "@/shared/types/locale"
import { SkillConsoleApiError } from "@/shared/api/http"

const workspacesQueryKey = ["skill-workspaces"] as const

export interface WorkbenchHomeController {
  locale: AppLocale
  copy: WorkbenchHomeCopy
  workspaces: SkillWorkspace[]
  activeWorkspace: SkillWorkspace | null
  workspaceList: {
    loading: boolean
    error: boolean
  }
  createDialog: {
    open: boolean
    draft: CreateWorkbenchDraft
    errors: CreateWorkbenchErrors
    submitting: boolean
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
    selectSource: (files: readonly File[]) => void
    createWorkspace: () => Promise<SkillWorkspace | null>
    retryWorkspaceList: () => void
    openSettingsDialog: () => void
    closeSettingsDialog: () => void
    updateRuntimeDefaults: (values: RuntimeDefaults) => void
    saveRuntimeDefaults: () => RuntimeDefaults
  }
}

export function useWorkbenchHomeController(
  activeWorkspaceId: string | null,
): WorkbenchHomeController {
  const queryClient = useQueryClient()
  const { t: translateCommon } = useTranslation("common")
  const { t: translateWorkbenchHome } = useTranslation("workbenchHome")
  const locale = usePreferencesStore((state) => state.locale)
  const setLocale = usePreferencesStore((state) => state.setLocale)
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false)
  const [draft, setDraft] = useState<CreateWorkbenchDraft>(
    createEmptyWorkbenchDraft,
  )
  const [errors, setErrors] = useState<CreateWorkbenchErrors>({})
  const [isSettingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [runtimeDefaults, setRuntimeDefaults] = useState<RuntimeDefaults>(
    createEmptyRuntimeDefaults,
  )
  const createOperationIdRef = useRef<string | null>(null)

  const workspaceQuery = useQuery({
    queryKey: workspacesQueryKey,
    queryFn: listSkillWorkspaces,
  })
  const workspaces = workspaceQuery.data ?? []
  const createMutation = useMutation({
    mutationFn: ({
      currentDraft,
      operationId,
    }: {
      currentDraft: CreateWorkbenchDraft
      operationId: string
    }) => createSkillWorkspace(currentDraft, operationId),
    onSuccess: ({ workspace }) => {
      queryClient.setQueryData<SkillWorkspace[]>(
        workspacesQueryKey,
        (current = []) => [
          workspace,
          ...current.filter((item) => item.id !== workspace.id),
        ],
      )
      setCreateDialogOpen(false)
      setDraft(createEmptyWorkbenchDraft())
      setErrors({})
      createOperationIdRef.current = null
    },
  })

  const copy = useMemo(
    () =>
      getWorkbenchHomeCopy(translateCommon, translateWorkbenchHome),
    [translateCommon, translateWorkbenchHome],
  )
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  function openCreateDialog() {
    setDraft(createEmptyWorkbenchDraft())
    setErrors({})
    createMutation.reset()
    createOperationIdRef.current = null
    setCreateDialogOpen(true)
  }

  function closeCreateDialog() {
    if (createMutation.isPending) return
    setCreateDialogOpen(false)
    setErrors({})
    createOperationIdRef.current = null
  }

  function updateWorkbenchName(name: string) {
    setDraft((current) => ({ ...current, name }))
    setErrors((current) => ({ ...current, name: undefined, upload: undefined }))
    createOperationIdRef.current = null
  }

  function updateSourceKind(sourceKind: SkillSourceKind) {
    setDraft((current) => ({
      ...current,
      sourceKind,
      source: null,
    }))
    setErrors((current) => ({ ...current, source: undefined, upload: undefined }))
    createOperationIdRef.current = null
  }

  function selectSource(files: readonly File[]) {
    try {
      const source = createSelectedSkillSource(draft.sourceKind, files)
      setDraft((current) => ({ ...current, source }))
      setErrors((current) => ({
        ...current,
        source: undefined,
        upload: undefined,
      }))
      createOperationIdRef.current = null
    } catch (error) {
      if (error instanceof SourceSelectionError) {
        setDraft((current) => ({ ...current, source: null }))
        setErrors((current) => ({ ...current, source: error.code }))
        return
      }

      throw error
    }
  }

  async function createWorkspace(): Promise<SkillWorkspace | null> {
    const validationErrors = validateWorkbenchDraft(draft)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return null

    try {
      createOperationIdRef.current ??= crypto.randomUUID()
      const response = await createMutation.mutateAsync({
        currentDraft: draft,
        operationId: createOperationIdRef.current,
      })
      return response.workspace
    } catch (error) {
      const message =
        error instanceof SkillConsoleApiError
          ? error.message
          : copy.unknownCreateError
      setErrors((current) => ({ ...current, upload: message }))
      return null
    }
  }

  function saveRuntimeDefaults() {
    setSettingsDialogOpen(false)
    return runtimeDefaults
  }

  return {
    locale,
    copy,
    workspaces,
    activeWorkspace,
    workspaceList: {
      loading: workspaceQuery.isPending,
      error: workspaceQuery.isError,
    },
    createDialog: {
      open: isCreateDialogOpen,
      draft,
      errors,
      submitting: createMutation.isPending,
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
      createWorkspace,
      retryWorkspaceList: () => {
        void workspaceQuery.refetch()
      },
      openSettingsDialog: () => setSettingsDialogOpen(true),
      closeSettingsDialog: () => setSettingsDialogOpen(false),
      updateRuntimeDefaults: setRuntimeDefaults,
      saveRuntimeDefaults,
    },
  }
}
