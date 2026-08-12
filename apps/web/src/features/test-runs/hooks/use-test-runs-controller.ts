import {
  useInfiniteQuery,
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
  listTestRunLogs,
  listTestRuns,
  startTestRun,
  subscribeToTestRun,
} from "@/features/test-runs/api/test-runs-api"
import type {
  TestRunDetail,
  TestRunEvent,
  TestRunLogFilters,
  TestRunMode,
} from "@/features/test-runs/model/test-run"
import { isActiveTestRun } from "@/features/test-runs/model/test-run"
import { listSkillVersions } from "@/features/version-browser/api/version-browser-api"
import type { SkillVersionBrowser } from "@/features/version-browser/model/version-browser"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"

function runListRootKey(workspaceId: string) {
  return ["skill-workspaces", workspaceId, "test-runs"] as const
}

export function getVersionComparisonDefaults(
  versions: readonly SkillVersionBrowser[],
): {
  baselineVersionId: string
  candidateVersionId: string
} {
  const readyVersions = versions
    .filter((version) => version.snapshot.state === "READY")
    .sort(
      (left, right) =>
        left.sequenceNumber - right.sequenceNumber ||
        left.createdAt.localeCompare(right.createdAt),
    )
  const baseline =
    readyVersions.find((version) => version.isComparisonBaseline) ??
    readyVersions[0]
  const candidate = [...readyVersions]
    .reverse()
    .find((version) => version.id !== baseline?.id)
  return {
    baselineVersionId: baseline?.id ?? "",
    candidateVersionId: candidate?.id ?? "",
  }
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
  const [mode, setMode] = useState<TestRunMode>("target_vs_no_skill")
  const [requestedBaselineVersionId, setRequestedBaselineVersionId] =
    useState("")
  const [requestedCandidateVersionId, setRequestedCandidateVersionId] =
    useState("")
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
  const versionsQuery = useQuery({
    queryKey: ["skill-workspaces", workspace.id, "versions"],
    queryFn: () => listSkillVersions(workspace.id),
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
  const readyVersions = useMemo(
    () =>
      (versionsQuery.data ?? [])
        .filter((version) => version.snapshot.state === "READY")
        .sort(
          (left, right) =>
            left.sequenceNumber - right.sequenceNumber ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    [versionsQuery.data],
  )
  const versionDefaults = useMemo(
    () => getVersionComparisonDefaults(readyVersions),
    [readyVersions],
  )
  const baselineVersionId = readyVersions.some(
    (version) => version.id === requestedBaselineVersionId,
  )
    ? requestedBaselineVersionId
    : versionDefaults.baselineVersionId
  const candidateVersionId = readyVersions.some(
    (version) =>
      version.id === requestedCandidateVersionId &&
      version.id !== baselineVersionId,
  )
    ? requestedCandidateVersionId
    : ([...readyVersions]
        .reverse()
        .find((version) => version.id !== baselineVersionId)?.id ?? "")
  const baselineVersion =
    readyVersions.find((version) => version.id === baselineVersionId) ??
    null
  const candidateVersion =
    readyVersions.find((version) => version.id === candidateVersionId) ??
    null
  const draft = workspace.activeDraft
  const hasActiveRun = (runsQuery.data?.summary.active ?? 0) > 0

  const startMutation = useMutation({
    mutationFn: () => {
      if (!selectedRevisionId) {
        throw new Error("A published Evals revision is required.")
      }
      const input =
        mode === "target_vs_no_skill"
          ? (() => {
              if (!draft) {
                throw new Error(
                  "The current Skill working copy is required.",
                )
              }
              return {
                draftId: draft.id,
                draftContentRevision: draft.contentRevision,
                evalRevisionId: selectedRevisionId,
                mode,
              }
            })()
          : (() => {
              if (
                !baselineVersionId ||
                !candidateVersionId ||
                baselineVersionId === candidateVersionId
              ) {
                throw new Error(
                  "Two different READY Skill versions are required.",
                )
              }
              return {
                baselineVersionId,
                candidateVersionId,
                evalRevisionId: selectedRevisionId,
                mode,
              }
            })()
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
    versions: readyVersions,
    versionsLoading: versionsQuery.isPending,
    versionsError: versionsQuery.isError,
    mode,
    baselineVersion,
    baselineVersionId,
    candidateVersion,
    candidateVersionId,
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
      selectMode: setMode,
      selectBaselineVersion: setRequestedBaselineVersionId,
      selectCandidateVersion: setRequestedCandidateVersionId,
      start: () => startMutation.mutateAsync(),
      retry: () => {
        void Promise.all([
          runsQuery.refetch(),
          revisionsQuery.refetch(),
          versionsQuery.refetch(),
        ])
      },
      clearMutationError: startMutation.reset,
    },
  }
}

export function useTestRunDetailController(
  workspaceId: string,
  runId: string,
  logFilters: TestRunLogFilters,
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
  const logsQuery = useInfiniteQuery({
    queryKey: ["test-runs", runId, "logs", logFilters],
    queryFn: ({ pageParam }) =>
      listTestRunLogs(runId, {
        ...logFilters,
        ...(pageParam === undefined
          ? {}
          : { beforeSequence: pageParam }),
        limit: 200,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? (lastPage.pagination.nextBeforeSequence ?? undefined)
        : undefined,
    enabled: loadedRunId === runId,
  })
  const historyEvents = useMemo(
    () =>
      (logsQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .sort((left, right) => left.sequence - right.sequence),
    [logsQuery.data?.pages],
  )
  const streamAfterSequence =
    historyEvents.at(-1)?.sequence ?? 0
  const terminalHistoryEvent = historyEvents.find((event) =>
    [
      "run.completed",
      "run.canceled",
      "run.interrupted",
      "run.failed",
    ].includes(event.type),
  )

  useEffect(() => {
    if (
      loadedRunId !== runId ||
      !logsQuery.isSuccess ||
      !runQuery.data ||
      !isActiveTestRun(runQuery.data.status) ||
      terminalHistoryEvent
    ) {
      if (
        terminalHistoryEvent &&
        runQuery.data &&
        isActiveTestRun(runQuery.data.status)
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["test-runs", runId],
          exact: true,
        })
      }
      return
    }
    let unsubscribe: () => void = () => undefined
    unsubscribe = subscribeToTestRun(
      runId,
      streamAfterSequence,
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
          }
        })
        if (
          event.type.startsWith("run.") ||
          event.type.startsWith("case.")
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["test-runs", runId],
            exact: true,
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
          exact: true,
        })
      },
    )
    return unsubscribe
  }, [
    loadedRunId,
    logsQuery.isSuccess,
    queryClient,
    runId,
    runQuery.data,
    streamAfterSequence,
    terminalHistoryEvent,
    workspaceId,
  ])

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

  const events = useMemo(() => {
    const uniqueEvents = new Map<number, TestRunEvent>()
    const liveEvents =
      eventState.runId === runId ? eventState.events : []
    for (const event of [...historyEvents, ...liveEvents]) {
      const eventCase = runQuery.data?.cases.find(
        (runCase) => runCase.id === event.caseId,
      )
      const eventPhase =
        event.type.startsWith("execution.") ||
        event.type.startsWith("case.execution.")
        ? "execution"
        : event.type.startsWith("grading.") ||
            event.type.startsWith("case.assessment.")
          ? "grading"
          : "orchestration"
      if (
        (logFilters.side && eventCase?.side !== logFilters.side) ||
        (logFilters.externalId !== undefined &&
          eventCase?.externalId !== logFilters.externalId) ||
        (logFilters.phase && eventPhase !== logFilters.phase)
      ) {
        continue
      }
      uniqueEvents.set(event.sequence, event)
    }
    return [...uniqueEvents.values()].sort(
      (left, right) => left.sequence - right.sequence,
    )
  }, [
    eventState,
    historyEvents,
    logFilters,
    runId,
    runQuery.data?.cases,
  ])

  return {
    run: runQuery.data ?? null,
    events,
    loading: runQuery.isPending,
    error: runQuery.isError,
    logsLoading: logsQuery.isPending,
    logsError: logsQuery.isError,
    hasEarlierEvents: logsQuery.hasNextPage,
    loadingEarlierEvents: logsQuery.isFetchingNextPage,
    mutationPending: cancelMutation.isPending,
    mutationError:
      cancelMutation.error instanceof Error
        ? cancelMutation.error.message
        : null,
    actions: {
      cancel: () => cancelMutation.mutateAsync(),
      retry: () => void runQuery.refetch(),
      retryLogs: () => void logsQuery.refetch(),
      loadEarlierEvents: () => logsQuery.fetchNextPage(),
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
