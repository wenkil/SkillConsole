import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  createSkillWorkspace,
  getUploadFolderIgnorePolicy,
  listSkillWorkspaces,
} from "@/features/workbench-home/api/skill-workspaces-api"
import {
  createEmptyWorkbenchDraft,
  createSelectedSkillSource,
  SourceSelectionError,
  validateWorkbenchDraft,
  type CreateSkillSourceKind,
  type CreateWorkbenchDraft,
  type CreateWorkbenchErrors,
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
const uploadPolicyQueryKey = ["skill-workspace-upload-policy"] as const

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
    folderPolicyStatus: "loading" | "ready" | "error"
  }
  actions: {
    changeLocale: (locale: AppLocale) => void
    openCreateDialog: () => void
    closeCreateDialog: () => void
    updateWorkbenchName: (name: string) => void
    updateSourceKind: (kind: CreateSkillSourceKind) => void
    selectSource: (files: readonly File[]) => void
    createWorkspace: () => Promise<SkillWorkspace | null>
    retryWorkspaceList: () => void
  }
}

export function useWorkbenchHomeController(
  activeWorkspaceId: string | null,
): WorkbenchHomeController {
  const queryClient = useQueryClient()
  const {
    i18n,
    t: translateWorkbenchHome,
  } = useTranslation("workbenchHome")
  const locale = usePreferencesStore((state) => state.locale)
  const setLocale = usePreferencesStore((state) => state.setLocale)
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false)
  const [draft, setDraft] = useState<CreateWorkbenchDraft>(
    createEmptyWorkbenchDraft,
  )
  const [errors, setErrors] = useState<CreateWorkbenchErrors>({})
  const createOperationIdRef = useRef<string | null>(null)

  const workspaceQuery = useQuery({
    queryKey: workspacesQueryKey,
    queryFn: listSkillWorkspaces,
  })
  const uploadPolicyQuery = useQuery({
    queryKey: uploadPolicyQueryKey,
    queryFn: getUploadFolderIgnorePolicy,
    staleTime: Number.POSITIVE_INFINITY,
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
      getWorkbenchHomeCopy(translateWorkbenchHome),
    [i18n.resolvedLanguage, translateWorkbenchHome],
  )
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  function openCreateDialog() {
    setDraft(createEmptyWorkbenchDraft())
    setErrors({})
    createMutation.reset()
    if (uploadPolicyQuery.isError) {
      void uploadPolicyQuery.refetch()
    }
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

  function updateSourceKind(sourceKind: CreateSkillSourceKind) {
    setDraft((current) => ({
      ...current,
      sourceKind,
      source: null,
    }))
    setErrors((current) => ({ ...current, source: undefined, upload: undefined }))
    createOperationIdRef.current = null
  }

  function selectSource(files: readonly File[]) {
    setErrors((current) => ({
      ...current,
      source: undefined,
      upload: undefined,
    }))
    try {
      const source = createSelectedSkillSource(
        draft.sourceKind,
        files,
        uploadPolicyQuery.data,
      )
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
          ? error.code === "UPLOAD_FILE_COUNT_EXCEEDED"
            ? copy.fileCountExceeded
            : error.message
          : copy.unknownCreateError
      setErrors((current) => ({ ...current, upload: message }))
      return null
    }
  }

  let folderPolicyStatus: "loading" | "ready" | "error" = "loading"
  if (uploadPolicyQuery.data) {
    folderPolicyStatus = "ready"
  } else if (uploadPolicyQuery.isError) {
    folderPolicyStatus = "error"
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
      folderPolicyStatus,
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
    },
  }
}
