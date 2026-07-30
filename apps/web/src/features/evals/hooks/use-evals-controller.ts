import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  cancelEvalGeneration,
  discardEvalGenerationDraft,
  getEvalGeneration,
  getEvalGenerationDraft,
  listEvalGenerations,
  publishEvalGeneration,
  startEvalGeneration,
  subscribeToEvalGeneration,
} from "@/features/evals/api/evals-api"
import {
  isActiveEvalGeneration,
  type EvalGenerationDraft,
  type EvalGenerationEvent,
  type EvalGenerationTaskPage,
  type EvalGenerationTarget,
  type EvalGenerationTask,
} from "@/features/evals/model/evals"
import { listSkillVersions } from "@/features/version-browser/api/version-browser-api"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"

const maxVisibleEvents = 80

function taskListRootKey(workspaceId: string) {
  return ["skill-workspaces", workspaceId, "eval-generations"] as const
}

function taskListKey(workspaceId: string, page: number, pageSize: number) {
  return [...taskListRootKey(workspaceId), { page, pageSize }] as const
}

function getTargetKey(target: EvalGenerationTarget): string {
  return target.kind === "draft"
    ? `draft:${target.draftId}:${target.contentRevision}`
    : `version:${target.versionId}`
}

export function useEvalsController(workspace: SkillWorkspace) {
  const queryClient = useQueryClient()
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(
    null,
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [requestedTargetKey, setRequestedTargetKey] = useState("")
  const [maxEvalCount, setMaxEvalCount] = useState(5)
  const [generationBrief, setGenerationBrief] = useState("")
  const [eventState, setEventState] = useState<{
    readonly taskId: string | null
    readonly events: readonly EvalGenerationEvent[]
  }>({ taskId: null, events: [] })
  const startAttempt = useRef<{
    readonly signature: string
    readonly idempotencyKey: string
  } | null>(null)

  const tasksQuery = useQuery({
    queryKey: taskListKey(workspace.id, page, pageSize),
    queryFn: () => listEvalGenerations(workspace.id, page, pageSize),
  })
  const versionsQuery = useQuery({
    queryKey: ["skill-workspaces", workspace.id, "versions"],
    queryFn: () => listSkillVersions(workspace.id),
  })
  const tasks = tasksQuery.data?.items ?? []
  const selectedTaskId = requestedTaskId
  const taskFromList =
    tasks.find((task) => task.id === selectedTaskId) ?? null
  const selectedTaskQuery = useQuery({
    queryKey: ["eval-generations", selectedTaskId],
    queryFn: () => getEvalGeneration(selectedTaskId ?? ""),
    enabled: Boolean(selectedTaskId),
    ...(taskFromList ? { initialData: taskFromList } : {}),
  })
  const selectedTask = selectedTaskQuery.data ?? taskFromList
  const draftQuery = useQuery({
    queryKey: ["eval-generations", selectedTaskId, "draft"],
    queryFn: () => getEvalGenerationDraft(selectedTaskId ?? ""),
    enabled: Boolean(selectedTask?.draftId),
  })

  const targetOptions = useMemo(() => {
    const targets: Array<{
      key: string
      label: string
      target: EvalGenerationTarget
      kind: "draft" | "version"
    }> = []
    if (workspace.activeDraft) {
      const target: EvalGenerationTarget = {
        kind: "draft",
        draftId: workspace.activeDraft.id,
        contentRevision: workspace.activeDraft.contentRevision,
      }
      targets.push({
        key: getTargetKey(target),
        label: `R${workspace.activeDraft.contentRevision}`,
        target,
        kind: "draft",
      })
    }
    for (const version of versionsQuery.data ?? []) {
      const target: EvalGenerationTarget = {
        kind: "version",
        versionId: version.id,
      }
      targets.push({
        key: getTargetKey(target),
        label: version.name,
        target,
        kind: "version",
      })
    }
    return targets
  }, [versionsQuery.data, workspace.activeDraft])

  const onlineVersionKey = workspace.onlineVersion
    ? `version:${workspace.onlineVersion.id}`
    : null
  const selectedTargetKey =
    targetOptions.find((option) => option.key === requestedTargetKey)?.key ??
    targetOptions.find((option) => option.kind === "draft")?.key ??
    targetOptions.find((option) => option.key === onlineVersionKey)?.key ??
    targetOptions[0]?.key ??
    ""

  useEffect(() => {
    const taskId = selectedTask?.id
    if (!taskId) return
    let unsubscribe: () => void = () => undefined
    unsubscribe = subscribeToEvalGeneration(
      taskId,
      (event) => {
        setEventState((current) => {
          const currentEvents =
            current.taskId === taskId ? current.events : []
          if (
            currentEvents.some(
              (item) => item.sequence === event.sequence,
            )
          ) {
            return current
          }
          return {
            taskId,
            events: [...currentEvents, event]
              .sort((left, right) => left.sequence - right.sequence)
              .slice(-maxVisibleEvents),
          }
        })
        if (
          event.type.startsWith("task.") ||
          event.type.startsWith("validation.")
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["eval-generations", taskId],
          })
          void queryClient.invalidateQueries({
            queryKey: taskListRootKey(workspace.id),
          })
        }
        if (
          [
            "task.succeeded",
            "task.canceled",
            "task.interrupted",
            "task.failed",
          ].includes(event.type)
        ) {
          unsubscribe()
        }
      },
      () => {
        void queryClient.invalidateQueries({
          queryKey: ["eval-generations", taskId],
        })
      },
    )
    return unsubscribe
  }, [queryClient, selectedTask?.id, workspace.id])

  const startMutation = useMutation({
    mutationFn: () => {
      const option = targetOptions.find(
        (target) => target.key === selectedTargetKey,
      )
      if (!option) throw new Error("No Evals target is selected.")
      const input = {
        target: option.target,
        maxEvalCount,
        generationBrief: generationBrief.trim() || null,
      } as const
      const signature = JSON.stringify(input)
      if (startAttempt.current?.signature !== signature) {
        startAttempt.current = {
          signature,
          idempotencyKey: crypto.randomUUID(),
        }
      }
      return startEvalGeneration(
        workspace.id,
        input,
        startAttempt.current.idempotencyKey,
      )
    },
    onSuccess: (task) => {
      startAttempt.current = null
      queryClient.setQueryData<EvalGenerationTask>(
        ["eval-generations", task.id],
        task,
      )
      setPage(1)
      void queryClient.invalidateQueries({
        queryKey: taskListRootKey(workspace.id),
      })
      setRequestedTaskId(task.id)
      setEventState({ taskId: task.id, events: [] })
    },
  })
  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => cancelEvalGeneration(taskId),
    onSuccess: (task) => {
      queryClient.setQueryData(["eval-generations", task.id], task)
      void queryClient.invalidateQueries({
        queryKey: taskListRootKey(workspace.id),
      })
    },
  })
  const publishMutation = useMutation({
    mutationFn: (taskId: string) => publishEvalGeneration(taskId),
    onSuccess: (result, taskId) => {
      queryClient.setQueriesData<EvalGenerationTaskPage>(
        { queryKey: taskListRootKey(workspace.id) },
        (current) => {
          if (!current) return current
          const publishedTask = current.items.find(
            (task) => task.id === taskId && task.draftStatus === "READY",
          )
          return {
            ...current,
            items: current.items.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    draftStatus: "PUBLISHED" as const,
                    revisionNumber: result.revision.sequenceNumber,
                  }
                : task,
            ),
            summary: publishedTask
              ? {
                  ...current.summary,
                  awaitingReview: Math.max(
                    0,
                    current.summary.awaitingReview - 1,
                  ),
                  published: current.summary.published + 1,
                }
              : current.summary,
          }
        },
      )
      queryClient.setQueryData<EvalGenerationDraft | undefined>(
        ["eval-generations", taskId, "draft"],
        (current) =>
          current ? { ...current, status: "PUBLISHED" } : current,
      )
      queryClient.setQueryData<EvalGenerationTask | undefined>(
        ["eval-generations", taskId],
        (current) =>
          current
            ? {
                ...current,
                draftStatus: "PUBLISHED",
                revisionNumber: result.revision.sequenceNumber,
              }
            : current,
      )
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskListRootKey(workspace.id),
        }),
        queryClient.invalidateQueries({
          queryKey: ["eval-generations", taskId, "draft"],
        }),
      ])
    },
  })
  const discardMutation = useMutation({
    mutationFn: (taskId: string) =>
      discardEvalGenerationDraft(taskId),
    onSuccess: (draft, taskId) => {
      queryClient.setQueryData(
        ["eval-generations", taskId, "draft"],
        draft,
      )
      queryClient.setQueryData<EvalGenerationTask | undefined>(
        ["eval-generations", taskId],
        (current) =>
          current ? { ...current, draftStatus: "DISCARDED" } : current,
      )
      queryClient.setQueriesData<EvalGenerationTaskPage>(
        { queryKey: taskListRootKey(workspace.id) },
        (current) => {
          if (!current) return current
          const discardedTask = current.items.find(
            (task) => task.id === taskId && task.draftStatus === "READY",
          )
          return {
            ...current,
            items: current.items.map((task) =>
              task.id === taskId
                ? { ...task, draftStatus: "DISCARDED" as const }
                : task,
            ),
            summary: discardedTask
              ? {
                  ...current.summary,
                  awaitingReview: Math.max(
                    0,
                    current.summary.awaitingReview - 1,
                  ),
                }
              : current.summary,
          }
        },
      )
      void queryClient.invalidateQueries({
        queryKey: taskListRootKey(workspace.id),
      })
    },
  })

  const activeTask =
    tasksQuery.data?.items.find((task) =>
      isActiveEvalGeneration(task.status),
    ) ?? null
  const mutationError =
    startMutation.error ??
    cancelMutation.error ??
    publishMutation.error ??
    discardMutation.error

  return {
    tasks,
    taskPagination: tasksQuery.data?.pagination ?? {
      page,
      pageSize,
      total: 0,
      pageCount: 0,
    },
    taskSummary: tasksQuery.data?.summary ?? {
      total: 0,
      running: 0,
      awaitingReview: 0,
      published: 0,
      failed: 0,
    },
    selectedTask,
    selectedDraft: draftQuery.data ?? null,
    events:
      eventState.taskId === selectedTaskId ? eventState.events : [],
    targetOptions,
    selectedTargetKey,
    maxEvalCount,
    generationBrief,
    activeTask,
    loading:
      tasksQuery.isPending ||
      versionsQuery.isPending,
    error:
      tasksQuery.isError ||
      versionsQuery.isError,
    mutationPending:
      startMutation.isPending ||
      cancelMutation.isPending ||
      publishMutation.isPending ||
      discardMutation.isPending,
    draftLoading: draftQuery.isPending && Boolean(selectedTask?.draftId),
    mutationError:
      mutationError instanceof Error ? mutationError.message : null,
    actions: {
      selectTask: setRequestedTaskId,
      setPage,
      setPageSize: (nextPageSize: number) => {
        setPageSize(nextPageSize)
        setPage(1)
      },
      selectTarget: setRequestedTargetKey,
      setMaxEvalCount,
      setGenerationBrief,
      start: () => startMutation.mutateAsync(),
      cancel: (taskId: string) => cancelMutation.mutateAsync(taskId),
      publish: (taskId: string) => publishMutation.mutateAsync(taskId),
      discard: (taskId: string) => discardMutation.mutateAsync(taskId),
      retry: () => {
        void Promise.all([
          tasksQuery.refetch(),
          versionsQuery.refetch(),
        ])
      },
      clearMutationError: () => {
        startMutation.reset()
        cancelMutation.reset()
        publishMutation.reset()
        discardMutation.reset()
      },
    },
  }
}
