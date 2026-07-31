import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"

import { listEvalRevisions } from "@/features/evals/api/evals-api"
import type { EvalRevision } from "@/features/evals/model/evals"
import {
  cancelTestRun,
  getTestRun,
  listTestRuns,
  startTestRun,
  subscribeToTestRun,
} from "@/features/test-runs/api/test-runs-api"
import type {
  TestRunDetail,
  TestRunEvent,
} from "@/features/test-runs/model/test-run"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"

const maxVisibleEvents = 300

function runListRootKey(workspaceId: string) {
  return ["skill-workspaces", workspaceId, "test-runs"] as const
}

function runListKey(workspaceId: string, page: number, pageSize: number) {
  return [...runListRootKey(workspaceId), { page, pageSize }] as const
}

export function useTestRunsListController(
  workspace: SkillWorkspace,
  initialEvalRevisionId: string | null,
) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [requestedRevisionId, setRequestedRevisionId] = useState(
    initialEvalRevisionId ?? "",
  )
  const startAttempt = useRef<{
    readonly signature: string
    readonly idempotencyKey: string
  } | null>(null)

  const runsQuery = useQuery({
    queryKey: runListKey(workspace.id, page, pageSize),
    queryFn: () => listTestRuns(workspace.id, page, pageSize),
  })
  const revisionsQuery = useQuery({
    queryKey: ["skill-workspaces", workspace.id, "eval-revisions"],
    queryFn: () => listEvalRevisions(workspace.id),
  })
  const revisions = useMemo(
    () => revisionsQuery.data ?? [],
    [revisionsQuery.data],
  )
  const selectedRevisionId =
    revisions.find((revision) => revision.id === requestedRevisionId)?.id ??
    ""

  const selectedRevision = useMemo(
    () =>
      revisions.find((revision) => revision.id === selectedRevisionId) ??
      null,
    [revisions, selectedRevisionId],
  )
  const draft = workspace.activeDraft
  const hasActiveRun = (runsQuery.data?.summary.active ?? 0) > 0

  const startMutation = useMutation({
    mutationFn: () => {
      if (!draft || !selectedRevisionId) {
        throw new Error(
          "The current Skill working copy and a published Evals revision are required.",
        )
      }
      const input = {
        draftId: draft.id,
        draftContentRevision: draft.contentRevision,
        evalRevisionId: selectedRevisionId,
        mode: "target_vs_no_skill" as const,
      }
      const signature = JSON.stringify(input)
      if (startAttempt.current?.signature !== signature) {
        startAttempt.current = {
          signature,
          idempotencyKey: crypto.randomUUID(),
        }
      }
      return startTestRun(
        workspace.id,
        input,
        startAttempt.current.idempotencyKey,
      )
    },
    onSuccess: (run) => {
      startAttempt.current = null
      queryClient.setQueryData<TestRunDetail>(
        ["test-runs", run.id],
        run,
      )
      void queryClient.invalidateQueries({
        queryKey: runListRootKey(workspace.id),
      })
    },
  })

  return {
    runs: runsQuery.data?.items ?? [],
    pagination: runsQuery.data?.pagination ?? {
      page,
      pageSize,
      total: 0,
      pageCount: 0,
    },
    summary: runsQuery.data?.summary ?? {
      total: 0,
      active: 0,
      completed: 0,
      interrupted: 0,
      failed: 0,
    },
    draft,
    revisions,
    selectedRevision,
    selectedRevisionId,
    hasActiveRun,
    loading: runsQuery.isPending || revisionsQuery.isPending,
    error: runsQuery.isError || revisionsQuery.isError,
    mutationPending: startMutation.isPending,
    mutationError:
      startMutation.error instanceof Error
        ? startMutation.error.message
        : null,
    actions: {
      setPage,
      setPageSize: (nextPageSize: number) => {
        setPageSize(nextPageSize)
        setPage(1)
      },
      selectRevision: setRequestedRevisionId,
      start: () => startMutation.mutateAsync(),
      retry: () => {
        void Promise.all([
          runsQuery.refetch(),
          revisionsQuery.refetch(),
        ])
      },
      clearMutationError: startMutation.reset,
    },
  }
}

export function useTestRunDetailController(
  workspaceId: string,
  runId: string,
) {
  const queryClient = useQueryClient()
  const [eventState, setEventState] = useState<{
    readonly runId: string | null
    readonly events: readonly TestRunEvent[]
  }>({ runId: null, events: [] })
  const runQuery = useQuery({
    queryKey: ["test-runs", runId],
    queryFn: () => getTestRun(runId),
  })
  const loadedRunId = runQuery.data?.id ?? null

  useEffect(() => {
    if (loadedRunId !== runId) return
    let unsubscribe: () => void = () => undefined
    unsubscribe = subscribeToTestRun(
      runId,
      (event) => {
        setEventState((current) => {
          const currentEvents =
            current.runId === runId ? current.events : []
          if (
            currentEvents.some(
              (item) => item.sequence === event.sequence,
            )
          ) {
            return current
          }
          return {
            runId,
            events: [...currentEvents, event]
              .sort((left, right) => left.sequence - right.sequence)
              .slice(-maxVisibleEvents),
          }
        })
        if (
          event.type.startsWith("run.") ||
          event.type.startsWith("case.")
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["test-runs", runId],
          })
          void queryClient.invalidateQueries({
            queryKey: runListRootKey(workspaceId),
          })
        }
        if (
          [
            "run.completed",
            "run.canceled",
            "run.interrupted",
            "run.failed",
          ].includes(event.type)
        ) {
          unsubscribe()
        }
      },
      () => {
        void queryClient.invalidateQueries({
          queryKey: ["test-runs", runId],
        })
      },
    )
    return unsubscribe
  }, [loadedRunId, queryClient, runId, workspaceId])

  const cancelMutation = useMutation({
    mutationFn: () => cancelTestRun(runId),
    onSuccess: (run) => {
      queryClient.setQueryData<TestRunDetail | undefined>(
        ["test-runs", runId],
        (current) => (current ? { ...current, ...run } : current),
      )
      void queryClient.invalidateQueries({
        queryKey: runListRootKey(workspaceId),
      })
    },
  })

  return {
    run: runQuery.data ?? null,
    events: eventState.runId === runId ? eventState.events : [],
    loading: runQuery.isPending,
    error: runQuery.isError,
    mutationPending: cancelMutation.isPending,
    mutationError:
      cancelMutation.error instanceof Error
        ? cancelMutation.error.message
        : null,
    actions: {
      cancel: () => cancelMutation.mutateAsync(),
      retry: () => void runQuery.refetch(),
      clearMutationError: cancelMutation.reset,
    },
  }
}

export function findRevisionForTask(
  revisions: readonly EvalRevision[],
  taskId: string,
): EvalRevision | null {
  return (
    revisions.find(
      (revision) => revision.sourceGenerationTaskId === taskId,
    ) ?? null
  )
}
